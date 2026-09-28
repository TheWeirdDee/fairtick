// LOCAL DEVNET END-TO-END CHECK (not onchain testnet evidence).
// anvil runs with chain id 46630 on loopback; the app runs its real testnet configuration
// against it: HTTP order confirmation -> worker checks -> SERV proposal -> deterministic
// validation -> signed transaction -> verified receipt. An ephemeral key is funded with
// anvil_setBalance (the local stand-in for the faucet). Nothing touches a public network
// except the SERV inference call (and only when SERV_API_KEY is configured).
import "../src/lib/env.js";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { chromium,expect,type Browser } from "@playwright/test";
import { option } from "./lib/testnet-env.js";

const dir = mkdtempSync(join(tmpdir(), "fairtick-local-e2e-"));
const freePort = async () => { const s = createServer(); await new Promise<void>(r => s.listen(0, "127.0.0.1", r)); const p = (s.address() as { port: number }).port; await new Promise<void>(r => s.close(() => r())); return p; };
const [chainPort, webPort] = [await freePort(), await freePort()];
const key = generatePrivateKey(), wallet = privateKeyToAccount(key).address;
const secret = randomBytes(32).toString("hex");
const standIn = option("planner") === "stand-in";
// Explicit assignment: overrides any .env.local testnet settings, never the mainnet ones.
Object.assign(process.env, {
  FAIRTICK_NETWORK: "testnet", FAIRTICK_TESTNET_RPC_URL: `http://127.0.0.1:${chainPort}`, FAIRTICK_TESTNET_REGISTRY: join(dir, "registry.json"),
  TESTNET_DATABASE_PATH: join(dir, "orders.db"), OPERATOR_SECRET: secret, RH_TESTNET_PRIVATE_KEY: key, RH_TESTNET_SENDER_ADDRESS: wallet, FAIRTICK_TESTNET_EXECUTE: "true",
});
const { selectTestnet } = await import("./lib/testnet-env.js");
const net = selectTestnet();
if (net.environment !== "LOCAL_DEVNET") throw new Error("Local e2e must run against a loopback RPC");
const { getPublicClient } = await import("../src/lib/chain.js");
const { testnetKeyAccount, testnetDependencies } = await import("../src/orders/testnet.js");
const { deploymentPlan, predictAddresses, registryFor, broadcastPlan, statePathFor, writeJson, inspectDemoMarket } = await import("../src/testnet/demoMarket.js");
const { OrderStore } = await import("../src/orders/store.js");
const { runUntilSettled, demoMandate } = await import("../src/testnet/demoRun.js");
const { requestPlan } = await import("../src/engine/servPlanner.js");

