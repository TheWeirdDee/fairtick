// Read-only alternate-asset investigation. Never changes the single-asset registry.
import { writeFileSync,mkdirSync } from "node:fs";
import { parseAbi,type Address } from "viem";
import { getPublicClient,CORE_ADDRESSES } from "../src/lib/chain.js";
const c=getPublicClient(),symbol="SPY";
const report:Record<string,unknown>={symbol,observedAt:new Date().toISOString(),mode:"live_candidate_only",freshnessLimitSeconds:900,registryChanged:false};
try {
 const sources=["https://api.robinhood.com/rhj/assets","https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json"];
 const bodies=await Promise.all(sources.map(async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error();return r.json();}));
 const asset=bodies[0].assets.find((a:{tokenSymbol:string})=>a.tokenSymbol===symbol);
 const feed=bodies[1].find((f:{docs?:{baseAsset?:string}})=>f.docs?.baseAsset===symbol);
 const token=asset.deployments.find((d:{chainId:number})=>d.chainId===4663).contractAddress as Address;
 const chainId=await c.getChainId();if(chainId!==4663)throw new Error();const block=await c.getBlock();
 const read=(address:Address,signature:string,functionName:string,args?:readonly unknown[])=>c.readContract({address,abi:parseAbi([signature]),functionName,args,blockNumber:block.number});
 const round=await read(feed.proxyAddress,"function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)","latestRoundData") as bigint[];
 const [paused,multiplier,pending,effectiveAt]=await Promise.all([
 read(token,"function oraclePaused() view returns (bool)","oraclePaused"),read(token,"function uiMultiplier() view returns (uint256)","uiMultiplier"),read(token,"function newUIMultiplier() view returns (uint256)","newUIMultiplier"),read(token,"function effectiveAt() view returns (uint256)","effectiveAt"),
 ]);
 report.sources=sources;report.token=token;report.feed=feed.proxyAddress;report.block={number:String(block.number),hash:block.hash,timestamp:Number(block.timestamp)};
 report.reference={round:round.map(String),ageSeconds:Number(block.timestamp-round[3]!),usable:round[1]!>0n&&Number(block.timestamp-round[3]!)>=0&&Number(block.timestamp-round[3]!)<=900&&paused===false};
 report.oracle={paused,multiplier:String(multiplier),pending:String(pending),effectiveAt:String(effectiveAt)};
 const pools=[];
 for(const fee of [100,500,3000,10000]) {
   const pool=await read(CORE_ADDRESSES.uniswapV3Factory,"function getPool(address,address,uint24) view returns (address)","getPool",[token,CORE_ADDRESSES.usdg,fee]) as Address;
   if(BigInt(pool)===0n)continue;
   const liquidity=await read(pool,"function liquidity() view returns (uint128)","liquidity");
   if(BigInt(String(liquidity))===0n)continue;
   try{const q=await c.simulateContract({address:CORE_ADDRESSES.uniswapV3QuoterV2,abi:parseAbi(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256,uint160,uint32,uint256)"]),functionName:"quoteExactInputSingle",args:[{tokenIn:CORE_ADDRESSES.usdg,tokenOut:token,amountIn:25000000n,fee,sqrtPriceLimitX96:0n}],blockNumber:block.number});pools.push({pool,fee,liquidity:String(liquidity),amountIn:"25000000",quote:q.result.map(String)});}catch{pools.push({pool,fee,liquidity:String(liquidity),quote:"UNAVAILABLE"});}
 }
 report.pools=pools;
 // Same halt/corporate-action sources and freshness rule as the live quote
 // adapter (src/engine/quote.ts), so SPY is checked on equal terms to NVDA.
 let tradingHalt:boolean|null=null,pendingCorporateAction:boolean|null=null;
 const metadata=await Promise.allSettled([
   fetch(`https://api.robinhood.com/rhj/prices/${symbol}`,{signal:AbortSignal.timeout(10000)}).then(async r=>{if(!r.ok)throw new Error();return r.json();}),
   fetch("https://api.robinhood.com/rhj/corporate-actions",{signal:AbortSignal.timeout(10000)}).then(async r=>{if(!r.ok)throw new Error();return r.json();}),
 ]);
 const prices=metadata[0];
 if(prices.status==="fulfilled"&&Array.isArray(prices.value?.quotes)) {
   const row=prices.value.quotes.find((q:{tokenSymbol?:string})=>q.tokenSymbol===symbol);
   const age=Date.now()-Date.parse(row?.generatedAt);
   if(typeof row?.isTradingHalt==="boolean"&&age>=0&&age<=60000)tradingHalt=row.isTradingHalt;
 }
 const actions=metadata[1];
 if(actions.status==="fulfilled"&&Array.isArray(actions.value?.corpActions)) {
   pendingCorporateAction=actions.value.corpActions.some((a:{tokenSymbol?:string;status?:string})=>a.tokenSymbol===symbol&&a.status==="CORPORATE_ACTION_STATUS_IN_PROGRESS");
 }
 report.tradingHalt=tradingHalt;report.pendingCorporateAction=pendingCorporateAction;
 if(tradingHalt===null)report.tradingHaltNote="UNAVAILABLE_WITHIN_FRESHNESS_WINDOW";
 if(pendingCorporateAction===null)report.corporateActionNote="UNAVAILABLE";
 const referenceOk=(report.reference as {usable:boolean}).usable;
 const routeOk=pools.some(p=>"quote" in p && Array.isArray(p.quote));
 report.eligibleForPromotion=referenceOk&&tradingHalt===false&&pendingCorporateAction===false&&routeOk;
 report.status="INVESTIGATED_NOT_ENABLED";
}catch{report.status="PROBE_INCOMPLETE";}
mkdirSync("data/evidence",{recursive:true});const file=`data/evidence/candidate-${symbol}-${Date.now()}.json`;writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify({file,...report},null,2));
