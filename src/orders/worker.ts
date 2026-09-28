import { OrderStore, type DeterministicAction, type OrderRow, type IntentRow } from "./store.js";
import { validateExecution,mandateDigest,type ExecutionMandate } from "../engine/executionValidator.js";
import { allowedRoute } from "./config.js";
import type { MarketSnapshot } from "../engine/types.js";
import { getMarketSnapshot } from "../engine/quote.js";
import { getPublicClient } from "../lib/chain.js";
import { getVerifiedSymbol } from "../lib/registry.js";
import { encodeFunctionData, keccak256, parseAbi, type Hash, type Hex, type Address } from "viem";
import { configuredSender, TESTNET_CHAIN_ID } from "../lib/network.js";
import { verifyReceipt, type ChainEvidence } from "../engine/receipt.js";
import { ROUTER_ABI } from "../engine/prepareBuy.js";
import { checkRouteBytecodePresent, isEvidenceBlockFresh, estimateTransactionFee, type FeeEstimate } from "../lib/executionEvidence.js";
import { requestPlan, checkProposal, type PlannerAction, type PlannerInput, type PlannerResult } from "../engine/servPlanner.js";
import { attestLive, isAttestedLive, type EvidenceProvenance, type SourceProvenance } from "../engine/provenance.js";
import {protectTransaction,recoverTransaction} from './protectedTransaction.js';

export type Planner = (input: PlannerInput) => Promise<PlannerResult>;
/** Measured prerequisites. `null` means not measured — never "passed". */
export interface ExecutionPrerequisites {
 routeBytecodePresent: boolean | null; evidenceBlockFresh: boolean | null;
 walletGasBalanceWei: string | null; walletUsdgBalance: string | null; allowance: string | null;
 gasUpperBoundWei: string | null; fee: FeeEstimate | null; reasons: string[]; provenance: SourceProvenance;
}

/** LIVE only when the worker runs live and every component was attested by a
 * live adapter; SYNTHETIC or REPLAY only when every component consistently says
 * so in a non-live run; anything else is MIXED and never qualifies. */
function evidenceProvenance(mode: WorkerDependencies["mode"], snapshot: MarketSnapshot, prereq: ExecutionPrerequisites): EvidenceProvenance {
 const parts = [snapshot, prereq], attested = parts.filter(isAttestedLive).length;
 if (mode === "live") return attested === parts.length ? "LIVE" : "MIXED";
 if (attested > 0) return "MIXED";
 const labels = [snapshot.provenance ?? "SYNTHETIC", prereq.provenance];
 return labels.every(l => l === "SYNTHETIC") ? "SYNTHETIC" : labels.every(l => l === "REPLAY") ? "REPLAY" : "MIXED";
}
/** Values fixed before reservation so that signing is local and cannot fail on the network. */
export interface ExecutionReady { signer: Address; nonce: number; gas: bigint; maxFeePerGas: bigint }
/** Testnet-only signer (see src/orders/testnet.ts). Mainnet dependencies never carry one. */
export interface TestnetExecutor {
 prepare(m: ExecutionMandate, fee: FeeEstimate | null): Promise<{ ok: true; ready: ExecutionReady } | { ok: false; reason: string }>;
 sign(intent: IntentRow, ready: ExecutionReady): Promise<{ hash: Hash; nonce: number; raw: Hex }>;
 broadcast(raw: Hex): Promise<Hash>;
}
export interface WorkerDependencies {
 now:()=>number;
 quote:(m:ExecutionMandate,amount:bigint)=>Promise<MarketSnapshot>;
 chain:(hash:string,m:ExecutionMandate)=>Promise<ChainEvidence|null>;
 prerequisites:(m:ExecutionMandate,amount:bigint,snapshot:MarketSnapshot,now:number)=>Promise<ExecutionPrerequisites>;
 plan:Planner;
 planTimeoutMs?:number;
 mode:"live"|"synthetic";
 executor?:TestnetExecutor;
 marketLabel?:string; // e.g. "TESTNET MOCK"; absent on mainnet
}
export const PLANNER_TIMEOUT_MS = 45_000;
// SERV is consulted only once code has found a permitted candidate.
const PERMITTED_WITH_CANDIDATE: PlannerAction[] = ["PROPOSE_EXECUTION", "WAIT", "ESCALATE"];
const REFUSE_REASONS = new Set(["PRICE_BOUND_EXCEEDED", "PRICE_IMPACT_LIMIT", "SIZE_OUTSIDE_MANDATE", "PARTIAL_FILL_FORBIDDEN"]);