const anvilPath = ".tools/foundry/anvil.exe";
if (!existsSync(anvilPath)) throw new Error("anvil not found at .tools/foundry/anvil.exe");
if (!existsSync(".next/BUILD_ID")) throw new Error("Run npm run build first");
let browser:Browser|undefined;
const children: ChildProcess[] = [];
const stop = () => { for (const c of children) try { c.kill(); } catch { /* already gone */ } };
process.on("exit", stop);
const rpc = async (method: string, params: unknown[]) => (await (await fetch(net.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()) as { result?: unknown; error?: unknown };
const log = (...a: unknown[]) => console.log(...a);
try {
  // Mirrors testnet parameters: chain id 46630, 0.01 gwei base fee; 1 s blocks so evidence blocks are fresh;
  // one slot per epoch so the "finalized" tag trails the head by a few blocks.
  children.push(spawn(anvilPath, ["--chain-id", "46630", "--port", String(chainPort), "--block-time", "1", "--slots-in-an-epoch", "1", "--base-fee", "10000000", "--silent"], { stdio: "ignore", windowsHide: true }));
  for (let i = 0; i < 100 && !(await rpc("eth_chainId", []).then(r => r.result, () => null)); i++) await new Promise(r => setTimeout(r, 200));
  const client = getPublicClient();
  const anvilVersion = (await rpc("web3_clientVersion", [])).result;
  if (await client.getChainId() !== 46630) throw new Error("devnet chain id");
  await rpc("anvil_setBalance", [wallet, "0xDE0B6B3A7640000"]); // 1 ETH, local faucet stand-in
  log(`LOCAL DEVNET ${anvilVersion} chain 46630 on ${net.rpcUrl}; ephemeral wallet ${wallet}`);

  // 1. Same deployment plan and broadcaster as npm run testnet:deploy -- --broadcast.
  const account = testnetKeyAccount();
  const startNonce = await client.getTransactionCount({ address: wallet });
  const plan = deploymentPlan(wallet, startNonce), addresses = predictAddresses(wallet, startNonce);
  const statePath = statePathFor(net.registryPath);
  const state = { chainId: 46630, environment: net.environment, deployer: wallet, sourceSha256: "local", startNonce, referencePrice: "225", completed: [] as never[] };
  log("Deploying demo market:"); await broadcastPlan(account, plan, state, statePath, log);
  writeJson(net.registryPath, registryFor(wallet, addresses, await client.getBlockNumber(), new Date(), true));
  const before = await inspectDemoMarket(addresses, wallet);

  // 2. Real web process, real HTTP confirmation.
  children.push(spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(webPort)], { env: process.env, stdio: "ignore", windowsHide: true }));
  const origin = `http://127.0.0.1:${webPort}`;
  const api = async (path: string, method = "GET", data?: unknown) => { const r = await fetch(origin + path, { method, headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, ...(data ? { body: JSON.stringify(data) } : {}) }); return { status: r.status, body: await r.json() as Record<string, any> }; };
  let health: Record<string, unknown> | null = null;
  for (let i = 0; i < 150 && !health; i++) { try { const r = await fetch(origin + "/api/health"); if (r.ok) health = await r.json(); } catch { /* starting */ } if (!health) await new Promise(r => setTimeout(r, 300)); }
  if (!health) throw new Error("web startup");
  const listed = await api("/api/orders");
  const now = Math.floor(Date.now() / 1000);
  const store = new OrderStore();
  store.heartbeat(Math.floor(Date.now()/1000),true);
  let orderId:string;
  if(process.argv.includes('--browser')){
    browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome',headless:true});
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    await page.goto(origin+'/app/orders/new');
    await page.getByLabel('Access code',{exact:true}).fill(secret);await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page).toHaveURL(origin+'/app/orders/new');
    await page.getByLabel('Order Mode',{exact:true}).selectOption('buy_now');
    await page.getByRole('button',{name:'Review order summary'}).click();
    const response=page.waitForResponse(r=>r.url()===origin+'/api/orders'&&r.request().method()==='POST');
    await page.getByRole('button',{name:'Confirm testnet order',exact:true}).click();
    const confirmed=await (await response).json();orderId=confirmed.order.id;
    await expect(page).toHaveURL(origin+'/app/orders/'+orderId);
    await page.screenshot({path:'data/evidence/release/local-confirmed.png',fullPage:true});
  }else{
    const confirmed = await api("/api/orders", "POST", demoMandate(wallet, listed.body.route, now));
    if (confirmed.status !== 201) throw new Error("HTTP confirmation failed");
    orderId=confirmed.body.order.id as string;
  }
  log(`Order confirmed over HTTP: ${orderId} (health: network=${health.network}, environment=${health.environment}, executionEnabled=${health.executionEnabled})`);

  // 3. Worker loop (same processOrder + testnet dependencies as npm run testnet:worker).
  const deps = testnetDependencies(store);
  if (standIn) deps.plan = async () => ({ status: "SUCCEEDED", transactionAuthorized: false, synthetic: true, proposal: { action: "PROPOSE_EXECUTION", reason: "SYNTHETIC STAND-IN PLANNER (local e2e only)", evidenceIds: ["deterministic_candidate"] } });
  else if (!process.env.SERV_API_KEY) throw new Error("SERV_API_KEY not configured; rerun with --planner stand-in for a labeled synthetic planner");
  const heartbeat=setInterval(()=>store.heartbeat(Math.floor(Date.now()/1000),true),15000);
  const run = await runUntilSettled(store, orderId, "operator", deps, { timeoutMs: 6 * 60_000, log: s => log(`  worker: ${s.result} -> ${s.status}: ${s.reason.slice(0, 160)}`) });
  clearInterval(heartbeat);
  if(browser){const page=browser.contexts()[0]!.pages()[0]!;await page.reload();await expect(page.getByText("Settlement Verified",{exact:true})).toBeVisible();await page.screenshot({path:"data/evidence/release/local-receipt-desktop.png",fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:"data/evidence/release/local-receipt-mobile.png",fullPage:true});}
  const view = (await api(`/api/orders/${orderId}`)).body;
  const after = await inspectDemoMarket(addresses, wallet);
  const receipt = view.receipts?.[0] ?? null;
  const independent = receipt ? {
    mUSDGSpentByBalance: (BigInt(before.wallet.mUSDG!) - BigInt(after.wallet.mUSDG!)).toString(), receiptAmountIn: receipt.amountIn,
    mNVDAReceivedByBalance: (BigInt(after.wallet.mNVDA!) - BigInt(before.wallet.mNVDA!)).toString(), receiptAmountOut: receipt.amountOut,
  } : null;
  const planning = store.db.prepare("SELECT body FROM decisions WHERE order_id=? ORDER BY created_at,rowid").all(orderId).map((r: any) => JSON.parse(r.body)).find((d: any) => d.kind === "PLANNING");
  const evidence = {
    label: "LOCAL DEVNET SIMULATION (anvil, chain id 46630, loopback). Not Robinhood testnet evidence and not market data. Mock tokens, mock price, controlled liquidity.",
    plannerMode: standIn ? "SYNTHETIC STAND-IN PLANNER" : "REAL SERV CALL (requestPlan)",
    anvil: anvilVersion, observedAt: new Date().toISOString(), wallet: "ephemeral, generated for this run and discarded",
    deployedAddresses: addresses, deployTransactions: state.completed, health,
    orderId, settled: run.settled, workerSteps: run.steps,
    planning: planning ? { label: planning.label, outcome: planning.outcome, origin: planning.origin, action: planning.action, proposal: planning.proposal, planner: planning.planner, validation: planning.validation, evidenceProvenance: planning.evidenceProvenance } : null,
    events: view.events?.map((e: any) => ({ type: e.type, body: JSON.parse(e.body) })), receipt, aggregate: view.aggregate, independentBalanceCheck: independent,
    marketBefore: before, marketAfter: after,
  };
  const out = `data/evidence/testnet-local-e2e-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeJson(out, evidence);
  log(JSON.stringify({ out, settled: run.settled, label: planning?.label, outcome: planning?.outcome, status: view.order?.status, receipt: receipt && { outcome: receipt.outcome, finalized: receipt.finalized, settlementVerified: receipt.settlementVerified, mandateComplianceVerified: receipt.mandateComplianceVerified, gasCostVerified: receipt.gasCostVerified, feeMethod: receipt.feeMethod, amountIn: receipt.amountIn, amountOut: receipt.amountOut, tx: receipt.transactionHash }, independent }, null, 1));
  store.close();
  if (!run.settled) process.exitCode = 1;
} finally { if(browser)await browser.close();stop(); }
