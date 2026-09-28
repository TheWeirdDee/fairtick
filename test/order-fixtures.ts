import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import type { ExecutionMandate, ExecutionEvidence } from "../src/engine/executionValidator.js";
import { RECEIPT_ABI, type ChainEvidence } from "../src/engine/receipt.js";
import type { IntentRow } from "../src/orders/store.js";
import type { MarketSnapshot } from "../src/engine/types.js";
import type { ExecutionPrerequisites, Planner } from "../src/orders/worker.js";
import { sessionAt } from "../src/engine/session.js";
import { attestLive } from "../src/engine/provenance.js";
// Entire file is SYNTHETIC. These are not mainnet fills or market observations.
/** TEST DOUBLE standing in for a live adapter's attestation, only so tests can exercise
 * live-path mechanics (reservation, settlement). The data stays synthetic; production
 * attestations come only from the live adapters (checked by test/provenance.test.ts). */
export function liveTestDouble<T extends object>(value: T):T&{provenance:"LIVE"} { return attestLive({...value,provenance:"LIVE" as const}); }
export const NOW=Date.parse("2026-09-24T15:00:00Z")/1000;
export const address=(n:number)=>`0x${n.toString(16).padStart(40,"0")}` as `0x${string}`;
export function fixture(id="order-1",mode:"buy_now"|"work_my_order"="work_my_order") {
 const route={chainId:4663 as const,token:address(2),quoteToken:address(1),pool:address(3),router:address(4),fee:500,tokenDecimals:18,quoteDecimals:6 as const};
 const mandate:ExecutionMandate={orderId:id,version:1,owner:"operator",mode,side:"BUY",signer:address(5),recipient:address(6),route,budget:"100000000",maxPerFill:"25000000",minimumFill:"1000000",partialFillAllowed:true,maxPriceMicroUsdg:"250000000",maxPremiumBps:15,usdgParityAccepted:true,minCheapBps:0,closedPolicy:"WAIT",maxSlippageBps:30,maxPriceImpactBps:100,maxFeedAgeSeconds:900,maxQuoteAgeSeconds:60,maxBlockAgeSeconds:30,confirmedAt:NOW-60,expiresAt:NOW+3600,maxFillCount:10,maxAttempts:20,maxGasWei:"1000000",minimumGasReserveWei:"1000"};
 const evidence:ExecutionEvidence={route,blockHash:`0x${"a".repeat(64)}`,blockNumber:"1",blockTimestamp:NOW,capturedAt:NOW,routeBytecodePresent:true,evidenceBlockFresh:true,reference:{answer:"25000000000",decimals:8,roundId:"1",answeredInRound:"1",updatedAt:NOW-10,oraclePaused:false,multiplierTransition:false},tradingHalt:false,corporateActionPending:false,quote:{amountIn:"25000000",amountOut:"100100000000000000",priceImpactBps:5},gasUpperBoundWei:"10000",walletGasBalanceWei:"100000",walletUsdgBalance:"100000000",allowance:"100000000",provenance:"SYNTHETIC"};
 return {mandate,evidence};
}
export const HASH=`0x${"b".repeat(64)}`;
export function chainFixture(m:ExecutionMandate,intent:IntentRow,hash=HASH,nonce=1,out=100100000000000000n):ChainEvidence {
 const amount=BigInt(intent.amount);
 const transfer=(token:string,from:`0x${string}`,to:`0x${string}`,value:bigint)=>({address:token,topics:encodeEventTopics({abi:RECEIPT_ABI,eventName:"Transfer",args:{from,to}}) as Hex[],data:encodeAbiParameters([{type:"uint256"}],[value])});
 return {chainId:4663,transactionHash:hash,from:m.signer,to:m.route.router,input:JSON.parse(intent.request).data,nonce,value:0n,status:"success",blockNumber:2n,blockHash:`0x${"c".repeat(64)}`,blockTimestamp:NOW+1,canonicalBlockHash:`0x${"c".repeat(64)}`,finalized:true,gasUsed:1000n,effectiveGasPrice:1n,totalFeeWei:1000n,referenceAtInclusion:{synthetic:true,round:"2"},logs:[
 transfer(m.route.quoteToken,m.signer as `0x${string}`,m.route.pool as `0x${string}`,amount),transfer(m.route.token,m.route.pool as `0x${string}`,m.recipient as `0x${string}`,out),
 {address:m.route.pool,topics:encodeEventTopics({abi:RECEIPT_ABI,eventName:"Swap",args:{sender:m.route.router as `0x${string}`,recipient:m.recipient as `0x${string}`}}) as Hex[],data:encodeAbiParameters([{type:"int256"},{type:"int256"},{type:"uint160"},{type:"uint128"},{type:"int24"}],[amount,-out,1n,1n,0])},
 ]};
}
/** For worker tests that must never reach planning: an explicit SYNTHETIC
 * planner and all-unmeasured prerequisites, never a real SERV call. */
export const unreachedPlanner:Planner=async()=>({status:"BLOCKED",reason:"SYNTHETIC_PLANNER_NOT_EXPECTED",transactionAuthorized:false,synthetic:true});
export const unavailablePrerequisites=async():Promise<ExecutionPrerequisites>=>({routeBytecodePresent:null,evidenceBlockFresh:null,walletGasBalanceWei:null,walletUsdgBalance:null,allowance:null,gasUpperBoundWei:null,fee:null,reasons:["SYNTHETIC_PREREQUISITES_UNMEASURED"],provenance:"SYNTHETIC"});
export const offPath={plan:unreachedPlanner,prerequisites:unavailablePrerequisites};
/** SYNTHETIC prerequisites that satisfy the validator for fixture() amounts. */
export const passingPrerequisites=async():Promise<ExecutionPrerequisites>=>({routeBytecodePresent:true,evidenceBlockFresh:true,walletGasBalanceWei:"100000",walletUsdgBalance:"100000000",allowance:"100000000",gasUpperBoundWei:"10000",fee:null,reasons:[],provenance:"SYNTHETIC"});
/** SYNTHETIC snapshot passing every deterministic check at `at` for mandate `m`
 * (same numbers as the validator fixture: 25 USDG -> 0.1001 token vs 250 USDG cap). */
export function usableSnapshot(m:ExecutionMandate,at:number,overrides:Partial<MarketSnapshot>={}):MarketSnapshot {
 return {capturedAt:new Date(at*1000).toISOString(),chainId:4663,blockNumber:"1",blockHash:`0x${"a".repeat(64)}`,symbol:"NVDA",token:m.route.token as `0x${string}`,feedProxy:address(7),pool:m.route.pool as `0x${string}`,poolFeeTier:m.route.fee,quoteToken:"USDG",
  referenceStatus:"USABLE",feedPriceUsd:250,feedDecimals:8,feedAnswerRaw:"25000000000",blockTimestamp:at,oraclePaused:false,pendingMultiplierRaw:"1000000000000000000",multiplierEffectiveAt:0,multiplierState:"CONSISTENT",feedRoundId:"1",feedUpdatedAt:at-10,feedAgeSeconds:10,uiMultiplier:"1000000000000000000",
  dexSpotPriceUsdg:249.7,executableQuote:{inputUsdgBaseUnits:"25000000",outputTokenBaseUnits:"100100000000000000",effectivePriceUsdgPerToken:249.75,priceImpactBps:5,gasEstimateUnits:null},premiumBps:-1,poolTvlUsdgSide:null,tradingHalt:false,pendingCorporateAction:false,
  session:sessionAt(new Date(at*1000)),notes:["SYNTHETIC"],provenance:"SYNTHETIC",...overrides};
}