const ERC20_READ_ABI = parseAbi([
 "function balanceOf(address) view returns (uint256)",
 "function allowance(address,address) view returns (uint256)",
]);

/** Live prerequisites. Wallet and fee values need a configured public sender
 * equal to the mandate signer; otherwise they stay null. The fee is estimated
 * on a probe with the exact route, amount and recipient but a placeholder
 * amountOutMinimum=1: the real minimum exists only after validation, which
 * itself needs this fee bound, and a successful V3 swap's gas does not depend
 * on the minimum's value. The probe is never signed or sent. */
export async function measureLivePrerequisites(m: ExecutionMandate, amount: bigint, snapshot: MarketSnapshot, now: number): Promise<ExecutionPrerequisites> {
 const reasons: string[] = [];
 const route = { token: m.route.token as Address, quoteToken: m.route.quoteToken as Address, pool: m.route.pool as Address, router: m.route.router as Address };
 const bytecode = await checkRouteBytecodePresent(route, BigInt(snapshot.blockNumber)).catch(() => null);
 if (!bytecode) reasons.push("ROUTE_BYTECODE_UNMEASURED");
 else if (!bytecode.allPresent) reasons.push(`ROUTE_BYTECODE_MISSING:${JSON.stringify(bytecode.bytesPresent)}`);
 const evidenceBlockFresh = snapshot.blockTimestamp === undefined ? null : isEvidenceBlockFresh(snapshot.blockTimestamp, now);
 if (evidenceBlockFresh === false) reasons.push("EVIDENCE_BLOCK_STALE");
 const base = { routeBytecodePresent: bytecode?.allPresent ?? null, evidenceBlockFresh, provenance: "LIVE" as const };
 const none = { walletGasBalanceWei: null, walletUsdgBalance: null, allowance: null, gasUpperBoundWei: null, fee: null };
 let sender: Address | undefined;
 try { sender = configuredSender(); } catch (e) { reasons.push(e instanceof Error ? e.message : "SENDER_CONFIGURATION_INVALID"); }
 if (!sender || sender.toLowerCase() !== m.signer.toLowerCase()) {
   return attestLive({ ...base, ...none, reasons: [...reasons, sender ? "SENDER_DOES_NOT_MATCH_MANDATE_SIGNER" : "NO_CONFIGURED_SENDER"] });
 }
 try {
   const client = getPublicClient();
   const [usdg, allowance, eth] = await Promise.all([
     client.readContract({ address: route.quoteToken, abi: ERC20_READ_ABI, functionName: "balanceOf", args: [sender] }),
     client.readContract({ address: route.quoteToken, abi: ERC20_READ_ABI, functionName: "allowance", args: [sender, route.router] }),
     client.getBalance({ address: sender }),
   ]);
   const swap = encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{
     tokenIn: route.quoteToken, tokenOut: route.token, fee: m.route.fee, recipient: m.recipient as Address, amountIn: amount, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n,
   }] });
   const probe = encodeFunctionData({ abi: ROUTER_ABI, functionName: "multicall", args: [BigInt(now + 120), [swap]] });
   const fee = await estimateTransactionFee({ to: route.router, data: probe, from: sender });
   if (fee.status !== "ESTIMATED") reasons.push(`FEE_UNAVAILABLE:${fee.notes.join("|")}`);
   return attestLive({
     ...base, walletGasBalanceWei: eth.toString(), walletUsdgBalance: usdg.toString(), allowance: allowance.toString(),
     gasUpperBoundWei: fee.status === "ESTIMATED" ? fee.feeUpperBoundWei : null, fee, reasons,
   });
 } catch {
   return attestLive({ ...base, ...none, reasons: [...reasons, "WALLET_READ_FAILED"] });
 }
}

