import { decodeEventLog, decodeFunctionData, keccak256, parseAbi, type Hex } from "viem";
import { ROUTER_ABI } from "./prepareBuy.js";
import type { ExecutionMandate } from "./executionValidator.js";
import { mandateDigest } from "./executionValidator.js";
import { createHash } from "node:crypto";
export const RECEIPT_ABI = parseAbi([
 "event Transfer(address indexed from,address indexed to,uint256 value)",
 "event Swap(address indexed sender,address indexed recipient,int256 amount0,int256 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick)",
]);
export interface VerifiedReceipt {
 intentId:string;transactionHash:string;mode:"live"|"synthetic";outcome:"SETTLED"|"REVERTED"|"UNVERIFIED";
 included?:boolean;finalized:boolean;settlementVerified:boolean;mandateComplianceVerified:boolean;amountIn:string;amountOut:string;gasWei:string;
 blockNumber:string;blockHash:string;referenceRound:string;referenceAtInclusion:unknown;notes:string[];
 mandateHash:string;evidenceHash:string;decisionOrigin:"code";
 gasCostVerified:boolean;
 /** Which chain and what kind of market this receipt is about. Absent on legacy mainnet receipts. */
 environment?:ReceiptEnvironment;
 feeMethod?:string|null;
 complianceChecks?:ReceiptCheck[];
 verificationVersion?:number;
}
export interface ReceiptCheck { key:string; label:string; status:"PASS"|"FAIL"|"UNKNOWN"; actual:string; required:string; scope:"settlement"|"mandate"|"fee" }
export interface ReceiptEnvironment { network:string; chainId:number; marketData:"LIVE_OFFICIAL"|"TESTNET_MOCK"; notice:string|null }
export interface ChainEvidence {
 chainId:number;transactionHash:string;from:string;to:string;input:Hex;nonce:number;value:bigint;
 status:"success"|"reverted";blockNumber:bigint;blockHash:string;blockTimestamp:number;
 canonicalBlockHash:string;finalized:boolean;gasUsed:bigint;effectiveGasPrice:bigint;
 totalFeeWei:bigint|null;
 gasUsedForL1?:bigint|null;
 logs:{address:string;data:Hex;topics:readonly Hex[];removed?:boolean}[];
 referenceAtInclusion:unknown;
 environment?:ReceiptEnvironment;
 feeMethod?:string|null;
}
const same=(a:string,b:string)=>a.toLowerCase()===b.toLowerCase();
/** Reconstruct only the allowlisted single-hop route. Unknown/reorged evidence
 * keeps funds reserved. Synthetic callers must label their evidence explicitly. */
