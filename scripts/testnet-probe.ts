// READ-ONLY Robinhood testnet (46630) dependency probe. Signs and sends nothing.
import { encodeFunctionData, parseAbi, type Address } from "viem";
import { selectTestnet } from "./lib/testnet-env.js";
import { getPublicClient, CORE_ADDRESSES } from "../src/lib/chain.js";
import { estimateTransactionFee } from "../src/lib/executionEvidence.js";
import { writeJson } from "../src/testnet/demoMarket.js";

const net = selectTestnet();
const c = getPublicClient();
const [chainId, latest, finalized, gasPrice] = await Promise.all([c.getChainId(), c.getBlock(), c.getBlock({ blockTag: "finalized" }), c.getGasPrice()]);
if (chainId !== 46630) throw new Error(`Refusing: RPC reports chain ${chainId}`);
// Mainnet addresses are checked only to document that none of them exists here; they are never used.
const mainnetCode = Object.fromEntries(await Promise.all(Object.entries(CORE_ADDRESSES).map(async ([k, a]) => [k, (((await c.getBytecode({ address: a as Address })) ?? "0x").length - 2) / 2] as const)));
const stateWindow: Record<string, string> = {};
for (const back of [100n, 1_000n, 5_000n, 8_000n]) {
  stateWindow[`latest-${back}`] = await c.getBalance({ address: "0x000000000000000000000000000000000000006C", blockNumber: latest.number - back }).then(() => "AVAILABLE", e => String(e).includes("historical state") ? "PRUNED" : "ERROR");
}
const sender = (process.env.RH_TESTNET_SENDER_ADDRESS ?? "0x000000000000000000000000000000000000dEaD") as Address;
const fee = await estimateTransactionFee({ to: CORE_ADDRESSES.multicall3, data: encodeFunctionData({ abi: parseAbi(["function getBlockNumber() view returns (uint256)"]), functionName: "getBlockNumber" }), from: sender });
const explorer = await fetch("https://explorer.testnet.chain.robinhood.com/api/v2/stats", { signal: AbortSignal.timeout(10_000) }).then(r => r.ok ? r.json() as Promise<{ average_block_time?: number }> : null, () => null);
const report = {
  label: "READ-ONLY Robinhood Chain testnet probe", observedAt: new Date().toISOString(), rpc: net.rpcUrl, chainId,
  latest: { number: latest.number.toString(), timestamp: Number(latest.timestamp), lagSeconds: Math.floor(Date.now() / 1000) - Number(latest.timestamp), l1BlockNumber: (latest as { l1BlockNumber?: unknown }).l1BlockNumber ?? null },
  finalized: { number: finalized.number.toString(), lagBlocks: (latest.number - finalized.number).toString(), lagSeconds: Number(latest.timestamp - finalized.timestamp) },
  gasPriceWei: gasPrice.toString(), mainnetAddressCodeBytesOnTestnet: mainnetCode, historicalStateWindow: stateWindow,
  feeAdapter: { status: fee.status, estimatedGas: fee.estimatedGas, l1Component: fee.l1Component, notes: fee.notes },
  explorer: explorer ? { url: "https://explorer.testnet.chain.robinhood.com", averageBlockTimeMs: explorer.average_block_time ?? null } : null,
};
const out = `data/evidence/testnet-probe-${report.observedAt.replace(/[:.]/g, "-")}.json`;
writeJson(out, report);
console.log(JSON.stringify({ out, ...report }, null, 1));
