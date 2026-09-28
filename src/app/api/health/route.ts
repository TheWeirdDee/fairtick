import "../../../lib/env.js";
import { configuredSender, networkSummary } from "../../../lib/network.js";
import { store } from '../../../lib/server';
export const dynamic="force-dynamic";
export async function GET(){
 const n=networkSummary();let senderPresent=false;try{senderPresent=Boolean(configuredSender());}catch{senderPresent=false;}
 // Mainnet: execution is always disabled in this build. Testnet: mock demo market only.
 try {const worker=store().workerHealth(Math.floor(Date.now()/1000));return Response.json({...n,executionEnabled:worker.executionEnabled,worker,servKeyPresent:Boolean(process.env.SERV_API_KEY),senderPresent,operatorConfigured:(process.env.OPERATOR_SECRET?.length??0)>=24,workerRequired:true},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'SERVICE_UNAVAILABLE'},{status:503});}
}
