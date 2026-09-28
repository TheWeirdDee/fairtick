import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ simulate: vi.fn(), gasPrice: vi.fn(), estimate: vi.fn(), code: vi.fn() }));
vi.mock("./chain.js", () => ({ getPublicClient: () => ({ simulateContract: mock.simulate, getGasPrice: mock.gasPrice, estimateGas: mock.estimate, getBytecode: mock.code }) }));
import { estimateTransactionFee, checkRouteBytecodePresent, isEvidenceBlockFresh, EVIDENCE_BLOCK_MAX_LAG_SECONDS, NODE_INTERFACE_ADDRESS } from "./executionEvidence.js";

// SYNTHETIC RPC responses. These test fee arithmetic and unavailability handling,
// not live fees. Semantics under test (docs.arbitrum.io, How to estimate gas; nitro-contracts
// NodeInterface.sol): eth_estimateGas includes the L1 posting buffer; gasEstimateForL1 is a
// subset of it, in L2 gas units, priced at the L2 baseFee.
const to = "0x0000000000000000000000000000000000000004", from = "0x0000000000000000000000000000000000000005", data = "0x1234";
afterEach(() => { vi.resetAllMocks(); });
function rpc({ l1, price, gas }: { l1: readonly [bigint, bigint, bigint] | Error; price: bigint | Error; gas: bigint | Error }) {
  mock.simulate.mockImplementation(async () => { if (l1 instanceof Error) throw l1; return { result: l1 }; });
  mock.gasPrice.mockImplementation(async () => { if (price instanceof Error) throw price; return price; });
  mock.estimate.mockImplementation(async () => { if (gas instanceof Error) throw gas; return gas; });
}

