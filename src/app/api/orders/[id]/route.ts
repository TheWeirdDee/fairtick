import { authorize,failure,store } from "../../../../lib/server.js";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{return Response.json(store().view((await context.params).id,authorize(request)));}catch(e){return failure(e);}}
export async function DELETE(request:Request,context:{params:Promise<{id:string}>}){try{return Response.json({order:store().cancel((await context.params).id,authorize(request),Math.floor(Date.now()/1000))});}catch(e){return failure(e);}}
