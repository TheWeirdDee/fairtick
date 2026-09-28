import { OrderStore } from "../src/orders/store.js";
import { processOrder, liveDependencies } from "../src/orders/worker.js";
import { activeNetwork } from "../src/lib/network.js";
import { testnetDependencies } from "../src/orders/testnet.js";
const net=activeNetwork();
const store=new OrderStore();let stopping=false;
// Mainnet keeps the unchanged live dependencies (no executor exists for them).
const deps=net.name==="testnet"?testnetDependencies(store):liveDependencies;
const heartbeat=setInterval(()=>store.heartbeat(Math.floor(Date.now()/1000),!!deps.executor),15000);
store.heartbeat(Math.floor(Date.now()/1000),!!deps.executor);
process.on("SIGINT",()=>{stopping=true;});process.on("SIGTERM",()=>{stopping=true;});
console.log(net.name==="testnet"
 ?`FairTick worker: ${net.label}. ${net.notice} Testnet signing ${deps.executor?"ENABLED (chain 46630 only)":"DISABLED (set FAIRTICK_TESTNET_EXECUTE=true)"}.`
 :"FairTick worker: durable checks/reconciliation; signing and broadcasting DISABLED");
try {do {
 const now=Math.floor(Date.now()/1000);
 for(const {id} of store.due(now)){if(stopping)break;console.log(JSON.stringify({order:id,result:await processOrder(store,id,deps)}));}
 if(process.argv.includes("--once"))break;
 await new Promise(r=>setTimeout(r,1000));
}while(!stopping);}finally{clearInterval(heartbeat);store.heartbeat(0,false);store.close();}
