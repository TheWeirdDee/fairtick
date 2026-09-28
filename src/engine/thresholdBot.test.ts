import { describe, expect, it } from "vitest";
import { decideThreshold } from "./thresholdBot.js";
import type { Mandate, MarketSnapshot, Session } from "./types.js";

const NOW = new Date("2026-09-24T15:00:00Z"); // Thursday 11:00 EDT -> REGULAR

function makeSession(overrides: Partial<Session> = {}): Session {
  return { name: "REGULAR", cashMarketOpen: true, tz: "America/New_York", asOf: NOW.toISOString(), ...overrides };
}

function makeMandate(overrides: Partial<Mandate> = {}): Mandate {
  return {
    orderId: "order_test",
    version: 1,
    mode: "buy_now",
    owner: "test-owner",
    signerAddress: "0x0000000000000000000000000000000000dEaD",
    recipientAddress: "0x0000000000000000000000000000000000dEaD",
    chainId: 4663,
    symbol: "NVDA",
    side: "BUY",
    budgetUsdgBaseUnits: "25000000", // 25 USDG
    maxPerFillUsdgBaseUnits: "25000000",
    partialFillAllowed: true,
    minViableFillUsdgBaseUnits: "1000000", // 1 USDG
    maxPriceUsdgPerToken: null,
    maxPremiumBps: 15,
    maxFeedAgeSeconds: 900,
    maxQuoteAgeSeconds: 60,
    maxSlippageBps: 30,
    referenceValidityPolicy: "WAIT_IF_STALE",
    closedPolicy: "WAIT",
    minCheapBps: 0,
    expiresAt: new Date(NOW.getTime() + 3600_000).toISOString(),
    maxFillCount: 10,
    maxExecutionAttempts: 20,
    maxCumulativeGasWei: "1000000000000000000",
    minGasReserveWei: "0",
    confirmedAt: NOW.toISOString(),
    mandateHash: "0xdeadbeef",
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    capturedAt: NOW.toISOString(),
    chainId: 4663,
    blockNumber: "71464115",
    blockHash: "0x33f6361b5ef3df9f3aab10040854fd101b29d42aa732aa856e9af2e57bd1b683",
    symbol: "NVDA",
    token: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC",
    feedProxy: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15",
    pool: "0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3",
    poolFeeTier: 500,
    quoteToken: "USDG",
    referenceStatus: "USABLE",
    feedPriceUsd: 221.97,
    feedDecimals: 8,
    feedRoundId: "18446744073709552713",
    feedUpdatedAt: Math.floor(NOW.getTime() / 1000) - 60,
    feedAgeSeconds: 60,
    uiMultiplier: "1000775159164630595",
    dexSpotPriceUsdg: 221.97,
    executableQuote: {
      inputUsdgBaseUnits: "25000000",
      outputTokenBaseUnits: "112627066682262440",
      effectivePriceUsdgPerToken: 221.97,
      priceImpactBps: 0.1,
      gasEstimateUnits: "109356",
    },
    premiumBps: 0,
    poolTvlUsdgSide: 2800000,
    tradingHalt: false,
    pendingCorporateAction: false,
    session: makeSession(),
    notes: [],
    ...overrides,
  };
}

const remaining = 25_000_000n;

