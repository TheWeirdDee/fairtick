// TESTNET DEMO RUN on chain 46630. Default: read-only readiness report (nothing signed or sent).
// --broadcast: refreshes the MOCK price if needed, confirms one Buy-now order for 25 mock USDG,
// then runs the worker until the swap's receipt is finalized and verified (~25 min on testnet).
import { existsSync } from "node:fs";
import { createWalletClient, encodeFunctionData, formatEther, http, type Address } from "viem";
import { selectTestnet, flag } from "./lib/testnet-env.js";
import { activeChain, getPublicClient } from "../src/lib/chain.js";
import { loadRegistry } from "../src/lib/registry.js";
import { allowedRoute } from "../src/orders/config.js";
import { OrderStore } from "../src/orders/store.js";
import { testnetDependencies, testnetKeyAccount, testnetSigningAccount, assertTestnetRpc } from "../src/orders/testnet.js";
import { inspectDemoMarket, writeJson, FEED_ADMIN_ABI, DEMO, type DemoAddresses } from "../src/testnet/demoMarket.js";
import { demoMandate, runUntilSettled } from "../src/testnet/demoRun.js";
import { executionMandateSchema } from "../src/engine/executionValidator.js";

// Returns an exit code; process.exit() with open sockets aborts Node on Windows.
async function main(): Promise<number> {
  const net = selectTestnet();
  // --broadcast is the explicit opt-in for this process only; the long-running worker needs FAIRTICK_TESTNET_EXECUTE=true.
  if (flag("broadcast")) process.env.FAIRTICK_TESTNET_EXECUTE = "true";
  await assertTestnetRpc();
  if (!existsSync(net.registryPath)) { console.log(`No demo market registry at ${net.registryPath}. Deploy first: npm run testnet:deploy -- --broadcast`); return 2; }
  const client = getPublicClient();
  const registry = loadRegistry();
  const addresses = registry.demo!.contracts as unknown as DemoAddresses;
  const wallet = (process.env.RH_TESTNET_SENDER_ADDRESS ?? registry.demo!.deployer) as Address;
  const [market, eth] = await Promise.all([inspectDemoMarket(addresses, wallet), client.getBalance({ address: wallet })]);
  let executor = "READY";
  try { testnetSigningAccount({ ...process.env, FAIRTICK_TESTNET_EXECUTE: "true" }); } catch (e) { executor = e instanceof Error ? e.message : "NOT_READY"; }
  const readiness = {
    label: `${net.label}. ${net.notice}`, wallet, walletEth: formatEther(eth), market,
    servKeyPresent: Boolean(process.env.SERV_API_KEY), executor,
    feedNeedsRefresh: market.feed === null || (market.feed.ageSeconds ?? Infinity) > 600,
    willSend: [
      "If the mock price is older than 600 s: DemoAggregator.updateAnswer(22500000000) (mock price, operator-set)",
      "After a SERV PROPOSE_EXECUTION that deterministic code revalidates: DemoRouter.multicall(deadline, [exactInputSingle(mUSDG -> mNVDA, 25 mUSDG, 0.05%, recipient = wallet, amountOutMinimum from the validator)])",
    ],
  };
  if (!flag("broadcast")) {
    console.log(JSON.stringify({ mode: "DRY_RUN (nothing signed or sent)", ...readiness }, null, 1));
    return 0;
  }
  if (executor !== "READY") throw new Error(`Testnet executor not ready: ${executor}`);
  if (!process.env.SERV_API_KEY) throw new Error("SERV_API_KEY is required: the demo's decision step is a real SERV proposal.");

  if (readiness.feedNeedsRefresh) {
    const account = testnetKeyAccount(), chain = activeChain();
    const w = createWalletClient({ account, chain, transport: http(chain.rpcUrls.default.http[0]) });
    const hash = await w.sendTransaction({ account, chain, to: addresses.feed, data: encodeFunctionData({ abi: FEED_ADMIN_ABI, functionName: "updateAnswer", args: [DEMO.referencePrice * 10n ** 8n] }), value: 0n, maxFeePerGas: (await client.getGasPrice()) * 2n, maxPriorityFeePerGas: 0n });
    const r = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
    console.log(`Mock price refreshed: ${hash} (${r.status})`);
  }
  const store = new OrderStore();
  const now = Math.floor(Date.now() / 1000);
  // Same path as POST /api/orders: schema, allowlisted route, then the store's own network check.
  const mandate = executionMandateSchema.parse({ ...demoMandate(wallet, allowedRoute(), now), owner: "operator", route: allowedRoute() });
  const order = store.create(mandate, now);
  console.log(`Order ${order.id} confirmed (buy_now, 25 mUSDG, max 230 mUSDG/mNVDA, <= 15 bps over the MOCK reference)`);
  const run = await runUntilSettled(store, order.id, "operator", testnetDependencies(store), { timeoutMs: 45 * 60_000, pollMs: 5000, log: s => console.log(`  ${s.at} ${s.result} -> ${s.status}: ${s.reason.slice(0, 160)}`) });
  const out = `data/evidence/testnet-demo-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeJson(out, { label: `ONCHAIN ${net.label}: MOCK MARKET (mock tokens, operator-set mock price, controlled liquidity). Not market data.`, readiness, orderId: order.id, ...run, marketAfter: await inspectDemoMarket(addresses, wallet) });
  console.log(JSON.stringify({ out, settled: run.settled, status: run.view.order.status, receipts: run.view.receipts.map(r => ({ tx: r.transactionHash, outcome: r.outcome, settlementVerified: r.settlementVerified, mandateComplianceVerified: r.mandateComplianceVerified, gasCostVerified: r.gasCostVerified })) }, null, 1));
  store.close();
  return 0;
}
process.exitCode = await main();
