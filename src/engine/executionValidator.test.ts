import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";
import { executionMandateSchema, mandateDigest, validateExecution, type ExecutionMandate, type ExecutionEvidence, type ExecutionState } from "./executionValidator.js";
import { prepareBuy, ROUTER_ABI } from "./prepareBuy.js";

// SYNTHETIC safety fixtures; never evidence of funded or live readiness.
const now = Date.parse("2026-09-24T15:00:00Z") / 1000;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
function fixture() {
  const route = { chainId: 4663 as const, token: addr(1), quoteToken: addr(2), pool: addr(3), router: addr(4), fee: 500, tokenDecimals: 18, quoteDecimals: 6 as const };
  const mandate: ExecutionMandate = {
    orderId: "synthetic-order", version: 1, owner: "operator", mode: "work_my_order", side: "BUY", signer: addr(5), recipient: addr(6), route,
    budget: "100000000", maxPerFill: "25000000", minimumFill: "1000000", partialFillAllowed: true,
    maxPriceMicroUsdg: "250000000", maxPremiumBps: 15, usdgParityAccepted: true, minCheapBps: 0, closedPolicy: "WAIT",
    maxSlippageBps: 30, maxPriceImpactBps: 100, maxFeedAgeSeconds: 900, maxQuoteAgeSeconds: 60, maxBlockAgeSeconds: 30,
    confirmedAt: now - 60, expiresAt: now + 3600, maxFillCount: 10, maxAttempts: 20, maxGasWei: "1000000", minimumGasReserveWei: "1000",
  };
  const evidence: ExecutionEvidence = {
    route, blockHash: `0x${"a".repeat(64)}`, blockNumber: "1", blockTimestamp: now, capturedAt: now,
    routeBytecodePresent: true, evidenceBlockFresh: true,
    reference: { answer: "25000000000", decimals: 8, roundId: "1", answeredInRound: "1", updatedAt: now - 10, oraclePaused: false, multiplierTransition: false },
    tradingHalt: false, corporateActionPending: false,
    quote: { amountIn: "25000000", amountOut: "100100000000000000", priceImpactBps: 5 },
    gasUpperBoundWei: "10000", walletGasBalanceWei: "100000", walletUsdgBalance: "100000000", allowance: "100000000",
    provenance: "SYNTHETIC",
  };
  const state: ExecutionState = { status: "ACTIVE", cancelled: false, settled: "0", reserved: "0", gasSpent: "0", gasReserved: "0", fillCount: 0, attempts: 0 };
  // Bound arithmetic is tested as a labeled preview on synthetic evidence.
  return { mandate, evidence, state, allowedRoute: route, configuredSigner: mandate.signer, now, confirmedHash: mandateDigest(mandate), purpose: "preview" as const };
}
function reconfirm(f: ReturnType<typeof fixture>) { f.confirmedHash = mandateDigest(f.mandate); return f; }

