import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ read: vi.fn(), simulate: vi.fn(), block: vi.fn(), chain: vi.fn() }));
vi.mock("../lib/chain.js", () => ({ USDG_DECIMALS: 6, assertChainId: mock.chain, getPublicClient: () => ({ readContract: mock.read, simulateContract: mock.simulate, getBlock: mock.block }) }));
import { getMarketSnapshot } from "./quote.js";
const now = new Date("2026-09-24T15:00:00Z"), timestamp = BigInt(now.getTime() / 1000);

function setup(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    oraclePaused: false, uiMultiplier: 1000000000000000000n, newUIMultiplier: 1000000000000000000n, effectiveAt: 0n,
    decimals: 8, latestRoundData: [1n, 25000000000n, timestamp - 10n, timestamp - 10n, 1n],
    slot0: [2n ** 96n, 0, 0, 0, 0, 0, true], token0: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", ...overrides,
  };
  mock.chain.mockResolvedValue(undefined);
  mock.block.mockResolvedValue({ number: 100n, hash: `0x${"a".repeat(64)}`, timestamp });
  mock.read.mockImplementation(async ({ functionName }: { functionName: string }) => {
    if (values[functionName] instanceof Error) throw values[functionName];
    return values[functionName];
  });
  mock.simulate.mockResolvedValue({ result: [100000000000000000n, 0n, 0, 100000n] });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes("prices")
    ? { quotes: [{ tokenSymbol: "NVDA", isTradingHalt: false, generatedAt: now.toISOString() }] } : { corpActions: [] } })));
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("live adapter contract with synthetic RPC responses", () => {
  it("pins all reads and quote to one block and never reapplies multiplier", async () => {
    setup({ uiMultiplier: 2000000000000000000n, newUIMultiplier: 2000000000000000000n });
    const snap = await getMarketSnapshot({ symbol: "NVDA", now });
    expect(snap.feedPriceUsd).toBe(250);
    expect(snap.referenceStatus).toBe("USABLE");
    expect(snap.pendingCorporateAction).toBe(false);
    for (const [call] of mock.read.mock.calls) expect(call.blockNumber).toBe(100n);
    expect(mock.simulate.mock.calls[0]![0].blockNumber).toBe(100n);
  });
  it.each([
    ["STALE", { latestRoundData: [1n, 25000000000n, timestamp - 1000n, timestamp - 1000n, 1n] }],
    ["PAUSED", { oraclePaused: true }],
    ["UNAVAILABLE", { newUIMultiplier: 2000000000000000000n }],
    ["UNAVAILABLE", { oraclePaused: new Error("secret rpc URL") }],
    ["UNAVAILABLE", { latestRoundData: [1n, 25000000000n, timestamp, timestamp + 1n, 1n] }],
    ["UNAVAILABLE", { latestRoundData: [1n, 0n, timestamp, timestamp, 1n] }],
  ])("reports %s and withholds premium for unsafe reference", async (status, overrides) => {
    setup(overrides);
    const snap = await getMarketSnapshot({ symbol: "NVDA", now });
    expect(snap.referenceStatus).toBe(status);
    expect(snap.premiumBps).toBe(null);
    expect(JSON.stringify(snap)).not.toContain("secret rpc URL");
  });
  it("does not replace missing metadata with registry values", async () => {
    setup(); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unavailable")));
    const snap = await getMarketSnapshot({ symbol: "NVDA", now });
    expect(snap.tradingHalt).toBe(null);
    expect(snap.pendingCorporateAction).toBe(null);
  });
  it("distinguishes a future scheduled multiplier from an active oracle pause", async () => {
    setup({newUIMultiplier:2000000000000000000n,effectiveAt:timestamp+3600n});
    const snap=await getMarketSnapshot({symbol:"NVDA",now});
    expect(snap.oraclePaused).toBe(false);expect(snap.multiplierState).toBe("SCHEDULED");
    expect(snap.referenceStatus).toBe("UNAVAILABLE");
  });
});
