import "../lib/env.js";
import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { executionMandateSchema, mandateDigest, type ExecutionMandate, type ExecutionRoute } from "../engine/executionValidator.js";
import { prepareBuy } from "../engine/prepareBuy.js";
import type { VerifiedReceipt } from "../engine/receipt.js";
import type { Proposal } from "../engine/servPlanner.js";
import type { EvidenceProvenance } from "../engine/provenance.js";
import { activeNetwork, TESTNET_CHAIN_ID, type Env } from "../lib/network.js";

/** Default database for the active network. Testnet never shares the mainnet file. */
export function defaultDatabasePath(env: Env = process.env): string {
 const mainnet = env.DATABASE_PATH || "./data/fairtick.db";
 if (activeNetwork(env).name === "mainnet") return mainnet;
 const testnet = env.TESTNET_DATABASE_PATH || "./data/testnet/fairtick-testnet.db";
 if (resolve(testnet) === resolve(mainnet)) throw new Error("TESTNET_DATABASE_MUST_BE_SEPARATE");
 return testnet;
}

export type DeterministicAction = "WAIT" | "UNKNOWN" | "REFUSE";
export interface PlanApplication {
 snapshot: unknown;
 evidence: unknown; // the exact packet the validator accepted before inference
 route: ExecutionRoute; signer: string;
 versionBefore: string; // orderVersion() captured immediately before inference
 plannerInput: unknown; // everything the planner saw, for reproducibility
 planner: Record<string, unknown>; // status/model/request id/latency/usage/prompt hash; never credentials
 proposal: unknown; // untrusted output as returned, or null
 check: { ok: true; proposal: Proposal } | { ok: false; reason: string };
 origin: "serv" | "code"; // "serv" only when SERV actually produced content
 provenance: EvidenceProvenance; // of the market/wallet evidence the planner saw
 plannerSynthetic: boolean; // true when the planner itself was a synthetic stand-in
 marketLabel?: string; // e.g. "TESTNET MOCK"; absent on mainnet
 // Testnet only: reserve a fill intent when a revalidated proposal is live-executable.
 // Never honoured for any route other than chain 46630.
 execution?: { jobKey: string; ready?: {signer:string;nonce:number;gas:string;maxFeePerGas:string} };
}
function evidenceFresh(e: unknown, m: ExecutionMandate, now: number) {
 const x = e as { capturedAt?: unknown; blockTimestamp?: unknown; reference?: { updatedAt?: unknown } };
 const ok = (at: unknown, limit: number) => typeof at === "number" && at > 0 && at <= now && now - at <= limit;
 return ok(x.capturedAt, m.maxQuoteAgeSeconds) && ok(x.blockTimestamp, m.maxBlockAgeSeconds) && ok(x.reference?.updatedAt, m.maxFeedAgeSeconds);
}

