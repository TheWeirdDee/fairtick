import { randomBytes, createHash } from 'node:crypto';
import { authorize, failure, store } from '../../../lib/server';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const cookie=(value:string,request:Request,age:number)=>`fairtick_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${(process.env.APP_ORIGIN??request.url).startsWith('https:')?'; Secure':''}`;
export async function GET(request:Request){try{authorize(request);return Response.json({authenticated:true});}catch(e){return failure(e);}}
export async function POST(request:Request){try{
 authorize(request);
 const token=randomBytes(32).toString('hex'),now=Math.floor(Date.now()/1000);
 store().db.prepare('DELETE FROM operator_sessions WHERE expires_at<=?').run(now);
 store().db.prepare('INSERT INTO operator_sessions VALUES(?,?)').run(createHash('sha256').update(token+process.env.OPERATOR_SECRET).digest('hex'),now+8*3600);
 return Response.json({authenticated:true},{headers:{'Set-Cookie':cookie(token,request,8*3600),'Cache-Control':'no-store'}});
}catch(e){return failure(e);}}
export async function DELETE(request:Request){try{
 authorize(request);
 const token=request.headers.get('cookie')?.match(/(?:^|;\s*)fairtick_session=([a-f0-9]{64})(?:;|$)/)?.[1];
 if(token)store().db.prepare('DELETE FROM operator_sessions WHERE token_hash=?').run(createHash('sha256').update(token+process.env.OPERATOR_SECRET).digest('hex'));
 return Response.json({authenticated:false},{headers:{'Set-Cookie':cookie('',request,0)}});
}catch(e){return failure(e);}}
