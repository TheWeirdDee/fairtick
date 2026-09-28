import { authorize,body,failure,store } from "../../../lib/server.js";
import { allowedRoute } from "../../../orders/config.js";
import { executionMandateSchema } from "../../../engine/executionValidator.js";
import { configuredSender, networkSummary } from "../../../lib/network.js";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){try{const owner=authorize(request);return Response.json({orders:store().list(owner),route:allowedRoute(),sender:configuredSender()??null});}catch(e){return failure(e);}}
export async function POST(request:Request){try{
 const owner=authorize(request),data=await body(request),now=Math.floor(Date.now()/1000);
 const m=executionMandateSchema.parse({...data,owner,route:allowedRoute()});
 const sender=configuredSender();
 if(sender&&m.signer.toLowerCase()!==sender.toLowerCase())throw new Error("SIGNER_MISMATCH");
 if(m.expiresAt>now+7*86400||now-m.confirmedAt>300)throw new Error("INVALID_CONFIRMATION_TIME");
 // Mainnet: always false. Testnet: whether this environment enables mock-market signing.
 return Response.json({order:store().create(m,now),executionEnabled:networkSummary().executionEnabled},{status:201});
}catch(e){return failure(e);}}
