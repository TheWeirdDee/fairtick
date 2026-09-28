import { pad, parseAbi, type Address, type Hex } from "viem";
import { getPublicClient } from "./chain.js";

/**
 * Measured execution prerequisites for the validator's evidence packet. Each
 * function returns a real measurement or an explicit unavailable status —
 * never an invented `true`, and never a zero standing in for an unknown amount.
 */

// Arbitrum Nitro NodeInterface: a virtual, node-intercepted address with no
// deployed code, called via eth_call. Its gas methods are declared `payable`
// (not `view`) in OffchainLabs/nitro-contracts src/node-interface/NodeInterface.sol,
// so they go through simulateContract rather than readContract.
export const NODE_INTERFACE_ADDRESS = pad("0xC8", { size: 20 });

const NODE_INTERFACE_ABI = parseAbi([
  "function gasEstimateL1Component(address to, bool contractCreation, bytes data) payable returns (uint64 gasEstimateForL1, uint256 baseFee, uint256 l1BaseFeeEstimate)",
]);

export interface RouteBytecodeCheck {
  allPresent: boolean;
  bytesPresent: Record<string, number>;
}

/**
 * Establishes only that code exists at each address at the evidence block. It
 * does NOT establish contract identity: there is no code-hash or proxy
 * implementation pinning, so an upgraded proxy implementation (USDG and the
 * stock token are proxies) would still pass.
 */
export async function checkRouteBytecodePresent(
  addresses: Record<string, Address>,
  blockNumber: bigint,
): Promise<RouteBytecodeCheck> {
  const client = getPublicClient();
  const entries = await Promise.all(
    Object.entries(addresses).map(async ([name, address]) => {
      const code = await client.getBytecode({ address, blockNumber });
      return [name, code ? (code.length - 2) / 2 : 0] as const;
    }),
  );
  return { allPresent: entries.every(([, bytes]) => bytes > 0), bytesPresent: Object.fromEntries(entries) };
}

/**
 * Establishes only that the evidence block's timestamp is within this many
 * seconds of the local clock (calibrated 2026-09-25: ~9.8 blocks/s, ~1s lag).
 * It does NOT establish comprehensive network health — sequencer status,
 * agreement across RPC providers, L1 batch posting or finality lag are not
 * measured. It overlaps the mandate's maxBlockAgeSeconds; the stricter applies.
 */
export const EVIDENCE_BLOCK_MAX_LAG_SECONDS = 30;

export function isEvidenceBlockFresh(blockTimestamp: number, nowSeconds: number): boolean {
  const lag = nowSeconds - blockTimestamp;
  return lag >= 0 && lag <= EVIDENCE_BLOCK_MAX_LAG_SECONDS;
}

/** Informational breakdown. A SUBSET of `estimatedGas`, never added to it. */
export interface L1Component {
  status: "MEASURED" | "UNAVAILABLE";
  gasUnits: string | null; // gasEstimateForL1, in child-chain (L2) gas units
  l2BaseFeeWei: string | null; // baseFee returned by the same call
  wei: string | null; // gasUnits x l2BaseFeeWei
  l1BaseFeeEstimateWei: string | null; // ArbOS's parent-chain base fee estimate; not a multiplier here
}

export interface FeeEstimate {
  status: "ESTIMATED" | "UNAVAILABLE";
  estimatedGas: string | null; // eth_estimateGas; on Nitro this already includes the L1 posting buffer
  gasPriceWei: string | null; // eth_gasPrice, child-chain wei per gas
  pointEstimateWei: string | null; // estimatedGas x gasPriceWei
  gasLimit: string | null; // ceil(estimatedGas x 1.2)
  maxFeePerGasWei: string | null; // ceil(gasPriceWei x 1.2)
  // Upper bound on the fee only if a future signing release sets the
  // transaction's gas <= gasLimit and maxFeePerGas <= maxFeePerGasWei
  // (EIP-1559: effective gas price never exceeds maxFeePerGas).
  feeUpperBoundWei: string | null;
  l1Component: L1Component;
  method: string;
  notes: string[];
  measuredAt: string;
}

const METHOD =
  "eth_estimateGas x eth_gasPrice (Nitro estimate includes L1 posting); NodeInterface.gasEstimateL1Component reported as a subset, not added";