export function verifyReceipt(m:ExecutionMandate, intent:{id:string;amount:string;gas_bound:string;minimum_output:string;reference_round:string;deadline:number;request:string;evidence:string}, tx:{hash:string;nonce:number}, chain:ChainEvidence, mode:"live"|"synthetic"):VerifiedReceipt {
 const result:VerifiedReceipt={intentId:intent.id,transactionHash:chain.transactionHash,mode,outcome:"UNVERIFIED",finalized:false,settlementVerified:false,mandateComplianceVerified:false,amountIn:"0",amountOut:"0",gasWei:(chain.totalFeeWei??chain.gasUsed*chain.effectiveGasPrice).toString(),gasCostVerified:chain.totalFeeWei!==null,blockNumber:chain.blockNumber.toString(),blockHash:chain.blockHash,referenceRound:intent.reference_round,referenceAtInclusion:chain.referenceAtInclusion,notes:[],mandateHash:mandateDigest(m),evidenceHash:`0x${createHash("sha256").update(intent.evidence).digest("hex")}`,decisionOrigin:"code",complianceChecks:[],verificationVersion:2,...(chain.environment?{environment:chain.environment,feeMethod:chain.feeMethod??null}:{})};
 const check=(key:string,label:string,status:ReceiptCheck["status"],actual:string,required:string,scope:ReceiptCheck["scope"])=>result.complianceChecks!.push({key,label,status,actual,required,scope});
 if(chain.environment?.marketData==="TESTNET_MOCK")result.notes.push("TESTNET_MOCK_MARKET_RECEIPT: mock tokens with no value; not a stock purchase and not market data");
 const fail=(note:string)=>{result.notes.push(note);return result;};
 const identity=chain.chainId===m.route.chainId&&same(chain.transactionHash,tx.hash)&&same(chain.from,m.signer)&&same(chain.to,m.route.router)&&chain.nonce===tx.nonce&&chain.value===0n;
 check("transaction_identity","Transaction identity",identity?"PASS":"FAIL",`chain=${chain.chainId}; hash=${chain.transactionHash}; from=${chain.from}; to=${chain.to}; nonce=${chain.nonce}; value=${chain.value}`,`chain=${m.route.chainId}; hash=${tx.hash}; from=${m.signer}; to=${m.route.router}; nonce=${tx.nonce}; value=0`,"settlement");
 if(!identity)return fail("TRANSACTION_IDENTITY_MISMATCH");
 result.included=same(chain.blockHash,chain.canonicalBlockHash)&&!chain.logs.some(l=>l.removed);
 check("canonical_inclusion","Canonical inclusion",result.included?"PASS":"FAIL",`receipt=${chain.blockHash}; canonical=${chain.canonicalBlockHash}`,"matching block hashes and no removed logs","settlement");
 check("finality","Finality",chain.finalized?"PASS":"FAIL",chain.finalized?"finalized":"not finalized","finalized block at or above inclusion block","settlement");
 if(!chain.finalized||!result.included)return fail("INCLUSION_NOT_FINALIZED_OR_REORGED");
 if(chain.gasUsed<0n||chain.effectiveGasPrice<0n)return fail("INVALID_GAS_EVIDENCE");
 if(chain.totalFeeWei!==null&&chain.totalFeeWei<chain.gasUsed*chain.effectiveGasPrice)return fail("INVALID_TOTAL_GAS_EVIDENCE");
 check("fee_verification","Actual transaction fee",result.gasCostVerified?"PASS":"UNKNOWN",result.gasCostVerified?`${result.gasWei} wei via ${chain.feeMethod??"receipt semantics"}`:`${result.gasWei} wei receipt component only`,"transaction-specific total fee from supported receipt semantics","fee");
 if(!result.gasCostVerified)result.notes.push("ONLY_RECEIPT_GAS_COMPONENT_KNOWN_TOTAL_L2_FEE_UNVERIFIED");
 const expected=JSON.parse(intent.request) as {data:string};
 const calldataMatches=same(chain.input,expected.data);check("calldata_identity","Reserved calldata",calldataMatches?"PASS":"FAIL",`calldata hash ${keccak256(chain.input)}`,`reserved calldata hash ${keccak256(expected.data as Hex)}`,"settlement");
 if(!calldataMatches)return fail("CALLDATA_MISMATCH");
 result.finalized=true;
 check("transaction_execution","Transaction execution",chain.status==="success"?"PASS":"FAIL",chain.status,"successful execution","settlement");
 if(chain.status==="reverted") {result.outcome="REVERTED";result.mandateComplianceVerified=result.gasCostVerified&&BigInt(result.gasWei)<=BigInt(intent.gas_bound);result.notes.push("REVERTED_NO_SWAP_SETTLEMENT");return result;}
 try {
   const outer=decodeFunctionData({abi:ROUTER_ABI,data:chain.input});
   if(outer.functionName!=="multicall"||outer.args[1].length!==1||outer.args[0]!==BigInt(intent.deadline))return fail("UNSUPPORTED_ROUTE_CALLDATA");
   const inner=decodeFunctionData({abi:ROUTER_ABI,data:outer.args[1][0]!});
   if(inner.functionName!=="exactInputSingle")return fail("UNSUPPORTED_SWAP");
   const p=inner.args[0];
   const routeMatches=same(p.tokenIn,m.route.quoteToken)&&same(p.tokenOut,m.route.token)&&same(p.recipient,m.recipient)&&p.fee===m.route.fee&&p.amountIn===BigInt(intent.amount)&&p.amountOutMinimum===BigInt(intent.minimum_output)&&p.sqrtPriceLimitX96===0n;
   check("route_constraints","Allowlisted route and signed bounds",routeMatches?"PASS":"FAIL",`tokenIn=${p.tokenIn}; tokenOut=${p.tokenOut}; recipient=${p.recipient}; fee=${p.fee}; amountIn=${p.amountIn}; minimumOut=${p.amountOutMinimum}`,`tokenIn=${m.route.quoteToken}; tokenOut=${m.route.token}; recipient=${m.recipient}; fee=${m.route.fee}; amountIn=${intent.amount}; minimumOut=${intent.minimum_output}`,"mandate");
   if(!routeMatches)return fail("TRANSACTION_BOUNDS_MISMATCH");
   let spent=0n,received=0n,swaps=0,poolInput=0n,poolOutput=0n;
   for(const log of chain.logs) {
     if(![m.route.token,m.route.quoteToken,m.route.pool].some(a=>same(a,log.address)))continue;
     let event;try{event=decodeEventLog({abi:RECEIPT_ABI,data:log.data,topics:log.topics as [Hex,...Hex[]]});}catch{continue;}
     if(event.eventName==="Transfer") {
       const {from,to,value}=event.args;
       if(same(log.address,m.route.quoteToken)) {
         if(same(from,m.signer)) {if(!same(to,m.route.pool))return fail("UNEXPECTED_USDG_DESTINATION");spent+=value;}
         if(same(to,m.signer))spent-=value;
       }
       if(same(log.address,m.route.token)) {
         if(same(to,m.recipient)) {if(!same(from,m.route.pool))return fail("UNEXPECTED_TOKEN_SOURCE");received+=value;}
         if(same(from,m.recipient))received-=value;
       }
     } else if(same(log.address,m.route.pool)) {
       if(!same(event.args.sender,m.route.router)||!same(event.args.recipient,m.recipient))return fail("SWAP_PROVENANCE_MISMATCH");
       const quoteIs0=BigInt(m.route.quoteToken)<BigInt(m.route.token);
       poolInput+=quoteIs0?event.args.amount0:event.args.amount1;
       poolOutput-=quoteIs0?event.args.amount1:event.args.amount0;swaps++;
     }
   }
   const provenanceOk=swaps===1&&spent>0n&&received>0n&&spent===poolInput&&received===poolOutput;
   check("token_settlement","Token settlement and pool provenance",provenanceOk?"PASS":"FAIL",`swaps=${swaps}; spent=${spent}; poolInput=${poolInput}; received=${received}; poolOutput=${poolOutput}`,"one allowlisted pool swap; wallet transfers equal pool amounts","settlement");
   if(!provenanceOk)return fail("WALLET_POOL_AMOUNTS_DISAGREE");
   result.outcome="SETTLED";result.settlementVerified=true;result.amountIn=spent.toString();result.amountOut=received.toString();
   const addMandate=(key:string,label:string,ok:boolean,actual:string,required:string)=>check(key,label,ok?"PASS":"FAIL",actual,required,"mandate");
   addMandate("amount_in","Authorized input amount",spent===BigInt(intent.amount),`${spent} base units`,`exactly ${intent.amount} base units`);
   addMandate("partial_fill_policy","Partial-fill policy",m.partialFillAllowed?spent>0n&&spent<=BigInt(intent.amount):spent===BigInt(intent.amount),`${spent} of ${intent.amount} base units spent; partialFillAllowed=${m.partialFillAllowed}`,m.partialFillAllowed?"positive fill no greater than the reserved amount":"full reserved amount required");
   addMandate("minimum_output","Minimum token output",received>=BigInt(intent.minimum_output),`${received} base units`,`at least ${intent.minimum_output} base units`);
   addMandate("execution_deadline","Signed execution deadline",chain.blockTimestamp<=intent.deadline,`block timestamp ${chain.blockTimestamp}`,`at or before ${intent.deadline}`);
   addMandate("mandate_expiry","Mandate expiry",chain.blockTimestamp<=m.expiresAt,`block timestamp ${chain.blockTimestamp}`,`before ${m.expiresAt}`);
   addMandate("intent_fee_bound","Reserved transaction fee bound",result.gasCostVerified&&BigInt(result.gasWei)<=BigInt(intent.gas_bound),result.gasCostVerified?`${result.gasWei} wei`:"actual total fee unavailable",`at most ${intent.gas_bound} wei`);
   addMandate("order_gas_cap","Order gas cap",result.gasCostVerified&&BigInt(result.gasWei)<=BigInt(m.maxGasWei),result.gasCostVerified?`${result.gasWei} wei`:"actual total fee unavailable",`at most ${m.maxGasWei} wei`);
   const priceOk=m.maxPriceMicroUsdg===null||spent*10n**BigInt(m.route.tokenDecimals)<=received*BigInt(m.maxPriceMicroUsdg);
   addMandate("maximum_price","Maximum effective price",priceOk,`${spent*10n**BigInt(m.route.tokenDecimals)/received} mUSDG base units per whole token`,m.maxPriceMicroUsdg===null?"no maximum":`at most ${m.maxPriceMicroUsdg} mUSDG base units per whole token`);
   check("inclusion_reference","Reference evidence at inclusion",chain.referenceAtInclusion===null?"UNKNOWN":"PASS",chain.referenceAtInclusion===null?"unavailable":`committed round ${intent.reference_round} with inclusion snapshot present`,"inclusion-block reference snapshot retained; informational, not continuous oracle enforcement","settlement");
   result.mandateComplianceVerified=result.complianceChecks!.filter(c=>c.scope==="mandate").every(c=>c.status==="PASS")&&result.gasCostVerified;
   result.notes.push("COMMITTED_REFERENCE_ROUND_NOT_CONTINUOUS_ORACLE_ENFORCEMENT");
   if(chain.referenceAtInclusion===null)result.notes.push("INCLUSION_REFERENCE_UNAVAILABLE");
   if(!result.mandateComplianceVerified)result.notes.push("MANDATE_COMPLIANCE_FAILED");
   return result;
 }catch{return fail("RECEIPT_DECODE_FAILED");}
}
