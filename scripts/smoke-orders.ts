// HTTP + separate worker smoke test. Mandates/sender are SYNTHETIC; quote data is
// fetched live. Uses an isolated temporary database, never the operator database.
import { spawn } from "node:child_process";
import { mkdtempSync,writeFileSync,mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { chromium,expect,type Browser } from "@playwright/test";
import { fixture } from "../test/order-fixtures.js";
if(process.argv.includes("--browser")){
  await import("./release-browser.js");
  process.exit(0);
}
const dir=mkdtempSync(join(tmpdir(),"fairtick-http-")),secret=randomBytes(32).toString("hex");
const probe=createServer();await new Promise<void>(r=>probe.listen(0,"127.0.0.1",r));
const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
const origin=`http://127.0.0.1:${port}`;
const env={...process.env,FAIRTICK_NETWORK:"mainnet",SERV_API_KEY:"",FAIRTICK_TESTNET_EXECUTE:"false",DATABASE_PATH:join(dir,"orders.db"),OPERATOR_SECRET:secret,RH_SENDER_ADDRESS:fixture().mandate.signer,EXECUTE_LIVE:"false"};
const web=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p",String(port)],{env,stdio:"ignore",windowsHide:true});
let browser:Browser|undefined;let guiId:string|undefined;
async function api(path:string,method="GET",data?:unknown,auth=true){const r=await fetch(origin+path,{method,headers:{...(auth?{Authorization:`Bearer ${secret}`}:{ }),"Content-Type":"application/json"},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,body:await r.json()};}
function worker(){return new Promise<void>((yes,no)=>{const p=spawn(process.execPath,["node_modules/tsx/dist/cli.mjs","scripts/worker.ts","--once"],{env,stdio:"ignore",windowsHide:true});p.on("exit",code=>code===0?yes():no(new Error("Worker failed")));p.on("error",no);});}
try{
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+"/api/health")).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,300));}assert(ready,"web startup");
 const html=await (await fetch(origin)).text();assert(html.includes("Set your purchase limits."));
 assert.equal((await api("/api/orders","GET",undefined,false)).status,401);
 if(process.argv.includes("--browser")){
   console.log("Browser: confirming synthetic order");
   browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||"msedge",headless:true,timeout:20000});
   const page=await browser.newPage({viewport:{width:1280,height:900}});
   await page.goto(origin);await page.getByLabel("Operator secret").fill(secret);await page.getByRole("button",{name:"Open desk"}).click();
   await expect(page.getByRole("heading",{name:"Approve an order"})).toBeVisible();
   await page.getByRole("combobox").selectOption("work_my_order");
   await page.getByRole("button",{name:"Review instructions"}).click();
   const response=page.waitForResponse(r=>r.url().endsWith("/api/orders")&&r.request().method()==="POST");
   await page.getByRole("button",{name:"Confirm observation-only order"}).click();const confirmation=await response;const confirmedBody=await confirmation.json();
   if(!confirmedBody.order)throw new Error(JSON.stringify({status:confirmation.status(),body:confirmedBody,syntheticMandate:confirmation.request().postDataJSON()}));
   guiId=confirmedBody.order.id;
   await expect(page.getByRole("heading",{name:"ACTIVE",exact:true})).toBeVisible();
   await browser.close();browser=undefined;console.log("Browser closed; starting independent workers");
 }
 const now=Math.floor(Date.now()/1000);
 for(const mode of ["buy_now","work_my_order"] as const){const m={...fixture(mode,mode).mandate,confirmedAt:now,expiresAt:now+3600};assert.equal((await api("/api/orders","POST",m)).status,201);assert.equal((await api("/api/orders","POST",m)).status,201);}
 // No page polling or browser drives this worker process.
 await Promise.all([worker(),worker()]);
 const buy=(await api("/api/orders/buy_now")).body,managed=(await api("/api/orders/work_my_order")).body;
 assert.equal(buy.order.status,"NEEDS_ATTENTION");assert.equal(managed.order.status,"WAITING");assert.equal(managed.aggregate.reserved,"0");assert.equal(managed.receipts.length,0);
 assert.equal(buy.order.checks,1);assert.equal(managed.order.checks,1);
 assert(managed.snapshot?.blockNumber,"Live snapshot persisted by independent worker");
 await worker();assert.equal((await api("/api/orders/buy_now")).body.order.checks,1);
 assert.equal((await api("/api/orders/work_my_order","DELETE")).body.order.status,"CANCELLED");
 await worker();assert.equal((await api("/api/orders/work_my_order")).body.order.status,"CANCELLED");
 if(guiId){
   console.log("Browser: inspecting persisted order after worker restart");
   browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||"msedge",headless:true,timeout:20000});
   const page=await browser.newPage({viewport:{width:1280,height:900}});await page.goto(origin);
   await page.getByLabel("Operator secret").fill(secret);await page.getByRole("button",{name:"Open desk"}).click();
   await page.getByRole("button",{name:new RegExp(guiId.slice(0,8))}).click();
   await expect(page.getByRole("heading",{name:"WAITING",exact:true})).toBeVisible();
   await expect(page.getByText("No fill receipts. No purchase is claimed.")).toBeVisible();
   await page.screenshot({path:"data/evidence/desk-synthetic-order.png",fullPage:true});
   await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
   await page.getByRole("button",{name:"Cancel future execution"}).click();await expect(page.getByRole("heading",{name:"CANCELLED",exact:true})).toBeVisible();
   await page.screenshot({path:"data/evidence/desk-mobile-synthetic-order.png",fullPage:true});
 }
 mkdirSync("data/evidence",{recursive:true});
 const report={observedAt:new Date().toISOString(),mandates:"synthetic public sender; no key",snapshots:"live RPC",executionEnabled:false,browserInteractionsVerified:Boolean(guiId),browserClosedDuringWorker:Boolean(guiId),httpAuthentication:true,idempotentCreation:true,independentWorker:true,concurrentWorkersOneCheckEach:true,restartNoDuplicateBuyNowCheck:true,cancellation:true,buyStatus:buy.order.status,managedStatusBeforeCancel:managed.order.status,snapshot:managed.snapshot,receipts:[],temporaryDatabaseRetained:dir};
 const file=`data/evidence/order-smoke-${Date.now()}.json`;writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,evidence:file}));
}finally{await browser?.close();web.kill();}