describe("total transaction fee on an Arbitrum Nitro chain", () => {
  it("reports a nonzero L1 posting cost as a subset of eth_estimateGas and never adds it again", async () => {
    rpc({ l1: [5000n, 100n, 7n], price: 100n, gas: 150000n });
    const f = await estimateTransactionFee({ to, data, from });
    expect(f).toMatchObject({ status: "ESTIMATED", estimatedGas: "150000", gasPriceWei: "100", pointEstimateWei: "15000000", gasLimit: "180000", maxFeePerGasWei: "120", feeUpperBoundWei: "21600000" });
    expect(f.l1Component).toEqual({ status: "MEASURED", gasUnits: "5000", l2BaseFeeWei: "100", wei: "500000", l1BaseFeeEstimateWei: "7" });
    expect(f.pointEstimateWei).not.toBe("15500000"); // what double counting would produce
    expect(f.l1Component.wei).not.toBe("35000"); // L2 gas units priced at the L1 estimate: a unit error
    expect(BigInt(f.l1Component.wei!)).toBeLessThanOrEqual(BigInt(f.pointEstimateWei!));
    expect(mock.simulate).toHaveBeenCalledWith(expect.objectContaining({ address: NODE_INTERFACE_ADDRESS, functionName: "gasEstimateL1Component", args: [to, false, data] }));
  });

  it("records a genuinely measured zero L1 component as zero", async () => {
    rpc({ l1: [0n, 35774000n, 0n], price: 35850000n, gas: 120000n });
    const f = await estimateTransactionFee({ to, data, from });
    expect(f.l1Component).toMatchObject({ status: "MEASURED", gasUnits: "0", wei: "0" });
    expect(f.notes).toContain("L1_COMPONENT_MEASURED_ZERO");
    expect(f.pointEstimateWei).toBe((120000n * 35850000n).toString());
  });

  it("keeps a failed precompile read unavailable, not zero", async () => {
    rpc({ l1: new Error("SYNTHETIC: NodeInterface unsupported"), price: 100n, gas: 150000n });
    const f = await estimateTransactionFee({ to, data, from });
    expect(f.l1Component).toEqual({ status: "UNAVAILABLE", gasUnits: null, l2BaseFeeWei: null, wei: null, l1BaseFeeEstimateWei: null });
    expect(f.notes).toContain("L1_COMPONENT_UNAVAILABLE");
    // The total still comes from eth_estimateGas, which already includes L1 posting.
    expect(f).toMatchObject({ status: "ESTIMATED", pointEstimateWei: "15000000" });
  });

  it("is unavailable with null amounts when sender-specific gas estimation fails", async () => {
    rpc({ l1: [0n, 100n, 0n], price: 100n, gas: new Error("execution reverted: STF") });
    const f = await estimateTransactionFee({ to, data, from });
    expect(f).toMatchObject({ status: "UNAVAILABLE", estimatedGas: null, pointEstimateWei: null, gasLimit: null, maxFeePerGasWei: null, feeUpperBoundWei: null, gasPriceWei: "100" });
    expect(f.notes.some(n => n.startsWith("GAS_ESTIMATE_FAILED"))).toBe(true);
  });

  it("does not estimate without a configured sender", async () => {
    rpc({ l1: [0n, 100n, 0n], price: 100n, gas: 150000n });
    const f = await estimateTransactionFee({ to, data });
    expect(f).toMatchObject({ status: "UNAVAILABLE", feeUpperBoundWei: null });
    expect(f.notes).toContain("NO_CONFIGURED_SENDER");
    expect(mock.estimate).not.toHaveBeenCalled();
  });

  it("is unavailable when the gas price cannot be read", async () => {
    rpc({ l1: [0n, 100n, 0n], price: new Error("SYNTHETIC: RPC down"), gas: 150000n });
    const f = await estimateTransactionFee({ to, data, from });
    expect(f).toMatchObject({ status: "UNAVAILABLE", gasPriceWei: null, feeUpperBoundWei: null });
    expect(f.notes).toContain("GAS_PRICE_UNAVAILABLE");
  });

  it("uses integer ceiling buffers with a self-consistent upper bound", async () => {
    rpc({ l1: [2n, 3n, 0n], price: 3n, gas: 7n });
    const f = await estimateTransactionFee({ to, data, from });
    expect(f).toMatchObject({ pointEstimateWei: "21", gasLimit: "9", maxFeePerGasWei: "4", feeUpperBoundWei: "36" });
    expect(BigInt(f.feeUpperBoundWei!)).toBe(BigInt(f.gasLimit!) * BigInt(f.maxFeePerGasWei!));
    expect(BigInt(f.feeUpperBoundWei!)).toBeGreaterThanOrEqual(BigInt(f.pointEstimateWei!));
    for (const v of [f.estimatedGas, f.gasPriceWei, f.pointEstimateWei, f.gasLimit, f.maxFeePerGasWei, f.feeUpperBoundWei]) expect(v).toMatch(/^\d+$/);
  });

  it("refuses to estimate when the reported L1 subset exceeds the total", async () => {
    rpc({ l1: [200n, 3n, 0n], price: 3n, gas: 150n });
    const f = await estimateTransactionFee({ to, data, from });
    expect(f).toMatchObject({ status: "UNAVAILABLE", feeUpperBoundWei: null });
    expect(f.notes).toContain("L1_COMPONENT_EXCEEDS_TOTAL_ESTIMATE");
  });
});

describe("named checks establish only what they measure", () => {
  it("route bytecode presence reports each address and fails if any has no code", async () => {
    mock.code.mockImplementation(async ({ address }: { address: string }) => (address.endsWith("3") ? undefined : "0x6080"));
    const r = await checkRouteBytecodePresent({ token: "0x0000000000000000000000000000000000000002", pool: "0x0000000000000000000000000000000000000003" }, 10n);
    expect(r).toEqual({ allPresent: false, bytesPresent: { token: 2, pool: 0 } });
    expect(mock.code).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 10n }));
  });

  it("evidence block freshness is a bounded lag that rejects future timestamps", () => {
    expect(isEvidenceBlockFresh(1000, 1000 + EVIDENCE_BLOCK_MAX_LAG_SECONDS)).toBe(true);
    expect(isEvidenceBlockFresh(1000, 1001 + EVIDENCE_BLOCK_MAX_LAG_SECONDS)).toBe(false);
    expect(isEvidenceBlockFresh(1001, 1000)).toBe(false);
  });
});
