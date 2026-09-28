import "./env.js";
import { timingSafeEqual, createHash } from "node:crypto";
import { OrderStore } from "../orders/store.js";
const globalStore=globalThis as typeof globalThis & {fairtickStore?:OrderStore};
export function store(){return globalStore.fairtickStore??=(new OrderStore());}
export function authorize(request:Request) {
 const secret=process.env.OPERATOR_SECRET;
 if(!secret||secret.length<24)throw new Error("OPERATOR_SECRET_NOT_CONFIGURED");
 const actual=request.headers.get("authorization")?.replace(/^Bearer /,"")??"";
 const a=Buffer.from(actual),b=Buffer.from(secret);
 if(a.length!==b.length||!timingSafeEqual(a,b)) {
   const token=request.headers.get('cookie')?.match(/(?:^|;\s*)fairtick_session=([a-f0-9]{64})(?:;|$)/)?.[1];
   const valid=token&&store().db.prepare('SELECT 1 FROM operator_sessions WHERE token_hash=? AND expires_at>?').get(createHash('sha256').update(token+secret).digest('hex'),Math.floor(Date.now()/1000));
   if(!valid)throw new Error("UNAUTHORIZED");
 }
 if(request.method!=="GET") {
   const origin=request.headers.get("origin");
   // Next may normalize request.url to localhost behind its internal server.
   // Compare the browser origin to the incoming host, or a configured public
   // origin for reverse-proxy deployments. Never trust x-forwarded-host here.
   if(origin){const parsed=new URL(origin),configured=process.env.APP_ORIGIN;
     if(!["http:","https:"].includes(parsed.protocol)||(configured?parsed.origin!==new URL(configured).origin:parsed.host.toLowerCase()!==(request.headers.get("host")??new URL(request.url).host).toLowerCase()))throw new Error("ORIGIN_MISMATCH");
   }
 }
 return "operator";
}
export function failure(error:unknown) {
 const code=error instanceof Error?error.message:"REQUEST_FAILED";
 const exposed=["UNAUTHORIZED","OPERATOR_SECRET_NOT_CONFIGURED","ORIGIN_MISMATCH","ORDER_NOT_FOUND","FORBIDDEN","IDEMPOTENCY_CONFLICT","SINGLE_OPERATOR_WALLET_ONLY","SIGNER_MISMATCH","BODY_TOO_LARGE","INVALID_CONFIRMATION_TIME"];
 return Response.json({error:exposed.includes(code)?code:"INVALID_REQUEST_OR_STORAGE_ERROR"},{status:code==="UNAUTHORIZED"?401:code==="OPERATOR_SECRET_NOT_CONFIGURED"?503:code==="ORDER_NOT_FOUND"?404:400});
}
export async function body(request:Request) {const text=await request.text();if(text.length>16000)throw new Error("BODY_TOO_LARGE");return JSON.parse(text);}