export const liveDependencies:WorkerDependencies={
 now:()=>Math.floor(Date.now()/1000),mode:"live",plan:requestPlan,prerequisites:measureLivePrerequisites,
 quote:(m,amount)=>getMarketSnapshot({symbol:"NVDA",inputUsdgBaseUnits:amount,maxFeedAgeSeconds:m.maxFeedAgeSeconds}),
 chain:async(hash,m)=>{
   const c=getPublicClient();if(await c.getChainId()!==4663)throw new Error("CHAIN_MISMATCH");
   const receipt=await c.getTransactionReceipt({hash:hash as Hash}).catch(()=>null);if(!receipt)return null;
   const [tx,block,finalized]=await Promise.all([c.getTransaction({hash:hash as Hash}),c.getBlock({blockNumber:receipt.blockNumber}),c.getBlock({blockTag:"finalized"})]);
   let referenceAtInclusion:unknown=null;
   try{const entry=getVerifiedSymbol("NVDA");const round=await c.readContract({address:entry.feed.proxyAddress,abi:parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"]),functionName:"latestRoundData",blockNumber:receipt.blockNumber});referenceAtInclusion={feed:entry.feed.proxyAddress,block:receipt.blockNumber.toString(),round:round.map(String)};}catch{/* Explicitly unavailable, never copied from decision. */}
   return {chainId:4663,transactionHash:receipt.transactionHash,from:tx.from,to:tx.to??"",input:tx.input,nonce:tx.nonce,value:tx.value,status:receipt.status,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,blockTimestamp:Number(block.timestamp),canonicalBlockHash:block.hash,finalized:finalized.number>=receipt.blockNumber,gasUsed:receipt.gasUsed,effectiveGasPrice:receipt.effectiveGasPrice,totalFeeWei:null,logs:receipt.logs,referenceAtInclusion};
 },
};

/** UNKNOWN when required evidence is missing; REFUSE when the candidate breaks a limit; otherwise WAIT. */
function hardStopAction(s: MarketSnapshot, p: ExecutionPrerequisites, validatorReason: string | null): DeterministicAction {
 const missing = s.referenceStatus === "UNAVAILABLE" || s.tradingHalt === null || s.pendingCorporateAction === null || !s.executableQuote || s.session.name === "UNKNOWN"
   || [p.routeBytecodePresent, p.evidenceBlockFresh, p.gasUpperBoundWei, p.walletGasBalanceWei, p.walletUsdgBalance, p.allowance].some(v => v === null);
 if (missing || validatorReason === "EVIDENCE_PROVENANCE_MIXED" || validatorReason === "EVIDENCE_NOT_LIVE") return "UNKNOWN";
 return validatorReason !== null && REFUSE_REASONS.has(validatorReason) ? "REFUSE" : "WAIT";
}

function buildPlannerInput(m: ExecutionMandate, o: OrderRow, s: MarketSnapshot, v: { amountIn: string; minimumOutput: string; referenceRound: string; deadline: number; mandateHash: string }, p: ExecutionPrerequisites, history: { type: string; created_at: number }[], provenance: EvidenceProvenance, testnetSigning = false): PlannerInput {
 // Wallet addresses are not needed to plan and are withheld from the external model.
 const { owner: _owner, signer: _signer, recipient: _recipient, ...limits } = m;
 const live = provenance === "LIVE";
 const mock = s.marketData === "TESTNET_MOCK";
 return {
   permittedActions: [...PERMITTED_WITH_CANDIDATE],
   evidence: {
     mandate_limits: { ...limits, mandateHash: v.mandateHash, walletAddresses: "withheld from planner" },
     remaining_budget: { budget: o.budget, settled: o.settled, reserved: o.reserved, available: (BigInt(o.budget) - BigInt(o.settled) - BigInt(o.reserved)).toString(), fills: o.fills, attempts: o.attempts, checks: o.checks },
     order_history: { recentEvents: history },
     reference: { status: s.referenceStatus, roundId: s.feedRoundId, answerRaw: s.feedAnswerRaw ?? null, decimals: s.feedDecimals, updatedAt: s.feedUpdatedAt, ageSeconds: s.feedAgeSeconds, oraclePaused: s.oraclePaused ?? null, multiplierState: s.multiplierState ?? null },
     executable_quote: s.executableQuote ? { amountIn: s.executableQuote.inputUsdgBaseUnits, amountOut: s.executableQuote.outputTokenBaseUnits, effectivePriceUsdgPerToken: s.executableQuote.effectivePriceUsdgPerToken, priceImpactBps: s.executableQuote.priceImpactBps, blockNumber: s.blockNumber, capturedAt: s.capturedAt } : null,
     session: s.session,
     asset_status: { tradingHalt: s.tradingHalt, pendingCorporateAction: s.pendingCorporateAction },
     deterministic_candidate: { permittedByCode: true, amountIn: v.amountIn, minimumOutput: v.minimumOutput, referenceRound: v.referenceRound, deadline: v.deadline, signingEnabled: testnetSigning, ...(mock ? { signingScope: testnetSigning ? "TESTNET ONLY: one transaction with valueless mock tokens, after code revalidates" : "none" } : {}) },
     execution_prerequisites: { routeBytecodePresent: p.routeBytecodePresent, evidenceBlockFresh: p.evidenceBlockFresh, walletChecksPassedByCode: true, feeUpperBoundWei: p.gasUpperBoundWei, limits: "bytecode presence is not contract identity; block freshness is not comprehensive network health" },
     provenance: { evidenceProvenance: provenance, liveExecutable: live,
       note: live && mock ? "Live chain reads of TESTNET MOCK contracts on chain 46630: mock tokens, an operator-set mock price and operator-seeded (controlled) liquidity. Not market data; the tokens have no value. Evaluate only against the confirmed limits."
         : live ? "Live chain and official-API reads." : `${provenance} evidence for a labeled simulation, not a market observation. Any PROPOSE_EXECUTION yields only a simulation preview.`,
       ...(mock ? { marketData: "TESTNET_MOCK" } : {}) },
   },
 };
}

async function callPlanner(plan: Planner, input: PlannerInput, ms: number): Promise<PlannerResult> {
 let timer: ReturnType<typeof setTimeout> | undefined;
 const timeout = new Promise<PlannerResult>(resolve => { timer = setTimeout(() => resolve({ status: "FAILED", reason: "PLANNER_TIMEOUT", transactionAuthorized: false }), ms); });
 try {
   // A late result after the timeout is simply dropped; it can no longer change state.
   return await Promise.race([Promise.resolve().then(() => plan(input)).catch((): PlannerResult => ({ status: "FAILED", reason: "PLANNER_THREW", transactionAuthorized: false })), timeout]);
 } finally { clearTimeout(timer); }
}

function plannerMeta(r: PlannerResult): Record<string, unknown> {
 const { proposal: _proposal, untrustedRawOutput: _raw, ...meta } = r;
 return meta;
}

export async function processOrder(store:OrderStore,id:string,deps:WorkerDependencies=liveDependencies) {
 const lease=store.claim(id,deps.now());if(!lease)return "NOT_CLAIMED";
 try {
   // a. Confirmed mandate and current order state.
   const m=store.mandate(id);
   // Evidence-only upgrade for an already settled transaction. This branch has
   // no path to planning, reservation, signing, rebroadcast, or a new fill.
   const legacy=store.receiptForFeeReverification(id);
   if(legacy){
     const tx=store.transaction(legacy.id);if(!tx)throw new Error("SETTLED_TRANSACTION_IDENTITY_MISSING");
     const chain=await deps.chain(tx.hash,m);
     if(!chain)return "REVERIFICATION_UNAVAILABLE";
     const receipt=verifyReceipt(m,legacy,tx,chain,deps.mode);
     if(!receipt.finalized||!receipt.settlementVerified)return "REVERIFICATION_UNRESOLVED";
     store.refreshSettlement(id,lease,legacy.id,receipt,deps.now());return "REVERIFIED";
   }
   store.stopIfExpired(id,lease,deps.now());
   // b. Always reconcile before terminal-state checks or new quotes.
   const intent=store.pending(id);
   if(intent) {
     let tx=store.transaction(intent.id);
     if(!tx){
       const job=store.signingJob(intent.id);
       if(job&&deps.executor&&m.route.chainId===TESTNET_CHAIN_ID&&store.canResumeSigning(id,lease,intent.id,deps.now())){
         const signed=await deps.executor.sign(intent,{...job,gas:BigInt(job.gas),maxFeePerGas:BigInt(job.maxFeePerGas)});
         if(keccak256(signed.raw)!==signed.hash)throw new Error('SIGNED_IDENTITY_MISMATCH');
         store.persistSigned(id,lease,intent.id,signed.hash,signed.nonce,protectTransaction(signed.raw),deps.now());tx=store.transaction(intent.id);
       }
       if(!tx){store.pendingWait(id,lease,deps.now(),"Unsigned reservation cannot safely resume (missing job or stale evidence); operator recovery required; budget retained");return "UNRESOLVED_INTENT";}
     }
     const chain=await deps.chain(tx.hash,m);
     if(!chain){
       const raw=store.signedBytes(intent.id),order=store.get(id);
       // Only identical bytes can be retried, only while the original mandate is
       // active. Cancellation/expiry prohibit new sends but keep reconciliation.
       if(raw&&deps.executor&&m.route.chainId===TESTNET_CHAIN_ID&&order.cancelled_at===null&&deps.now()<intent.deadline){
         try {const bytes=recoverTransaction(raw);if(keccak256(bytes).toLowerCase()!==tx.hash.toLowerCase())throw new Error('IDENTITY_CONFLICT');if(!store.canSend(id,lease,intent.id,deps.now()))throw new Error('SEND_CANCELLED');const hash=await deps.executor.broadcast(bytes);if(hash.toLowerCase()!==tx.hash.toLowerCase())throw new Error('IDENTITY_CONFLICT');store.recordBroadcast(id,lease,intent.id,{hash:tx.hash,accepted:true,recovery:true},deps.now());}catch{store.recordBroadcast(id,lease,intent.id,{hash:tx.hash,accepted:false,recovery:true,error:'RECOVERY_BROADCAST_UNCONFIRMED'},deps.now());}
       }
       store.pendingWait(id,lease,deps.now(),"Transaction absent or RPC unavailable; original reservation retained, no replacement purchase");return "PENDING";
     }
     const receipt=verifyReceipt(m,intent,tx,chain,deps.mode);
     store.recordPendingReceipt(intent.id,receipt);
     if(receipt.finalized&&(receipt.settlementVerified||receipt.outcome==="REVERTED")){store.settle(id,lease,intent.id,receipt,deps.now());return "RECONCILED";}
     store.pendingWait(id,lease,deps.now(),receipt.included&&!receipt.finalized?"Included in a canonical block; waiting for finality. Budget remains reserved.":receipt.notes.join(", ")||"Unverified inclusion; budget retained",receipt.included&&!receipt.finalized);return "UNVERIFIED";
   }
   if(store.stopIfExpired(id,lease,deps.now()))return "STOPPED";
   const order=store.get(id),available=BigInt(order.budget)-BigInt(order.settled)-BigInt(order.reserved);
   const amount=available<BigInt(m.maxPerFill)?available:BigInt(m.maxPerFill);
   if(amount<BigInt(m.minimumFill)){store.recordCheck(id,lease,deps.now(),null,"Remainder below minimum fill",true);return "DUST";}
   // c. Current evidence. Unmeasured prerequisites stay null rather than invented.
   const snapshot=await deps.quote(m,amount);
   const prereq=await deps.prerequisites(m,amount,snapshot,deps.now());
   const evidence={route:m.route,blockHash:snapshot.blockHash,blockNumber:snapshot.blockNumber,blockTimestamp:snapshot.blockTimestamp,capturedAt:Math.floor(Date.parse(snapshot.capturedAt)/1000),
     routeBytecodePresent:prereq.routeBytecodePresent,evidenceBlockFresh:prereq.evidenceBlockFresh,
     reference:{answer:snapshot.feedAnswerRaw,decimals:snapshot.feedDecimals,roundId:snapshot.feedRoundId,answeredInRound:snapshot.feedRoundId,updatedAt:snapshot.feedUpdatedAt,oraclePaused:snapshot.oraclePaused,multiplierTransition:snapshot.pendingMultiplierRaw!==snapshot.uiMultiplier},
     tradingHalt:snapshot.tradingHalt,corporateActionPending:snapshot.pendingCorporateAction,quote:snapshot.executableQuote?{amountIn:snapshot.executableQuote.inputUsdgBaseUnits,amountOut:snapshot.executableQuote.outputTokenBaseUnits,priceImpactBps:snapshot.executableQuote.priceImpactBps}:null,
     gasUpperBoundWei:prereq.gasUpperBoundWei,walletGasBalanceWei:prereq.walletGasBalanceWei,walletUsdgBalance:prereq.walletUsdgBalance,allowance:prereq.allowance,
     provenance:evidenceProvenance(deps.mode,snapshot,prereq)};
   // Only a fully live, adapter-attested packet is attested; synthetic, replayed or mixed evidence is judged as a preview at most.
   if(evidence.provenance==="LIVE")attestLive(evidence);
   const validation=validateExecution({mandate:m,confirmedHash:mandateDigest(m),allowedRoute:allowedRoute(),configuredSigner:m.signer,now:deps.now(),
     purpose:evidence.provenance==="LIVE"?"live_execution":"preview",
     state:{status:order.status,cancelled:order.cancelled_at!==null,settled:order.settled,reserved:order.reserved,gasSpent:order.gas_spent,gasReserved:order.gas_reserved,fillCount:order.fills,attempts:order.attempts},evidence});
   const testnetRoute=m.route.chainId===TESTNET_CHAIN_ID&&deps.executor!==undefined;
   const reasons=[testnetRoute?"TESTNET_EXECUTION_CONFIGURED_MOCK_MARKET":"SIGNING_AND_BROADCAST_DISABLED",`EVIDENCE_PROVENANCE_${evidence.provenance}`,...prereq.reasons];
   if(!validation.ok)reasons.push(`VALIDATOR_${validation.reason}`);
   if(snapshot.referenceStatus!=="USABLE")reasons.push(`REFERENCE_${snapshot.referenceStatus}`);
   if(snapshot.pendingCorporateAction)reasons.push("CORPORATE_ACTION_REVIEW");
   if(snapshot.tradingHalt===null)reasons.push("HALT_STATE_UNAVAILABLE");
   if(snapshot.tradingHalt)reasons.push("TRADING_HALT");
   if(!snapshot.executableQuote)reasons.push("QUOTE_UNAVAILABLE");
   // d. Deterministic hard stops: code alone decides, so no inference is spent restating it.
   if(!validation.ok||snapshot.referenceStatus!=="USABLE"||snapshot.tradingHalt!==false||snapshot.pendingCorporateAction!==false||!snapshot.executableQuote){
     store.recordCheck(id,lease,deps.now(),snapshot,reasons.join("; "),false,hardStopAction(snapshot,prereq,validation.ok?null:validation.reason));
     return "CHECKED_DISABLED";
   }
   // e. Code found a permitted candidate; SERV proposes whether to use it.
   // Testnet only: fix nonce and fee caps before any reservation, so signing cannot fail on the network.
   let ready:ExecutionReady|null=null;
   if(testnetRoute&&evidence.provenance==="LIVE"&&validation.liveExecutable){
     const r=await deps.executor!.prepare(m,prereq.fee);
     if(r.ok)ready=r.ready;else prereq.reasons.push(`TESTNET_EXECUTOR_NOT_READY:${r.reason}`);
   }
   const versionBefore=store.orderVersion(id);
   const plannerInput=buildPlannerInput(m,order,snapshot,validation,prereq,store.history(id),evidence.provenance,ready!==null);
   const result=await callPlanner(deps.plan,plannerInput,deps.planTimeoutMs??PLANNER_TIMEOUT_MS);
   // f. Re-check the untrusted result here as well: planners are injectable.
   const check=result.status==="BLOCKED"?{ok:false as const,reason:"SERV_UNAVAILABLE"}
     :result.status!=="SUCCEEDED"?{ok:false as const,reason:result.reason??"SERV_FAILED"}
     :checkProposal(result.proposal,plannerInput.permittedActions,Object.keys(plannerInput.evidence));
   // Labeled SERV only when SERV produced content; unavailable, timeout and
   // transport failures are code outcomes.
   const produced=result.status==="SUCCEEDED"||Boolean(result.untrustedRawOutput);
   // Testnet only: inference took seconds; if the wallet's nonce or readiness changed meanwhile, do not reserve.
   if(ready&&check.ok&&check.proposal.action==="PROPOSE_EXECUTION"){
     const again=await deps.executor!.prepare(m,prereq.fee);
     if(!again.ok||again.ready.nonce!==ready.nonce){prereq.reasons.push(`TESTNET_EXECUTOR_CHANGED_DURING_INFERENCE:${again.ok?"NONCE":again.reason}`);ready=null;}
   }
   // g + h. Revalidate against current state and persist, atomically.
   const applied=store.applyPlan(id,lease,deps.now(),{snapshot,evidence,route:allowedRoute(),signer:m.signer,versionBefore,plannerInput,
     planner:plannerMeta(result),proposal:result.proposal??(result.untrustedRawOutput?{untrustedRawOutput:result.untrustedRawOutput}:null),
     check,origin:produced?"serv":"code",provenance:evidence.provenance,plannerSynthetic:result.synthetic===true,
     ...(deps.marketLabel?{marketLabel:deps.marketLabel}:{}),...(ready?{execution:{jobKey:`${id}:attempt:${order.attempts+1}`,ready:{...ready,gas:ready.gas.toString(),maxFeePerGas:ready.maxFeePerGas.toString()}}}:{})});
   if(applied.outcome!=="RESERVED_FOR_TESTNET_EXECUTION"||!ready)return applied.outcome;
   // i. Testnet only. Identity is durable before broadcast: a crash after this point
   // leaves a known hash to reconcile, never an unknown transaction.
   const reserved=store.pending(id);if(!reserved)throw new Error("RESERVED_INTENT_MISSING");
   const signed=await deps.executor!.sign(reserved,ready);
   if(keccak256(signed.raw)!==signed.hash)throw new Error('SIGNED_IDENTITY_MISMATCH');
   store.persistSigned(id,lease,reserved.id,signed.hash,signed.nonce,protectTransaction(signed.raw),deps.now());
   try{
     if(!store.canSend(id,lease,reserved.id,deps.now()))throw new Error('SEND_CANCELLED_OR_EXPIRED');
     const sent=await deps.executor!.broadcast(signed.raw);
     if(sent.toLowerCase()!==signed.hash.toLowerCase())throw new Error("BROADCAST_HASH_MISMATCH");
     store.recordBroadcast(id,lease,reserved.id,{hash:signed.hash,nonce:signed.nonce,accepted:true,chainId:m.route.chainId},deps.now());
     return "TESTNET_TRANSACTION_BROADCAST";
   }catch(e){
     // Not proof of failure: the transaction may still land. Reservation is retained.
     store.recordBroadcast(id,lease,reserved.id,{hash:signed.hash,nonce:signed.nonce,accepted:false,error:"BROADCAST_UNCONFIRMED"},deps.now());
     return "TESTNET_BROADCAST_UNCONFIRMED";
   }
 }catch {
   // A lost lease cannot mutate state, and an ambiguous intent cannot be released.
   try{if(store.pending(id))store.pendingWait(id,lease,deps.now(),"Reconciliation error; pending funds retained");else store.recordCheck(id,lease,deps.now(),null,"RPC_OR_WORKER_ERROR",true);}catch{/* New lease owner handles recovery. */}
   return "RETRY_OR_RECOVERY";
 }finally{store.release(id,lease);}
}
