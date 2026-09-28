// Isolated browser and separate-worker audit. Zero SERV requests or transactions.
import '../src/lib/env.js';
import {spawn,type ChildProcess} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {chromium,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {fixture} from '../test/order-fixtures.js';
const dir=mkdtempSync(join(tmpdir(),'fairtick-release-')),secret=randomBytes(32).toString('hex');
const server=createServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port;await new Promise<void>(r=>server.close(()=>r()));
const origin=`http://127.0.0.1:${port}`,out='data/evidence/release';mkdirSync(out,{recursive:true});
const env={...process.env,FAIRTICK_NETWORK:'mainnet',DATABASE_PATH:join(dir,'orders.db'),OPERATOR_SECRET:secret,APP_ORIGIN:origin,SERV_API_KEY:'',RH_PRIVATE_KEY:'',RH_TESTNET_PRIVATE_KEY:'',FAIRTICK_TESTNET_EXECUTE:'false',RH_SENDER_ADDRESS:fixture().mandate.signer};
const children:ChildProcess[]=[];
const start=(args:string[])=>{const c=spawn(process.execPath,args,{env,stdio:'ignore',windowsHide:true});children.push(c);return c;};
const web=start(['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)]);
const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true});
const errors:string[]=[];const results:Record<string,unknown>={provenance:'Synthetic public wallet and isolated orders; live read-only RPC; separate worker; SERV disabled; no transaction',observedAt:new Date().toISOString()};
try{
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,300));}
 assert.equal((await fetch(origin+'/api/orders')).status,401);
 const context=await browser.newContext({viewport:{width:1280,height:900}});let page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 const routes=['/','/docs','/docs/getting-started','/docs/orders','/docs/serv','/docs/networks','/docs/receipts','/docs/self-hosting','/docs/limitations','/tour','/evidence','/access'];
 const links=new Set<string>();
 for(const route of routes){await page.goto(origin+route);await expect(page.locator('h1')).toBeVisible();for(const href of await page.locator('a[href]').evaluateAll(els=>els.map(e=>e.getAttribute('href')!)))if(href.startsWith('/'))links.add(href.split('#')[0]!);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route+' desktop overflow');}
 for(const href of links)assert((await fetch(origin+href)).ok,'link '+href);
 await page.goto(origin);await page.screenshot({path:out+'/landing-desktop.png',fullPage:true});await page.locator('footer').screenshot({path:out+'/footer.png'});
 await page.keyboard.press('Tab');assert(await page.evaluate(()=>document.activeElement?.tagName==='A'),'keyboard link focus');
 await page.goto(origin+'/docs/orders');await page.screenshot({path:out+'/docs-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});for(const route of routes){await page.goto(origin+route);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route+' mobile overflow');if(['/','/docs','/access'].includes(route))await page.screenshot({path:out+'/'+(route==='/'?'landing':route.slice(1))+'-mobile.png',fullPage:true});}
 await page.setViewportSize({width:1280,height:900});await page.goto(origin+'/app/orders/new');await expect(page).toHaveURL(/\/access\?next=/);
 await page.getByLabel('Access code',{exact:true}).fill('wrong-code');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.locator('main [role=alert]')).toContainText('Invalid access code');
 await page.route('**/api/session',r=>r.request().method()==='POST'?r.abort():r.continue());await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.locator('main [role=alert]')).toContainText('Service unavailable');await page.unroute('**/api/session');
 await page.getByLabel('Access code',{exact:true}).fill('');await page.screenshot({path:out+'/owner-access.png',fullPage:true});
 await page.getByLabel('Access code',{exact:true}).fill(secret);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(origin+'/app/orders/new');
 const cookie=(await context.cookies()).find(c=>c.name==='fairtick_session');assert(cookie?.httpOnly);assert.equal(cookie?.sameSite,'Strict');assert(!await page.evaluate(()=>sessionStorage.getItem('fairtick_operator_secret')));
 const worker=start(['node_modules/tsx/dist/cli.mjs','scripts/worker.ts']);
 await expect.poll(async()=>fetch(origin+'/api/health').then(r=>r.json()).then(j=>j.worker.active),{timeout:30000}).toBe(true);
 await page.reload();await page.getByLabel('Total Budget',{exact:false}).fill('25.0000001');await page.getByRole('button',{name:'Review order summary'}).click();await expect(page.locator('main [role=alert]')).toContainText('six decimal places');await expect(page.getByLabel('Total Budget',{exact:false})).toHaveValue('25.0000001');
 await page.getByLabel('Total Budget',{exact:false}).fill('25');await page.getByRole('button',{name:'Review order summary'}).click();await expect(page.getByRole('heading',{name:'Review Mandate Summary'})).toBeVisible();await page.screenshot({path:out+'/create-review-desktop.png',fullPage:true});
 // Preserve the draft across a failed confirmation; retry must use the same ID.
 await page.route('**/api/orders',r=>r.request().method()==='POST'?r.fulfill({status:503,contentType:'application/json',body:'{"error":"Service unavailable"}'}):r.continue());await page.getByRole('button',{name:'Start monitoring order'}).click();await expect(page.locator('main [role=alert]')).toContainText('Service unavailable');await page.unroute('**/api/orders');
 const confirmed=page.waitForResponse(r=>r.url()===origin+'/api/orders'&&r.request().method()==='POST');await page.getByRole('button',{name:'Start monitoring order'}).click();const body=await (await confirmed).json();const id=body.order.id as string;await expect(page).toHaveURL(origin+'/app/orders/'+id);
 await page.close(); // Worker continues without a page.
 const headers={Authorization:`Bearer ${secret}`};await expect.poll(async()=>fetch(origin+'/api/orders/'+id,{headers}).then(r=>r.json()).then(j=>j.order.checks),{timeout:60000}).toBeGreaterThan(0);
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/app/orders/'+id);await expect(page.getByRole('heading',{name:'Order Details',exact:true})).toBeVisible();await page.screenshot({path:out+'/waiting-desktop.png',fullPage:true});
 await page.goto(origin+'/app');await page.screenshot({path:out+'/orders-desktop.png',fullPage:true});await page.goto(origin+'/app/orders/'+id);await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'order detail mobile overflow');await page.screenshot({path:out+'/waiting-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Cancel order',exact:true}).click();await page.getByRole('button',{name:'Confirm Cancellation'}).click();await expect(page.getByText('Cancelled',{exact:true})).toBeVisible();
 await context.clearCookies();await page.reload();await expect(page).toHaveURL(/\/access\?next=/);await page.getByLabel('Access code',{exact:true}).fill(secret);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(origin+'/app/orders/'+id);
 const oldCookie=(await context.cookies()).find(c=>c.name==='fairtick_session')!;await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL(origin+'/access');assert.equal((await fetch(origin+'/api/orders',{headers:{Cookie:`fairtick_session=${oldCookie.value}`}})).status,401);
 worker.kill();Object.assign(results,{publicRoutes:routes,internalLinks:links.size,desktopAndMobileNoOverflow:true,keyboardFocus:true,invalidCode:true,serviceUnavailable:true,cookieAuth:true,requestedPageRedirect:true,precisionValidation:true,inputPreserved:true,confirmedOrder:id,browserClosedDuringWorker:true,cancellation:true,expiredSessionRedirect:true,signOutRevoked:true,pageErrors:errors});assert.equal(errors.length,0);writeFileSync(out+'/browser-report.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();for(const c of children)c.kill();}