const BUFFER_BPS = 12_000n; // 120%: policy headroom, not a network constant

const withBuffer = (value: bigint) => (value * BUFFER_BPS + 9_999n) / 10_000n;

/**
 * Total fee per Arbitrum's documented formula: "Multiplying the value from
 * eth_estimateGas by the child chain gas price gives you the total ETH
 * required" (docs.arbitrum.io, How to estimate gas). The L1 component
 * (gasEstimateForL1, in L2 gas units, priced at the L2 baseFee) is part of
 * that estimate, so it is reported separately and never added again.
 *
 * No sender, a failed estimate, or a failed price read yields UNAVAILABLE
 * with null amounts. The Uniswap Quoter's gas field is never used: it
 * reflects the Quoter's revert-based simulation, not the router transaction.
 */
export async function estimateTransactionFee(params: { to: Address; data: Hex; from?: Address }): Promise<FeeEstimate> {
  const client = getPublicClient();
  const notes: string[] = [];
  const measuredAt = new Date().toISOString();

  let l1Component: L1Component = { status: "UNAVAILABLE", gasUnits: null, l2BaseFeeWei: null, wei: null, l1BaseFeeEstimateWei: null };
  try {
    const { result } = await client.simulateContract({
      address: NODE_INTERFACE_ADDRESS,
      abi: NODE_INTERFACE_ABI,
      functionName: "gasEstimateL1Component",
      args: [params.to, false, params.data],
      account: params.from,
    });
    const [gasUnits, baseFee, l1BaseFeeEstimate] = result;
    l1Component = {
      status: "MEASURED",
      gasUnits: gasUnits.toString(),
      l2BaseFeeWei: baseFee.toString(),
      wei: (gasUnits * baseFee).toString(),
      l1BaseFeeEstimateWei: l1BaseFeeEstimate.toString(),
    };
    if (gasUnits === 0n) notes.push("L1_COMPONENT_MEASURED_ZERO");
  } catch {
    notes.push("L1_COMPONENT_UNAVAILABLE");
  }

  const unavailable = (note: string, gasPriceWei: string | null = null): FeeEstimate => ({
    status: "UNAVAILABLE", estimatedGas: null, gasPriceWei, pointEstimateWei: null, gasLimit: null,
    maxFeePerGasWei: null, feeUpperBoundWei: null, l1Component, method: METHOD, notes: [...notes, note], measuredAt,
  });

  let gasPrice: bigint;
  try {
    gasPrice = await client.getGasPrice();
  } catch {
    return unavailable("GAS_PRICE_UNAVAILABLE");
  }
  if (!params.from) return unavailable("NO_CONFIGURED_SENDER", gasPrice.toString());

  let estimatedGas: bigint;
  try {
    estimatedGas = await client.estimateGas({ account: params.from, to: params.to, data: params.data, value: 0n });
  } catch (err) {
    // Typically insufficient balance/allowance (the same STF revert as an
    // unfunded simulation) — a funding failure, not a gas-estimation bug.
    return unavailable(`GAS_ESTIMATE_FAILED: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`, gasPrice.toString());
  }

  // The documented semantics make the L1 component a subset of the total. If
  // it is ever larger, those semantics do not hold on this endpoint: refuse
  // to guess rather than under- or double-count.
  if (l1Component.gasUnits !== null && BigInt(l1Component.gasUnits) > estimatedGas) {
    return unavailable("L1_COMPONENT_EXCEEDS_TOTAL_ESTIMATE", gasPrice.toString());
  }

  const gasLimit = withBuffer(estimatedGas);
  const maxFeePerGas = withBuffer(gasPrice);
  return {
    status: "ESTIMATED",
    estimatedGas: estimatedGas.toString(),
    gasPriceWei: gasPrice.toString(),
    pointEstimateWei: (estimatedGas * gasPrice).toString(),
    gasLimit: gasLimit.toString(),
    maxFeePerGasWei: maxFeePerGas.toString(),
    feeUpperBoundWei: (gasLimit * maxFeePerGas).toString(),
    l1Component,
    method: METHOD,
    notes,
    measuredAt,
  };
}
