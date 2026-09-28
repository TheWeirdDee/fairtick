// Read-only check of the Arbitrum L1 posting inputs the fee adapter relies on.
// Records NodeInterface.gasEstimateL1Component for the real swap calldata shape
// plus ArbGasInfo's L1 price, so the "subset, priced at the L2 baseFee" derivation
// can be re-checked at any time. No sender, no signing, no state changes.
import { mkdirSync, writeFileSync } from "node:fs";
import { encodeFunctionData, pad, parseAbi, type Address } from "viem";
import { getPublicClient } from "../src/lib/chain.js";
import { allowedRoute } from "../src/orders/config.js";
import { ROUTER_ABI } from "../src/engine/prepareBuy.js";
import { NODE_INTERFACE_ADDRESS } from "../src/lib/executionEvidence.js";

const c = getPublicClient(), route = allowedRoute();
const nodeInterface = parseAbi(["function gasEstimateL1Component(address to, bool contractCreation, bytes data) payable returns (uint64 gasEstimateForL1, uint256 baseFee, uint256 l1BaseFeeEstimate)"]);
const arbGasInfo = parseAbi(["function getL1BaseFeeEstimate() view returns (uint256)", "function getPricesInWei() view returns (uint256,uint256,uint256,uint256,uint256,uint256)"]);
// Same calldata shape as the worker's fee probe; the recipient is a placeholder public address.
const swap = encodeFunctionData({ abi: ROUTER_ABI, functionName: "exactInputSingle", args: [{ tokenIn: route.quoteToken as Address, tokenOut: route.token as Address, fee: route.fee, recipient: pad("0x05", { size: 20 }), amountIn: 25_000_000n, amountOutMinimum: 1n, sqrtPriceLimitX96: 0n }] });
const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "multicall", args: [BigInt(Math.floor(Date.now() / 1000) + 120), [swap]] });
const block = await c.getBlock();
const [l1, l1BaseFee, prices, gasPrice] = await Promise.all([
  c.simulateContract({ address: NODE_INTERFACE_ADDRESS, abi: nodeInterface, functionName: "gasEstimateL1Component", args: [route.router as Address, false, data], blockNumber: block.number }).then(r => r.result),
  c.readContract({ address: pad("0x6C", { size: 20 }), abi: arbGasInfo, functionName: "getL1BaseFeeEstimate", blockNumber: block.number }),
  c.readContract({ address: pad("0x6C", { size: 20 }), abi: arbGasInfo, functionName: "getPricesInWei", blockNumber: block.number }),
  c.getGasPrice(),
]);
const report = {
  observedAt: new Date().toISOString(), block: block.number.toString(), blockTimestamp: Number(block.timestamp), calldataBytes: (data.length - 2) / 2,
  nodeInterfaceL1Component: { gasEstimateForL1: l1[0].toString(), baseFee: l1[1].toString(), l1BaseFeeEstimate: l1[2].toString(), l1Wei: (l1[0] * l1[1]).toString(), unit: "gasEstimateForL1 is L2 gas; wei = gasEstimateForL1 x baseFee" },
  arbGasInfo: { getL1BaseFeeEstimate: l1BaseFee.toString(), getPricesInWei: { perL2Tx: prices[0].toString(), perL1CalldataByte: prices[1].toString(), perStorageAllocation: prices[2].toString(), perArbGasBase: prices[3].toString(), perArbGasCongestion: prices[4].toString(), perArbGasTotal: prices[5].toString() } },
  ethGasPrice: gasPrice.toString(),
};
mkdirSync("data/evidence", { recursive: true });
const file = `data/evidence/l1-fee-${Date.now()}.json`;
writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ file, ...report }, null, 2));