describe("integer execution gate (synthetic)", () => {
  it("enforces the stricter absolute price in calldata, with an on-chain deadline", () => {
    const f = fixture();
    const result = prepareBuy(f);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.reason);
    expect(result.minimumOutput).toBe("100000000000000000");
    const outer = decodeFunctionData({ abi: ROUTER_ABI, data: result.request.data });
    expect(outer.functionName).toBe("multicall");
    if (outer.functionName !== "multicall") throw new Error();
    expect(outer.args[0]).toBe(BigInt(now + 60));
    const inner = decodeFunctionData({ abi: ROUTER_ABI, data: outer.args[1][0]! });
    if (inner.functionName !== "exactInputSingle") throw new Error();
    expect(inner.args[0].amountOutMinimum).toBe(100000000000000000n);
    expect(inner.args[0].recipient.toLowerCase()).toBe(f.mandate.recipient);
    expect(result.transactionAuthorized).toBe(false);
  });
  it("ceil-rounds a price bound that falls between base units", () => {
    const f = fixture();
    f.mandate.maxPriceMicroUsdg = "249999999";
    const r = validateExecution(reconfirm(f));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error();
    expect(BigInt(r.minimumOutput) * 249999999n).toBeGreaterThanOrEqual(25000000n * 10n ** 18n);
    expect((BigInt(r.minimumOutput) - 1n) * 249999999n).toBeLessThan(25000000n * 10n ** 18n);
  });
  it("uses the slippage bound when it is stricter", () => {
    const f = fixture(); f.mandate.maxSlippageBps = 0;
    const r = validateExecution(reconfirm(f));
    expect(r.ok && r.minimumOutput).toBe(f.evidence.quote.amountOut);
  });
  it("enforces a reference-relative bound without floating point", () => {
    const f = fixture(); f.mandate.maxPriceMicroUsdg = null; f.mandate.maxPremiumBps = 0;
    const r = validateExecution(reconfirm(f));
    expect(r.ok && r.minimumOutput).toBe("100000000000000000");
  });
  it("requires a fresh quote when remaining size is smaller", () => {
    const f = fixture(); f.state.settled = "90000000";
    expect(validateExecution(f)).toEqual({ ok: false, reason: "SIZE_OUTSIDE_MANDATE" });
  });
  const mutations: [string, (f: ReturnType<typeof fixture>) => void][] = [
    ["pending budget", f => { f.state.reserved = "25000000"; }],
    ["overspent budget", f => { f.state.settled = "100000001"; }],
    ["stale reference", f => { f.evidence.reference.updatedAt = now - 901; }],
    ["future reference", f => { f.evidence.reference.updatedAt = now + 1; }],
    ["zero reference", f => { f.evidence.reference.answer = "0"; }],
    ["incomplete round", f => { f.evidence.reference.answeredInRound = "2"; }],
    ["stale quote", f => { f.evidence.capturedAt = now - 61; }],
    ["future quote", f => { f.evidence.capturedAt = now + 1; }],
    ["stale block", f => { f.evidence.blockTimestamp = now - 31; }],
    ["cancelled order", f => { Object.assign(f.state, { cancelled: true }); }],
    ["expired order", f => { f.now = f.mandate.expiresAt; }],
    ["paused oracle", f => { Object.assign(f.evidence.reference, { oraclePaused: true }); }],
    ["unknown pause state", f => { Object.assign(f.evidence.reference, { oraclePaused: null }); }],
    ["pending transition", f => { Object.assign(f.evidence.reference, { multiplierTransition: true }); }],
    ["corporate action", f => { Object.assign(f.evidence, { corporateActionPending: true }); }],
    ["halt", f => { Object.assign(f.evidence, { tradingHalt: true }); }],
    ["wrong route", f => { f.evidence.route = { ...f.evidence.route, pool: addr(8) }; }],
    ["changed mandate", f => { f.mandate.recipient = addr(9); }],
    ["wrong signer", f => { f.configuredSigner = addr(10); }],
    ["gas budget", f => { f.state.gasSpent = "999999"; }],
    ["gas reserve", f => { f.evidence.walletGasBalanceWei = "10000"; }],
    ["allowance", f => { f.evidence.allowance = "0"; }],
    ["balance", f => { f.evidence.walletUsdgBalance = "0"; }],
    ["attempt cap", f => { f.state.attempts = 20; }],
    ["fill cap", f => { f.state.fillCount = 10; }],
    ["price impact", f => { f.evidence.quote.priceImpactBps = 101; }],
    ["insufficient quoted output", f => { f.evidence.quote.amountOut = "99999999999999999"; }],
    ["missing route bytecode", f => { Object.assign(f.evidence, { routeBytecodePresent: false }); }],
    ["unmeasured route bytecode", f => { Object.assign(f.evidence, { routeBytecodePresent: null }); }],
    ["stale evidence block", f => { Object.assign(f.evidence, { evidenceBlockFresh: false }); }],
    ["unavailable gas bound", f => { Object.assign(f.evidence, { gasUpperBoundWei: null }); }],
    ["missing provenance", f => { delete (f.evidence as Partial<ExecutionEvidence>).provenance; }],
    ["mixed provenance", f => { Object.assign(f.evidence, { provenance: "MIXED" }); }],
  ];
  it.each(mutations)("blocks %s", (_, change) => {
    const f = fixture(); change(f); expect(validateExecution(f).ok).toBe(false);
  });
  it.each(["partial", "parity", "buy-now retry", "missing price"])("enforces confirmed %s policy", kind => {
    const f = fixture();
    if (kind === "partial") f.mandate.partialFillAllowed = false;
    if (kind === "parity") f.mandate.usdgParityAccepted = false;
    if (kind === "buy-now retry") { f.mandate.mode = "buy_now"; f.state.attempts = 1; }
    if (kind === "missing price") { f.mandate.maxPriceMicroUsdg = null; f.mandate.maxPremiumBps = null; }
    expect(validateExecution(reconfirm(f)).ok).toBe(false);
  });
  it("rejects float, malformed and overflowing money", () => {
    for (const budget of ["1.5", "NaN", "-1", "01", String(2n ** 256n)]) {
      expect(executionMandateSchema.safeParse({ ...fixture().mandate, budget }).success).toBe(false);
    }
  });
  it("price protection holds across many non-divisible candidate fills", () => {
    for (let i = 1n; i <= 100n; i++) {
      const f = fixture(); f.evidence.quote.amountIn = (1000000n + i * 1009n).toString();
      f.evidence.quote.amountOut = (BigInt(f.evidence.quote.amountIn) * 10n ** 18n / 249990000n).toString();
      const result = validateExecution(f);
      expect(result.ok).toBe(true);
      if (result.ok) expect(BigInt(result.minimumOutput) * 250000000n >= BigInt(result.amountIn) * 10n ** 18n).toBe(true);
    }
  });
});