describe("decideThreshold — one packet per fixture bucket (PRD §18)", () => {
  it("TAKE: regular hours, cheap, fresh feed", () => {
    const d = decideThreshold({
      mandate: makeMandate(),
      snapshot: makeSnapshot({ premiumBps: -25 }),
      remainingBudgetUsdgBaseUnits: remaining,
    });
    expect(d.action).toBe("TAKE");
    expect(BigInt(d.sizeUsdgBaseUnits)).toBeGreaterThan(0n);
  });

  it("REFUSE: regular hours, rich beyond maxPremiumBps", () => {
    const d = decideThreshold({
      mandate: makeMandate({ maxPremiumBps: 15 }),
      snapshot: makeSnapshot({ premiumBps: 40 }),
      remainingBudgetUsdgBaseUnits: remaining,
    });
    expect(d.action).toBe("REFUSE");
    expect(d.ruleHits).toContain("RICH");
  });

  it("WAIT or REFUSE: inside dead band when minCheapBps required", () => {
    const d = decideThreshold({
      mandate: makeMandate({ minCheapBps: 20 }),
      snapshot: makeSnapshot({ premiumBps: -5 }), // cheap, but not cheap enough
      remainingBudgetUsdgBaseUnits: remaining,
    });
    expect(["WAIT", "REFUSE"]).toContain(d.action);
    expect(d.action).not.toBe("TAKE");
  });

  it("WAIT/UNKNOWN, never TAKE: stale feed even if attractively priced", () => {
    const d = decideThreshold({
      mandate: makeMandate({ maxFeedAgeSeconds: 900 }),
      snapshot: makeSnapshot({ premiumBps: -50, feedAgeSeconds: 3122, referenceStatus: "STALE" }),
      remainingBudgetUsdgBaseUnits: remaining,
    });
    expect(["WAIT", "UNKNOWN"]).toContain(d.action);
    expect(d.action).not.toBe("TAKE");
    expect(d.ruleHits).toContain("FEED_STALE");
  });

  it("WAIT: weekend mild drift with closedPolicy WAIT", () => {
    const d = decideThreshold({
      mandate: makeMandate({ closedPolicy: "WAIT" }),
      snapshot: makeSnapshot({ premiumBps: -30, session: makeSession({ name: "WEEKEND", cashMarketOpen: false }) }),
      remainingBudgetUsdgBaseUnits: remaining,
    });
    expect(d.action).toBe("WAIT");
    expect(d.ruleHits).toContain("SESSION_CLOSED");
  });

  it("TAKE: weekend deep discount with closedPolicy ALLOW_IF_CHEAP", () => {
    const d = decideThreshold({
      mandate: makeMandate({ closedPolicy: "ALLOW_IF_CHEAP", minCheapBps: 0 }),
      snapshot: makeSnapshot({ premiumBps: -80, session: makeSession({ name: "WEEKEND", cashMarketOpen: false }) }),
      remainingBudgetUsdgBaseUnits: remaining,
    });
    expect(d.action).toBe("TAKE");
  });

  it("REFUSE (squeeze-shaped): weekend wide premium — threshold bot refuses on RICH, never sets SQUEEZE_SUSPECTED itself", () => {
    const d = decideThreshold({
      mandate: makeMandate({ closedPolicy: "ALLOW_IF_CHEAP" }),
      snapshot: makeSnapshot({ premiumBps: 60, session: makeSession({ name: "WEEKEND", cashMarketOpen: false }) }),
      remainingBudgetUsdgBaseUnits: remaining,
    });
    expect(d.action).toBe("REFUSE");
    expect(d.ruleHits).not.toContain("SQUEEZE_SUSPECTED");
  });

  it("UNKNOWN: missing/unusable feed", () => {
    const d = decideThreshold({
      mandate: makeMandate(),
      snapshot: makeSnapshot({ referenceStatus: "UNAVAILABLE", feedPriceUsd: null, executableQuote: null, premiumBps: null }),
      remainingBudgetUsdgBaseUnits: remaining,
    });
    expect(d.action).toBe("UNKNOWN");
  });

  it("REFUSE: trading halt hard-blocks regardless of price", () => {
    const d = decideThreshold({
      mandate: makeMandate(),
      snapshot: makeSnapshot({ premiumBps: -50, tradingHalt: true }),
      remainingBudgetUsdgBaseUnits: remaining,
    });
    expect(d.action).toBe("REFUSE");
    expect(d.ruleHits).toContain("TRADING_HALT");
  });

  it("REFUSE: budget already exhausted", () => {
    const d = decideThreshold({
      mandate: makeMandate(),
      snapshot: makeSnapshot({ premiumBps: -50 }),
      remainingBudgetUsdgBaseUnits: 0n,
    });
    expect(d.action).toBe("REFUSE");
    expect(d.ruleHits).toContain("BUDGET_EXHAUSTED");
  });

  it("never exceeds mandate.maxPerFillUsdgBaseUnits when sizing a TAKE", () => {
    const d = decideThreshold({
      mandate: makeMandate({ maxPerFillUsdgBaseUnits: "5000000" }),
      snapshot: makeSnapshot({ premiumBps: -50 }),
      remainingBudgetUsdgBaseUnits: 25_000_000n,
    });
    expect(d.action).toBe("WAIT");
    expect(d.reason).toContain("actual-size quote");
  });
});
