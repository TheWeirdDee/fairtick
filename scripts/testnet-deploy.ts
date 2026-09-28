// TESTNET DEMO: plan (default) or --broadcast the mock demo market on chain 46630.
import { formatEther, type Address } from "viem";
import { selectTestnet, flag } from "./lib/testnet-env.js";
import { getPublicClient } from "../src/lib/chain.js";
import { testnetKeyAccount, assertTestnetRpc } from "../src/orders/testnet.js";
import {
  deploymentPlan, loadArtifact, predictAddresses, registryFor, inspectDemoMarket, readState, statePathFor, writeJson, broadcastPlan,
  type DeployState,
} from "../src/testnet/demoMarket.js";

// Returns an exit code; process.exit() with open sockets aborts Node on Windows.
async function main(): Promise<number> {
  const net = selectTestnet();
  const broadcast = flag("broadcast");
  await assertTestnetRpc();
  const client = getPublicClient();
  const artifact = loadArtifact();

  let account: ReturnType<typeof testnetKeyAccount> | undefined;
  let deployer: Address | undefined;
  if (broadcast || process.env.RH_TESTNET_PRIVATE_KEY) { account = testnetKeyAccount(); deployer = account.address; }
  else deployer = process.env.RH_TESTNET_SENDER_ADDRESS as Address | undefined;
  if (!deployer) { console.log("No testnet wallet configured. Run: npm run testnet:wallet"); return 2; }

  const [latestNonce, pendingNonce, balance, gasPrice, block] = await Promise.all([
    client.getTransactionCount({ address: deployer, blockTag: "latest" }), client.getTransactionCount({ address: deployer, blockTag: "pending" }),
    client.getBalance({ address: deployer }), client.getGasPrice(), client.getBlock(),
  ]);
  const statePath = statePathFor(net.registryPath);
  const prior = readState(statePath);
  if (prior && (prior.deployer.toLowerCase() !== deployer.toLowerCase() || prior.chainId !== net.chainId || prior.sourceSha256 !== artifact.sourceSha256 || prior.environment !== net.environment)) {
    throw new Error(`Deployment state ${statePath} belongs to another wallet/chain/artifact. Move it aside to plan a fresh deployment.`);
  }
  if(latestNonce!==pendingNonce && !prior?.pending)throw new Error("UNTRACKED_PENDING_DEPLOYMENT_TRANSACTION");
  const startNonce = prior?.startNonce ?? pendingNonce;
  if(prior && !prior.pending && latestNonce!==startNonce+prior.completed.length)throw new Error("DEPLOYMENT_RESUME_NONCE_MISMATCH");
  const plan = deploymentPlan(deployer, startNonce, artifact);
  const addresses = predictAddresses(deployer, startNonce);
  const done = new Set(prior?.completed.map(c => c.step) ?? []);

  // Only contract creations can be estimated before anything exists; later calls depend on them.
  const estimates = await Promise.all(plan.map(async tx => {
    if (done.has(tx.step)) return { status: "COMPLETED" };
    if (tx.kind !== "deploy") return { status: "ESTIMATED_DURING_BROADCAST (depends on earlier steps)" };
    try { return { status: "ESTIMATED", gas: (await client.estimateGas({ account: deployer, data: tx.data, value: 0n })).toString() }; }
    catch (e) { return { status: `ESTIMATE_FAILED: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}` }; }
  }));
  const deployGas = estimates.reduce((s, e) => s + BigInt((e as { gas?: string }).gas ?? "0"), 0n);
  // Conservative bound: deployments x1.3 plus seven calls at 150k gas, all at 2x the current gas
  // price (the broadcast caps maxFeePerGas at 2x). Arbitrum L1 posting is inside eth_estimateGas.
  const costBoundWei = ((deployGas * 13n) / 10n + 7n * 150_000n) * gasPrice * 2n;
  const report = {
    label: `TESTNET DEMO DEPLOYMENT PLAN: ${net.label}. ${net.notice}`,
    mode: broadcast ? "BROADCAST" : "DRY_RUN (nothing signed or sent)",
    chainId: await client.getChainId(), rpcOrigin: new URL(net.rpcUrl).origin, block: block.number.toString(), blockTimestamp: Number(block.timestamp),
    wallet: { address: deployer, balanceWei: balance.toString(), balanceEth: formatEther(balance), nonceLatest: latestNonce, noncePending: pendingNonce },
    gasPriceWei: gasPrice.toString(), costUpperBoundWei: costBoundWei.toString(), costUpperBoundEth: formatEther(costBoundWei),
    costs: {deploymentsWei:((deployGas*13n/10n)*gasPrice*2n).toString(),setupSevenCallsAllowanceWei:(7n*150_000n*gasPrice*2n).toString(),approvalTokenAmount:"100 mUSDG",priceRefreshAllowanceWei:(150_000n*gasPrice*2n).toString(),orderGasCapWei:"1000000000000000",unspentReserveWei:"100000000000000",requiredWithOrderAndReserveWei:(costBoundWei+150_000n*gasPrice*2n+1100000000000000n).toString(),note:"Setup and refresh are allowances, not measured estimates before contracts exist. Re-estimate before each approved send; stop if cap exceeded."},
    artifact: { compiler: artifact.compiler, sourceSha256: artifact.sourceSha256 },
    predictedAddresses: addresses,
    transactions: plan.map(tx => ({
      step: tx.step, nonce: tx.nonce, label: tx.label, to: tx.to ?? "(contract creation)", predictedAddress: tx.predictedAddress,
      call: `${tx.contract}.${tx.fn}(${tx.args.join(", ")})`, dataBytes: (tx.data.length - 2) / 2, value: "0", estimate: estimates[tx.step],
    })),
    resume: prior ? { statePath, completedSteps: [...done] } : null,
  };
  writeJson(`data/testnet/${net.environment.toLowerCase()}-deploy-plan.json`, report);

  if (!broadcast) {
    console.log(JSON.stringify({ ...report, transactions: report.transactions.map(t => `[${t.step}] nonce ${t.nonce}: ${t.call}${t.predictedAddress ? ` -> ${t.predictedAddress}` : ""} | gas ${(t.estimate as { gas?: string } | undefined)?.gas ?? t.estimate?.status}`) }, null, 1));
    console.log(balance < costBoundWei
      ? `\nWallet has ${formatEther(balance)} testnet ETH, below the ${formatEther(costBoundWei)} bound. Faucet: https://faucet.testnet.chain.robinhood.com for ${deployer}, then rerun with --broadcast.`
      : "\nReady to broadcast: npm run testnet:deploy -- --broadcast");
    return 0;
  }

  if (balance < costBoundWei) throw new Error(`Insufficient testnet ETH: have ${formatEther(balance)}, conservative bound ${formatEther(costBoundWei)}. Use the faucet first.`);
  const state: DeployState = prior ?? { chainId: net.chainId, environment: net.environment, deployer, sourceSha256: artifact.sourceSha256, startNonce, referencePrice: "225", completed: [] };
  writeJson(statePath, state);
  console.log(`Broadcasting ${plan.length - done.size} testnet transactions from ${deployer} on ${net.label}`);
  await broadcastPlan(account!, plan, state, statePath, console.log);
  const registry = registryFor(deployer, addresses, await client.getBlockNumber(), new Date(), net.environment === "LOCAL_DEVNET");
  writeJson(net.registryPath, registry);
  console.log(JSON.stringify({ registry: net.registryPath, inspected: await inspectDemoMarket(addresses, deployer) }, null, 1));
  return 0;
}
process.exitCode = await main();