export interface OrderRow {
 id: string; owner: string; signer: string; status: string; budget: string; settled: string; reserved: string; received: string;
 gas_spent: string; gas_reserved: string; fills: number; attempts: number; checks: number; failures: number;
 expires_at: number; next_check: number | null; reason: string; created_at: number; updated_at: number;
 cancelled_at: number | null; lease_token: string | null; lease_until: number | null;
}
export interface IntentRow {
 id: string; job_key: string; order_id: string; signer: string; status: string; amount: string; gas_bound: string;
 minimum_output: string; reference_round: string; deadline: number; mandate_hash: string; evidence: string; request: string; created_at: number;
}
const terminal = new Set(["CANCELLED", "EXPIRED", "COMPLETED", "NEEDS_ATTENTION"]);
export class OrderStore {
 readonly db: Database.Database;
 readonly chainId: number;
 constructor(path = defaultDatabasePath(), chainId: number = activeNetwork().chainId) {
   if (path === ":memory:") throw new Error("A durable file is required");
   const absolute = resolve(path); mkdirSync(dirname(absolute), { recursive: true });
   this.db = new Database(absolute);
   this.db.function("budget_valid", { deterministic: true }, (b, s, r) => {
     try { const values = [b,s,r].map(String); return values.every(v => /^(0|[1-9]\d*)$/.test(v)) && BigInt(values[1]!) + BigInt(values[2]!) <= BigInt(values[0]!) ? 1 : 0; } catch { return 0; }
   });
   this.db.pragma("journal_mode = WAL"); this.db.pragma("synchronous = FULL"); this.db.pragma("foreign_keys = ON"); this.db.pragma("busy_timeout = 5000");
   this.db.transaction(() => { for (const m of ["001_orders.sql", "002_network.sql", "003_runtime.sql"]) this.db.exec(readFileSync(resolve("migrations", m), "utf8")); }).immediate();
   this.chainId = chainId;
   this.atomic(() => {
     this.db.prepare("INSERT OR IGNORE INTO store_network VALUES(1,?,unixepoch())").run(chainId);
     const bound = (this.db.prepare("SELECT chain_id FROM store_network WHERE id=1").get() as {chain_id:number}).chain_id;
     if (bound !== chainId) { this.db.close(); throw new Error(`DATABASE_NETWORK_MISMATCH: file is bound to chain ${bound}, process serves ${chainId}`); }
     const net=activeNetwork(),environment=chainId===net.chainId?net.environment:'EXPLICIT_TEST_CHAIN';
     this.db.prepare('INSERT OR IGNORE INTO store_environment VALUES(1,?)').run(environment);
     const identity=this.db.prepare('SELECT environment FROM store_environment WHERE id=1').get() as {environment:string};
     if(identity.environment!==environment)throw new Error('DATABASE_ENVIRONMENT_MISMATCH');
   });
 }
 close() { this.db.close(); }
 atomic<T>(fn: () => T): T { return this.db.transaction(fn).immediate(); }
 get(id: string): OrderRow { const row = this.db.prepare("SELECT * FROM orders WHERE id=?").get(id) as OrderRow | undefined; if (!row) throw new Error("ORDER_NOT_FOUND"); return row; }
 mandate(id: string): ExecutionMandate { const row = this.db.prepare("SELECT body FROM mandates WHERE order_id=?").get(id) as {body:string}; if (!row) throw new Error("ORDER_NOT_FOUND"); return JSON.parse(row.body); }
 event(id: string, type: string, body: unknown, now: number) { this.db.prepare("INSERT INTO order_events(order_id,type,body,created_at) VALUES(?,?,?,?)").run(id,type,JSON.stringify(body),now); }
 create(raw: unknown, now: number) {
   const m = executionMandateSchema.parse(raw); const digest = mandateDigest(m);
   if (m.route.chainId !== this.chainId) throw new Error("ROUTE_NETWORK_MISMATCH");
   if (m.confirmedAt > now || m.expiresAt <= now) throw new Error("INVALID_CONFIRMATION_TIME");
   return this.atomic(() => {
     const old = this.db.prepare("SELECT hash FROM mandates WHERE order_id=?").get(m.orderId) as {hash:string}|undefined;
     if (old) { if (old.hash !== digest) throw new Error("IDEMPOTENCY_CONFLICT"); return this.get(m.orderId); }
     const wallet = this.db.prepare("SELECT signer FROM orders LIMIT 1").get() as {signer:string}|undefined;
     if (wallet && wallet.signer !== m.signer.toLowerCase()) throw new Error("SINGLE_OPERATOR_WALLET_ONLY");
     this.db.prepare("INSERT INTO mandates VALUES(?,?,?,?)").run(`${m.orderId}:${m.version}`,m.orderId,digest,JSON.stringify(m));
     this.db.prepare("INSERT INTO orders(id,owner,signer,status,budget,expires_at,next_check,reason,created_at,updated_at) VALUES(?,?,?,'ACTIVE',?,?,?,'Awaiting first check',?,?)").run(m.orderId,m.owner,m.signer.toLowerCase(),m.budget,m.expiresAt,now,now,now);
     this.event(m.orderId,"CONFIRMED",{mandateHash:digest,chainId:m.route.chainId,executionEnabled:m.route.chainId===TESTNET_CHAIN_ID?"TESTNET_ONLY_IF_WORKER_ENABLED":false},now); return this.get(m.orderId);
   });
 }
 claim(id: string, now: number, duration = 120): string | null {
   return this.atomic(() => {
     const o = this.get(id);
     const feeReverification=this.receiptForFeeReverification(id)!==undefined;
     // Pending reservations always reconcile, including cancelled/expired orders.
     if (o.reserved === "0" && terminal.has(o.status) && !feeReverification) return null;
     if (!feeReverification&&o.next_check !== null && o.next_check > now) return null;
     if (o.lease_token && (o.lease_until ?? 0) > now) return null;
     const token = randomUUID(); this.db.prepare("UPDATE orders SET lease_token=?,lease_until=? WHERE id=?").run(token,now+duration,id); return token;
   });
 }
 private fenced(id: string, token: string, now: number) {
   const o = this.get(id); if (o.lease_token !== token || (o.lease_until ?? 0) <= now) throw new Error("LEASE_LOST"); return o;
 }
 release(id: string, token: string) { this.db.prepare("UPDATE orders SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?").run(id,token); }
 cancel(id: string, owner: string, now: number) {
   return this.atomic(() => { const o=this.get(id); if(o.owner!==owner) throw new Error("FORBIDDEN");
     if (o.status === "COMPLETED" || o.cancelled_at !== null || o.status === "EXPIRED") return o;
     this.db.prepare("UPDATE orders SET status='CANCELLED',cancelled_at=?,reason=?,next_check=?,updated_at=? WHERE id=?").run(now, o.reserved!=="0"?"Cancelled; pending transaction still requires reconciliation":"Cancelled before further execution",o.reserved!=="0"?now:null,now,id);
     this.event(id,"CANCELLED",{reservedRetained:o.reserved},now); return this.get(id);
   });
 }
 stopIfExpired(id: string, token: string, now: number) {
   return this.atomic(() => { const o=this.fenced(id,token,now);
     if(o.cancelled_at!==null) return true;
     if(now<o.expires_at) return terminal.has(o.status);
     if(o.status!=="EXPIRED") { this.db.prepare("UPDATE orders SET status='EXPIRED',reason='Deadline reached; pending amounts remain reserved',next_check=?,updated_at=? WHERE id=?").run(o.reserved!=="0"?now:null,now,id); this.event(id,"EXPIRED",{reservedRetained:o.reserved},now); }
     return true;
   });
 }
 recordCheck(id:string,token:string,now:number,snapshot:unknown,reason:string,failed=false,action:DeterministicAction="WAIT") {
   return this.atomic(()=>{ const o=this.fenced(id,token,now); const m=this.mandate(id);
     if(o.cancelled_at!==null || now>=o.expires_at) { this.stopIfExpired(id,token,now); return; }
     const sid=randomUUID(); this.db.prepare("INSERT INTO snapshots VALUES(?,?,?,?)").run(sid,id,JSON.stringify(snapshot),now);
     // Deterministic decision: code alone determined it; no planner was consulted.
     this.db.prepare("INSERT INTO decisions VALUES(?,?,?,'code',?,?)").run(randomUUID(),id,sid,JSON.stringify({action,reason,executionAuthorized:false,plannerCalled:false}),now);
     const {checks,next}=this.schedule(o,m,now,reason,failed);
     this.event(id,"CHECKED",{origin:"code",action,reason,checks,nextCheck:next},now);
   });
 }
 /** Shared transition for every recorded check: bounded by maxAttempts and failure backoff. */
 private schedule(o:OrderRow,m:ExecutionMandate,now:number,reason:string,failed:boolean,forceAttention=false) {
   const checks=o.checks+1, failures=failed?o.failures+1:0;
   const attention=forceAttention || m.mode==="buy_now" || checks>=m.maxAttempts || failures>=5;
   const next=attention?null:Math.min(m.expiresAt,now+Math.min(900,60*2**Math.min(failures,4)));
   const text=attention&&!forceAttention?`${reason}; ${m.mode==="buy_now"?"single check ended":"check/retry limit reached"}`:reason;
   this.db.prepare("UPDATE orders SET status=?,checks=?,failures=?,next_check=?,reason=?,updated_at=? WHERE id=?").run(attention?"NEEDS_ATTENTION":"WAITING",checks,failures,next,text,now,o.id);
   return {checks,next};
 }
 private state(o:OrderRow) { return {status:o.status,cancelled:o.cancelled_at!==null,settled:o.settled,reserved:o.reserved,gasSpent:o.gas_spent,gasReserved:o.gas_reserved,fillCount:o.fills,attempts:o.attempts}; }
 /** Content-addressed order version: any change to the mandate or mutable order state changes it. */
 orderVersion(id:string):string {
   const o=this.get(id),h=(this.db.prepare("SELECT hash FROM mandates WHERE order_id=?").get(id) as {hash:string}).hash;
   return createHash("sha256").update(JSON.stringify([h,o.status,o.budget,o.settled,o.reserved,o.received,o.gas_spent,o.gas_reserved,o.fills,o.attempts,o.checks,o.failures,o.expires_at,o.next_check,o.reason,o.cancelled_at,o.updated_at])).digest("hex");
 }
 history(id:string,limit=10) { return (this.db.prepare("SELECT type,created_at FROM order_events WHERE order_id=? ORDER BY seq DESC LIMIT ?").all(id,limit) as {type:string;created_at:number}[]).reverse(); }
 /** Applies a planner result atomically. Re-checks everything that could have
  * changed during inference. Never reserves funds or creates a fill intent. */
 applyPlan(id:string,token:string,now:number,p:PlanApplication):{outcome:string;status:string} {
   return this.atomic(()=>{
     const o=this.fenced(id,token,now),m=this.mandate(id);
     const sid=randomUUID();this.db.prepare("INSERT INTO snapshots VALUES(?,?,?,?)").run(sid,id,JSON.stringify(p.snapshot),now);
     const action=p.check.ok?p.check.proposal.action:null;
     // Exact labels, e.g. "REAL SERV CALL ON SYNTHETIC MARKET DATA".
     // "Real" needs positive evidence of an HTTP response from SERV, not just a missing synthetic flag.
     const realServ=!p.plannerSynthetic&&typeof p.planner.httpStatus==="number";
     const servCall=p.origin!=="serv"?"NO SERV OUTPUT":realServ?"REAL SERV CALL":p.plannerSynthetic?"SYNTHETIC PLANNER":"UNIDENTIFIED PLANNER";
     const label=`${servCall} ON ${p.provenance} ${p.marketLabel?p.marketLabel+" ":""}MARKET DATA`;
     const synthetic=p.provenance!=="LIVE"||p.plannerSynthetic;
     const done=(outcome:string,extra:Record<string,unknown>={})=>{
       this.db.prepare("INSERT INTO decisions VALUES(?,?,?,?,?,?)").run(randomUUID(),id,sid,p.origin,JSON.stringify({kind:"PLANNING",outcome,origin:p.origin,label,evidenceProvenance:p.provenance,synthetic,action,planner:p.planner,proposal:p.proposal,validation:p.check.ok?{valid:true}:{valid:false,reason:p.check.reason},plannerInput:p.plannerInput,executionAuthorized:false,signed:false,submitted:false,fundsReserved:false,...extra}),now);
       this.event(id,"PLANNED",{origin:p.origin,outcome,action,label},now);
       return {outcome,status:this.get(id).status};
     };
     // Stale-proposal guards run first: nothing proposed across a change is applied.
     if(o.cancelled_at!==null)return done("DISCARDED_CANCELLED_DURING_INFERENCE");
     if(now>=o.expires_at){this.stopIfExpired(id,token,now);return done("DISCARDED_EXPIRED_DURING_INFERENCE");}
     if(this.orderVersion(id)!==p.versionBefore)return done("DISCARDED_ORDER_CHANGED_DURING_INFERENCE");
     if(!evidenceFresh(p.evidence,m,now)){this.schedule(o,m,now,"Planner result arrived after the evidence aged past its limits; re-quoting at the next check",false);return done("DISCARDED_STALE_EVIDENCE");}
     if(!p.check.ok){
       const unavailable=p.check.reason==="SERV_UNAVAILABLE";
       this.schedule(o,m,now,unavailable?"SERV_UNAVAILABLE: planning required SERV, which is not configured; no execution":`Planner output rejected (${p.check.reason}); no execution`,!unavailable,unavailable);
       return done(unavailable?"SERV_UNAVAILABLE":`PLANNER_REJECTED_${p.check.reason}`);
     }
     const proposal=p.check.proposal;
     if(proposal.action==="WAIT"){this.schedule(o,m,now,`SERV proposed WAIT: ${proposal.reason}`,false);return done("WAIT_ACCEPTED");}
     if(proposal.action==="ESCALATE"){this.schedule(o,m,now,`SERV escalated for operator review: ${proposal.reason}`,false,true);return done("ESCALATED");}
     if(proposal.action==="PROPOSE_EXECUTION"){
       // Deterministic revalidation at the acceptance instant, against current state.
       // Live evidence is held to live-execution rules; anything else can at most be a simulation preview.
       const prepared=prepareBuy({mandate:m,confirmedHash:mandateDigest(m),evidence:p.evidence,state:this.state(o),allowedRoute:p.route,configuredSigner:p.signer,now,purpose:p.provenance==="LIVE"?"live_execution":"preview"});
       if(!prepared.ok){this.schedule(o,m,now,`SERV proposed execution; deterministic revalidation rejected it (${prepared.reason})`,false);return done("REJECTED_BY_REVALIDATION",{revalidation:prepared.reason});}
       // Testnet demo only: a live-executable, revalidated proposal reserves a fill intent in this same transaction.
       if(p.execution&&prepared.liveExecutable&&m.route.chainId===TESTNET_CHAIN_ID&&this.chainId===TESTNET_CHAIN_ID){
         const intent=this.reserveWithin(id,token,p.execution.jobKey,p.evidence,p.route,p.signer,now,"TESTNET_ONLY");
         if(p.execution.ready)this.db.prepare('INSERT INTO signing_jobs VALUES(?,?)').run(intent.id,JSON.stringify(p.execution.ready));
         return done("RESERVED_FOR_TESTNET_EXECUTION",{intentId:intent.id,executionAuthorized:"TESTNET_ONLY",fundsReserved:true,
           preview:{amountIn:prepared.amountIn,minimumOutput:prepared.minimumOutput,referenceRound:prepared.referenceRound,deadline:prepared.deadline,mandateHash:prepared.mandateHash,request:prepared.request}});
       }
       const outcome=prepared.liveExecutable?"EXECUTION_DISABLED_PREVIEW":"SIMULATION_PREVIEW";
       this.schedule(o,m,now,prepared.liveExecutable?"Execution-disabled preview on live evidence. Signing is disabled: nothing was signed, submitted or reserved.":`Simulation preview on ${prepared.provenance} evidence; not executable. Nothing was signed, submitted or reserved.`,false,true);
       return done(outcome,{preview:{label:outcome,evidenceProvenance:prepared.provenance,liveExecutable:prepared.liveExecutable,transactionAuthorized:false,signed:false,submitted:false,fundsReserved:false,amountIn:prepared.amountIn,minimumOutput:prepared.minimumOutput,referenceRound:prepared.referenceRound,deadline:prepared.deadline,mandateHash:prepared.mandateHash,unsignedRequest:prepared.request,feeUpperBoundWei:(p.evidence as {gasUpperBoundWei?:unknown}).gasUpperBoundWei??null}});
     }
     // Unreachable when checkProposal ran against the permitted set; fail closed.
     this.schedule(o,m,now,`Planner action ${proposal.action} is not applicable here; no execution`,true);
     return done("PLANNER_REJECTED_UNSUPPORTED_ACTION");
   });
 }
 reserve(id:string,token:string,jobKey:string,evidence:unknown,route:ExecutionRoute,signer:string,now:number) {
   return this.atomic(()=>this.reserveWithin(id,token,jobKey,evidence,route,signer,now,false));
 }
 /** Caller holds the write transaction. `scope` is recorded on the decision; only testnet routes may carry "TESTNET_ONLY". */
 private reserveWithin(id:string,token:string,jobKey:string,evidence:unknown,route:ExecutionRoute,signer:string,now:number,scope:false|"TESTNET_ONLY") {
   {
     const o=this.fenced(id,token,now), m=this.mandate(id);
     if(scope==="TESTNET_ONLY"&&(m.route.chainId!==TESTNET_CHAIN_ID||route.chainId!==TESTNET_CHAIN_ID))throw new Error("TESTNET_SCOPE_ON_NON_TESTNET_ROUTE");
     const existing=this.db.prepare("SELECT * FROM fill_intents WHERE job_key=?").get(jobKey) as IntentRow|undefined;
     if(existing) { if(existing.order_id!==id) throw new Error("IDEMPOTENCY_CONFLICT"); return existing; }
     if(this.stopIfExpired(id,token,now)) throw new Error("ORDER_STOPPED");
     // A reservation is the step before a broadcast: only attested live evidence qualifies.
     const result=prepareBuy({mandate:m,confirmedHash:mandateDigest(m),evidence,state:{status:o.status,cancelled:o.cancelled_at!==null,settled:o.settled,reserved:o.reserved,gasSpent:o.gas_spent,gasReserved:o.gas_reserved,fillCount:o.fills,attempts:o.attempts},allowedRoute:route,configuredSigner:signer,now,purpose:"live_execution"});
     if(!result.ok) throw new Error(result.reason);
     const gas=(evidence as {gasUpperBoundWei:string}).gasUpperBoundWei;
     const intentId=randomUUID();
    this.db.prepare("INSERT INTO decisions VALUES(?,?,NULL,'code',?,?)").run(randomUUID(),id,JSON.stringify({action:"TAKE",intentId,minimumOutput:result.minimumOutput,transactionAuthorized:scope,chainId:m.route.chainId,evidence}),now);
     this.db.prepare("INSERT INTO fill_intents VALUES(?,?,?,?,'RESERVED',?,?,?,?,?,?,?,?,?)").run(intentId,jobKey,id,m.signer.toLowerCase(),result.amountIn,gas,result.minimumOutput,result.referenceRound,result.deadline,result.mandateHash,JSON.stringify(evidence),JSON.stringify(result.request),now);
     this.db.prepare("UPDATE orders SET status='SUBMITTING',reserved=?,gas_reserved=?,attempts=attempts+1,next_check=?,reason=?,updated_at=? WHERE id=?").run(result.amountIn,gas,now,scope?"Intent reserved for a testnet mock-market transaction":"Intent reserved; broadcasting disabled",now,id);
     this.event(id,"RESERVED",{intentId,jobKey,amount:result.amountIn,scope},now); return this.intent(intentId);
   }
 }
 intent(id:string) { const r=this.db.prepare("SELECT * FROM fill_intents WHERE id=?").get(id) as IntentRow|undefined;if(!r)throw new Error("INTENT_NOT_FOUND");return r; }
 pending(id:string) { return this.db.prepare("SELECT * FROM fill_intents WHERE order_id=? AND status IN ('RESERVED','PENDING','REVIEW')").get(id) as IntentRow|undefined; }
 transaction(intent:string) { return this.db.prepare("SELECT * FROM transactions WHERE intent_id=?").get(intent) as {hash:string;nonce:number;chain_id:number}|undefined; }
 /** A finalized legacy receipt whose public-testnet fee adapter lacked supported
  * total-fee semantics. This is evidence refresh only; the intent stays settled. */
 receiptForFeeReverification(id:string) {
   const row=this.db.prepare(`SELECT f.* FROM fill_intents f JOIN receipts r ON r.intent_id=f.id
     WHERE f.order_id=? AND f.status IN ('SETTLED','REVERTED') AND (
       json_extract(r.body,'$.feeMethod')='PUBLIC_TESTNET_TOTAL_FEE_UNVERIFIED'
       OR COALESCE(json_extract(r.body,'$.verificationVersion'),0)<2
       OR NOT EXISTS (SELECT 1 FROM json_each(r.body,'$.complianceChecks') c WHERE json_extract(c.value,'$.key')='partial_fill_policy'))
     ORDER BY f.created_at DESC LIMIT 1`).get(id) as IntentRow|undefined;
   return row;
 }
 // Recovery import of a known identity ONLY, never a broadcaster. No HTTP route exposes this.
 attachTransaction(id:string,token:string,intentId:string,hash:string,nonce:number,now:number) {
   if(!/^0x[0-9a-fA-F]{64}$/.test(hash)||!Number.isSafeInteger(nonce)||nonce<0)throw new Error("INVALID_TRANSACTION_IDENTITY");
   this.atomic(()=>{this.fenced(id,token,now);const intent=this.intent(intentId);if(intent.order_id!==id)throw new Error("INTENT_MISMATCH");
     const old=this.transaction(intentId); if(old) {if(old.hash!==hash||old.nonce!==nonce)throw new Error("IDENTITY_CONFLICT");return;}
     if(intent.status!=="RESERVED")throw new Error("INVALID_TRANSITION");
     this.db.prepare("INSERT INTO transactions VALUES(?,?,?,?,?,'PENDING',?)").run(hash,intentId,intent.signer,nonce,this.mandate(id).route.chainId,now);
     this.db.prepare("UPDATE fill_intents SET status='PENDING' WHERE id=?").run(intentId);
     this.db.prepare("UPDATE orders SET status=CASE WHEN status IN ('CANCELLED','EXPIRED') THEN status ELSE 'PENDING' END,reason='Known transaction pending reconciliation',next_check=?,updated_at=? WHERE id=?").run(now,now,id);
     this.event(id,"TRANSACTION_IDENTIFIED",{intentId,hash,nonce},now);
   });
 }
 /** Measurement cache only (first sighting wins); never order state. */
 inclusionMeasurement(hash:string,blockHash:string):Record<string,unknown>|null { const r=this.db.prepare("SELECT body FROM inclusion_measurements WHERE tx_hash=? AND block_hash=?").get(hash.toLowerCase(),blockHash.toLowerCase()) as {body:string}|undefined; return r?JSON.parse(r.body):null; }
 recordInclusionMeasurement(hash:string,blockHash:string,body:Record<string,unknown>,now:number) { this.db.prepare("INSERT INTO inclusion_measurements VALUES(?,?,?,?) ON CONFLICT(tx_hash,block_hash) DO UPDATE SET body=excluded.body").run(hash.toLowerCase(),blockHash.toLowerCase(),JSON.stringify(body),now); }
 heartbeat(now:number,enabled:boolean) { this.db.prepare("INSERT INTO worker_heartbeat VALUES('worker',?,?) ON CONFLICT(id) DO UPDATE SET observed_at=excluded.observed_at,execution_enabled=excluded.execution_enabled").run(now,Number(enabled)); }
 workerHealth(now:number) { const r=this.db.prepare("SELECT observed_at,execution_enabled FROM worker_heartbeat WHERE id='worker'").get() as {observed_at:number;execution_enabled:number}|undefined; return {lastSeen:r?.observed_at??null,active:!!r&&now-r.observed_at<90,executionEnabled:!!r&&now-r.observed_at<90&&!!r.execution_enabled}; }
 persistSigned(id:string,token:string,intentId:string,hash:string,nonce:number,raw:string,now:number) { this.atomic(()=>{this.attachTransaction(id,token,intentId,hash,nonce,now);this.db.prepare("INSERT INTO signed_transactions VALUES(?,?)").run(intentId,raw);}); }
 signedBytes(intentId:string) { return (this.db.prepare("SELECT raw FROM signed_transactions WHERE intent_id=?").get(intentId) as {raw:`0x${string}`}|undefined)?.raw; }
 signingJob(intentId:string) { const row=this.db.prepare('SELECT body FROM signing_jobs WHERE intent_id=?').get(intentId) as {body:string}|undefined;return row?JSON.parse(row.body) as {signer:`0x${string}`;nonce:number;gas:string;maxFeePerGas:string}:null; }
 canSend(id:string,token:string,intentId:string,now:number) {const o=this.fenced(id,token,now),intent=this.intent(intentId);return intent.order_id===id&&o.cancelled_at===null&&now<o.expires_at&&now<intent.deadline;}
 canResumeSigning(id:string,token:string,intentId:string,now:number) {return this.canSend(id,token,intentId,now)&&evidenceFresh(JSON.parse(this.intent(intentId).evidence),this.mandate(id),now);}
 recordPendingReceipt(intentId:string,receipt:VerifiedReceipt) { this.db.prepare("INSERT INTO pending_receipts VALUES(?,?) ON CONFLICT(intent_id) DO UPDATE SET body=excluded.body").run(intentId,JSON.stringify(receipt)); }
 /** Append-only record of a broadcast attempt for an already-identified transaction. */
 recordBroadcast(id:string,token:string,intentId:string,body:Record<string,unknown>,now:number) { this.atomic(()=>{this.fenced(id,token,now);if(!this.transaction(intentId))throw new Error("BROADCAST_WITHOUT_IDENTITY");this.event(id,"BROADCAST",{intentId,...body},now);}); }
 pendingWait(id:string,token:string,now:number,reason:string,included=false) { this.atomic(()=>{const o=this.fenced(id,token,now);this.db.prepare("UPDATE orders SET status=?,reason=?,next_check=?,updated_at=? WHERE id=?").run(["CANCELLED","EXPIRED"].includes(o.status)?o.status:included?"PENDING":"NEEDS_ATTENTION",reason,now+60,now,id);this.event(id,"RECONCILIATION_REQUIRED",{reason,reserved:o.reserved},now);}); }
 settle(id:string,token:string,intentId:string,receipt:VerifiedReceipt,now:number) {
   return this.atomic(()=>{const o=this.fenced(id,token,now), intent=this.intent(intentId), tx=this.transaction(intentId),m=this.mandate(id);
     if(intent.order_id!==id||!tx||receipt.transactionHash!==tx.hash||receipt.intentId!==intentId)throw new Error("RECEIPT_IDENTITY_MISMATCH");
     if(this.db.prepare("SELECT 1 FROM receipts WHERE intent_id=?").get(intentId))return this.get(id);
     if(!receipt.finalized || (!receipt.settlementVerified && receipt.outcome!=="REVERTED"))throw new Error("RECEIPT_NOT_RECONCILED");
     const spent=BigInt(receipt.amountIn),out=BigInt(receipt.amountOut),gas=BigInt(receipt.gasWei);
     if(spent<0n||out<0n||gas<0n||spent>BigInt(intent.amount))throw new Error("RECEIPT_EXCEEDS_RESERVATION");
     if(gas>BigInt(intent.gas_bound)||BigInt(o.gas_spent)+gas>BigInt(m.maxGasWei))receipt={...receipt,mandateComplianceVerified:false,notes:[...receipt.notes,"ORDER_GAS_BOUND_EXCEEDED"]};
     const settled=BigInt(o.settled)+spent,reserved=BigInt(o.reserved)-BigInt(intent.amount),remaining=BigInt(o.budget)-settled-reserved;
     if(reserved<0n||remaining<0n)throw new Error("BUDGET_INVARIANT_BROKEN");
     let status=o.cancelled_at!==null?"CANCELLED":now>=m.expiresAt?"EXPIRED":remaining===0n?"COMPLETED":"ACTIVE";
     let reason=receipt.outcome==="REVERTED"?"Transaction reverted; reservation reconciled":"Fill reconciled";
     const fills=o.fills+(receipt.outcome==="SETTLED"?1:0);
     if(!["CANCELLED","EXPIRED"].includes(status) && (!receipt.mandateComplianceVerified || gas>BigInt(intent.gas_bound) || BigInt(o.gas_spent)+gas>BigInt(m.maxGasWei))) {status="NEEDS_ATTENTION";reason="Settlement or gas requires mandate review";}
     if(status==="ACTIVE"&&(m.mode==="buy_now"||fills>=m.maxFillCount||o.attempts>=m.maxAttempts||remaining<BigInt(m.minimumFill))) {status="NEEDS_ATTENTION";reason="Partial/unfilled order stopped at confirmed limit";}
     this.db.prepare("INSERT INTO receipts VALUES(?,?,?,?)").run(intentId,tx.hash,JSON.stringify(receipt),now);
     this.db.prepare("UPDATE transactions SET status=? WHERE intent_id=?").run(receipt.outcome,intentId);
     this.db.prepare("UPDATE fill_intents SET status=? WHERE id=?").run(receipt.outcome==="REVERTED"?"REVERTED":"SETTLED",intentId);
     this.db.prepare("UPDATE orders SET settled=?,reserved=?,received=?,gas_spent=?,gas_reserved='0',fills=?,status=?,reason=?,next_check=?,updated_at=? WHERE id=?").run(settled.toString(),reserved.toString(),(BigInt(o.received)+out).toString(),(BigInt(o.gas_spent)+gas).toString(),fills,status,reason,status==="ACTIVE"?now+60:null,now,id);
     this.event(id,"RECONCILED",{intentId,outcome:receipt.outcome,amountIn:receipt.amountIn,amountOut:receipt.amountOut},now);return this.get(id);
   });
 }
 refreshSettlement(id:string,token:string,intentId:string,receipt:VerifiedReceipt,now:number) {
   return this.atomic(()=>{const o=this.fenced(id,token,now),intent=this.intent(intentId),tx=this.transaction(intentId),m=this.mandate(id);
     if(intent.order_id!==id||!tx||receipt.transactionHash.toLowerCase()!==tx.hash.toLowerCase()||receipt.intentId!==intentId)throw new Error("RECEIPT_IDENTITY_MISMATCH");
     const row=this.db.prepare("SELECT body FROM receipts WHERE intent_id=?").get(intentId) as {body:string}|undefined;
     if(!row)throw new Error("RECEIPT_NOT_FOUND");
     const old=JSON.parse(row.body) as VerifiedReceipt;
     if(!old.finalized||!old.settlementVerified||!receipt.finalized||!receipt.settlementVerified||old.outcome!==receipt.outcome||old.amountIn!==receipt.amountIn||old.amountOut!==receipt.amountOut||old.blockNumber!==receipt.blockNumber||old.blockHash.toLowerCase()!==receipt.blockHash.toLowerCase())throw new Error("RECEIPT_REFRESH_CHANGED_SETTLEMENT");
     const oldGas=BigInt(old.gasWei),newGas=BigInt(receipt.gasWei),totalGas=BigInt(o.gas_spent)-oldGas+newGas;
     if(totalGas<0n)throw new Error("GAS_ACCOUNTING_INVARIANT_BROKEN");
     const orderGas=receipt.complianceChecks?.find(c=>c.key==="order_gas_cap");
     if(orderGas){orderGas.actual=`${totalGas} wei cumulative`;orderGas.required=`at most ${m.maxGasWei} wei`;orderGas.status=receipt.gasCostVerified&&totalGas<=BigInt(m.maxGasWei)?"PASS":"FAIL";}
     receipt.mandateComplianceVerified=receipt.gasCostVerified&&(receipt.complianceChecks?.filter(c=>c.scope==="mandate").every(c=>c.status==="PASS")??receipt.mandateComplianceVerified)&&newGas<=BigInt(intent.gas_bound)&&totalGas<=BigInt(m.maxGasWei);
     if(!receipt.mandateComplianceVerified&&!receipt.notes.includes("MANDATE_COMPLIANCE_FAILED"))receipt.notes.push("MANDATE_COMPLIANCE_FAILED");
     receipt.notes=receipt.notes.filter(n=>n!=="ONLY_RECEIPT_GAS_COMPONENT_KNOWN_TOTAL_L2_FEE_UNVERIFIED"&&(receipt.mandateComplianceVerified||n!=="MANDATE_COMPLIANCE_FAILED"));
     const remaining=BigInt(o.budget)-BigInt(o.settled)-BigInt(o.reserved);
     let status=o.cancelled_at!==null?"CANCELLED":remaining===0n?"COMPLETED":"ACTIVE";
     let reason=receipt.mandateComplianceVerified?"Purchase finalized; token settlement and all mandate checks verified":"Purchase finalized and token settlement verified; fee or mandate verification still needs review. Do not retry this purchase.";
     if(!receipt.mandateComplianceVerified&&!['CANCELLED','EXPIRED'].includes(status))status="NEEDS_ATTENTION";
     const body=JSON.stringify(receipt);if(body===row.body)return this.get(id);
     this.db.prepare("UPDATE receipts SET body=?,created_at=? WHERE intent_id=?").run(body,now,intentId);
     this.db.prepare("DELETE FROM pending_receipts WHERE intent_id=?").run(intentId);
     this.db.prepare("UPDATE orders SET gas_spent=?,status=?,reason=?,next_check=NULL,updated_at=? WHERE id=?").run(totalGas.toString(),status,reason,now,id);
     this.event(id,"REVERIFIED",{intentId,transactionHash:tx.hash,feeMethod:receipt.feeMethod,gasWei:receipt.gasWei,mandateComplianceVerified:receipt.mandateComplianceVerified},now);
     return this.get(id);
   });
 }
 due(now:number) {return this.db.prepare(`SELECT id FROM orders WHERE ((reserved<>'0' OR status IN ('ACTIVE','WAITING')) AND (next_check IS NULL OR next_check<=?))
   OR EXISTS (SELECT 1 FROM fill_intents f JOIN receipts r ON r.intent_id=f.id WHERE f.order_id=orders.id AND (json_extract(r.body,'$.feeMethod')='PUBLIC_TESTNET_TOTAL_FEE_UNVERIFIED' OR COALESCE(json_extract(r.body,'$.verificationVersion'),0)<2 OR NOT EXISTS (SELECT 1 FROM json_each(r.body,'$.complianceChecks') c WHERE json_extract(c.value,'$.key')='partial_fill_policy')))
   ORDER BY created_at LIMIT 100`).all(now) as {id:string}[];}
 list(owner:string) {return this.db.prepare("SELECT * FROM orders WHERE owner=? ORDER BY created_at DESC LIMIT 100").all(owner) as OrderRow[];}
 view(id:string,owner:string) {
   const order=this.get(id);if(order.owner!==owner)throw new Error("FORBIDDEN");
   const receipts=(this.db.prepare("SELECT body FROM receipts WHERE intent_id IN (SELECT id FROM fill_intents WHERE order_id=?)").all(id) as {body:string}[]).map(r=>JSON.parse(r.body) as VerifiedReceipt);
   const latest=this.db.prepare("SELECT body FROM snapshots WHERE order_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(id) as {body:string}|undefined;
   const decision=this.db.prepare("SELECT origin,body,created_at FROM decisions WHERE order_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1").get(id) as {origin:string;body:string;created_at:number}|undefined;
   const d=decision?JSON.parse(decision.body) as Record<string,unknown>:null;
   const decisions=(this.db.prepare("SELECT origin,body,created_at FROM decisions WHERE order_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100").all(id) as {origin:string;body:string;created_at:number}[]).map(r=>({...r,body:JSON.parse(r.body)}));
   const pendingReceipts=(this.db.prepare("SELECT p.body FROM pending_receipts p JOIN fill_intents f ON f.id=p.intent_id WHERE f.order_id=? AND f.status IN ('RESERVED','PENDING','REVIEW')").all(id) as {body:string}[]).map(r=>JSON.parse(r.body));
   return {order,mandate:this.mandate(id),snapshot:latest?JSON.parse(latest.body):null,receipts:[...receipts,...pendingReceipts],decisions,
     latestDecision:decision&&d?{origin:decision.origin,createdAt:decision.created_at,kind:d.kind??"CHECK",outcome:d.outcome??null,action:d.action??null,synthetic:d.synthetic===true,label:d.label??null,evidenceProvenance:d.evidenceProvenance??null}:null,
     intents:this.db.prepare("SELECT id,status,amount,minimum_output,reference_round FROM fill_intents WHERE order_id=?").all(id),
     events:this.db.prepare("SELECT * FROM order_events WHERE order_id=? ORDER BY seq").all(id),
     aggregate:{spent:order.settled,reserved:order.reserved,available:(BigInt(order.budget)-BigInt(order.settled)-BigInt(order.reserved)).toString(),tokensReceived:order.received,gasWei:order.gas_spent,pending:order.reserved!=="0",settlementVerified:receipts.length>0&&order.reserved==="0"&&receipts.every(r=>r.settlementVerified),mandateComplianceVerified:receipts.length>0&&order.reserved==="0"&&receipts.every(r=>r.mandateComplianceVerified),evidenceModes:[...new Set(receipts.map(r=>r.mode))]},};
 }
}
