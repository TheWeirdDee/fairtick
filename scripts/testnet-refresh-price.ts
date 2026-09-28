// TESTNET DEMO: set the MOCK reference price (operator-set, not market data). Dry-run unless --broadcast.
import { existsSync } from "node:fs";
import { encodeFunctionData, createWalletClient, http, type Address } from "viem";
import { selectTestnet, flag, option } from "./lib/testnet-env.js";
import { activeChain, getPublicClient } from "../src/lib/chain.js";
import { loadRegistry } from "../src/lib/registry.js";
import { testnetKeyAccount, assertTestnetRpc } from "../src/orders/testnet.js";
import { FEED_ADMIN_ABI, DEMO } from "../src/testnet/demoMarket.js";

// Returns an exit code; process.exit() with open sockets aborts Node on Windows.
async function main(): Promise<number> {
  const net = selectTestnet();
  await assertTestnetRpc();
  if (!existsSync(net.registryPath)) { console.log(`No demo market registry at ${net.registryPath}. Deploy first: npm run testnet:deploy -- --broadcast`); return 2; }
  const registry = loadRegistry(), entry = registry.symbols[net.symbol]!;
  const price = BigInt(option("price") ?? DEMO.referencePrice.toString());
  if (price <= 0n || price > 1_000_000n) throw new Error("--price must be a whole number of mock USD between 1 and 1,000,000");
  const answer = price * 10n ** 8n;
  const data = encodeFunctionData({ abi: FEED_ADMIN_ABI, functionName: "updateAnswer", args: [answer] });
  const sender = (process.env.RH_TESTNET_SENDER_ADDRESS ?? registry.demo!.deployer) as Address;
  const client = getPublicClient();
  const [nonce, gas] = await Promise.all([
    client.getTransactionCount({ address: sender, blockTag: "pending" }),
    client.estimateGas({ account: sender, to: entry.feed.proxyAddress, data }).then(String, e => `ESTIMATE_FAILED: ${String(e).split("\n")[0]}`),
  ]);
  const tx = { label: `MOCK price update to ${price} (8 decimals on chain); operator-set, not market data`, chainId: net.chainId, from: sender, to: entry.feed.proxyAddress, call: `DemoAggregator.updateAnswer(${answer})`, nonce, value: "0", estimatedGas: gas };
  if (!flag("broadcast")) {
    console.log(JSON.stringify({ mode: "DRY_RUN (nothing signed or sent)", tx }, null, 1));
    return 0;
  }
  const account = testnetKeyAccount();
  if (account.address.toLowerCase() !== registry.demo!.deployer.toLowerCase()) throw new Error("Only the demo deployer can set the mock price");
  const chain = activeChain(), wallet = createWalletClient({ account, chain, transport: http(chain.rpcUrls.default.http[0]) });
  const gasPrice = await client.getGasPrice();
  const hash = await wallet.sendTransaction({ account, chain, to: entry.feed.proxyAddress, data, value: 0n, maxFeePerGas: gasPrice * 2n, maxPriorityFeePerGas: 0n });
  const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  console.log(JSON.stringify({ mode: "BROADCAST", tx, hash, status: receipt.status, block: receipt.blockNumber.toString() }, null, 1));
  return 0;
}
process.exitCode = await main();
