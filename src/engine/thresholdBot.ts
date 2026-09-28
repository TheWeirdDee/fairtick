import type { DecisionPacket, Mandate, MarketSnapshot, RuleHit } from "./types.js";
import { snapshotHash } from "./hash.js";

export interface ThresholdBotInput {
  mandate: Mandate;
  snapshot: MarketSnapshot;
  /** settledSpend + reservedPendingSpend subtracted from budget, already computed by the order layer. */
  remainingBudgetUsdgBaseUnits: bigint;
  now?: Date;
}

/**
 * Deterministic, model-free baseline decider (PRD §11) and — for the
 * legacy decision display only. This is NOT the signing gate: the strict
 * executionValidator enforces integer transaction bounds and current state.
 * No network or LLM calls. Every branch is a pure function of its inputs.
 */
export function decideThreshold(input: ThresholdBotInput): DecisionPacket {
  const { mandate, snapshot } = input;
  const now = input.now ?? new Date();
  const base = {
    snapshotHash: snapshotHash(snapshot),
    mandateId: mandate.orderId,
    mandateVersion: mandate.version,
    createdAt: now.toISOString(),
    decider: "threshold" as const,
  };

  const refuse = (reason: string, ruleHits: RuleHit[]): DecisionPacket => ({
    ...base,
    action: "REFUSE",
    reason,
    ruleHits,
    sizeUsdgBaseUnits: "0",
    maxPriceUsdgPerToken: null,
    confidence: "high",
  });
  const wait = (reason: string, ruleHits: RuleHit[]): DecisionPacket => ({
    ...base,
    action: "WAIT",
    reason,
    ruleHits,
    sizeUsdgBaseUnits: "0",
    maxPriceUsdgPerToken: null,
    confidence: "high",
  });
  const unknown = (reason: string, ruleHits: RuleHit[]): DecisionPacket => ({
    ...base,
    action: "UNKNOWN",
    reason,
    ruleHits,
    sizeUsdgBaseUnits: "0",
    maxPriceUsdgPerToken: null,
    confidence: "high",
  });

  if (snapshot.session.name === "UNKNOWN" || snapshot.tradingHalt === null || snapshot.pendingCorporateAction === null) {
    return unknown("Required session or asset status is unavailable.", ["MISSING_INPUT"]);
  }
  if (snapshot.pendingCorporateAction) return wait("Pending corporate action requires review.", ["CORPORATE_ACTION_PENDING"]);

  // 1. Reference must be usable at all.
  if (snapshot.referenceStatus === "UNAVAILABLE") {
    return unknown("Feed or executable quote is missing or invalid; refusing to guess.", ["FEED_MISSING", "MISSING_INPUT"]);
  }
  if (snapshot.referenceStatus === "PAUSED") {
    return unknown("Reference feed is paused; no trade without a usable reference.", ["FEED_PAUSED"]);
  }
  if (snapshot.feedPriceUsd === null || !Number.isFinite(snapshot.feedPriceUsd) || snapshot.feedPriceUsd <= 0 || snapshot.executableQuote === null) {
    return unknown("Missing feed price or executable quote.", ["MISSING_INPUT"]);
  }
  if (snapshot.tradingHalt) {
    return refuse("Underlying equity is currently halted.", ["TRADING_HALT"]);
  }

  // 2. Staleness.
  if (snapshot.referenceStatus === "STALE" || (snapshot.feedAgeSeconds !== null && snapshot.feedAgeSeconds > mandate.maxFeedAgeSeconds)) {
    return wait(
      `Reference feed is ${snapshot.feedAgeSeconds ?? "unknown"}s old, exceeding the ${mandate.maxFeedAgeSeconds}s cap. Never TAKE on a stale feed.`,
      ["FEED_STALE"],
    );
  }

  const premiumBps = snapshot.premiumBps;
  if (premiumBps === null || !Number.isFinite(premiumBps)) {
    return unknown("Premium could not be computed from this snapshot.", ["MISSING_INPUT"]);
  }

  // 3. Budget already exhausted.
  if (input.remainingBudgetUsdgBaseUnits <= 0n) {
    return refuse("No remaining budget on this order.", ["BUDGET_EXHAUSTED"]);
  }

  // 4. Mandate rich-bound (BUY only; SELL out of scope for v1).
  if (mandate.maxPremiumBps !== null && premiumBps > mandate.maxPremiumBps) {
    return refuse(
      `Premium ${premiumBps.toFixed(1)} bps exceeds mandate cap of ${mandate.maxPremiumBps} bps.`,
      ["RICH"],
    );
  }

  // 5. Absolute price cap, if set, checked against the actual executable price.
  if (mandate.maxPriceUsdgPerToken !== null) {
    const cap = Number(mandate.maxPriceUsdgPerToken);
    if (snapshot.executableQuote.effectivePriceUsdgPerToken > cap) {
      return refuse(
        `Executable price ${snapshot.executableQuote.effectivePriceUsdgPerToken.toFixed(4)} USDG exceeds mandate max price ${cap} USDG.`,
        ["RICH"],
      );
    }
  }

  // 6. Session policy.
  if (!snapshot.session.cashMarketOpen) {
    if (mandate.closedPolicy === "WAIT") {
      return wait(`Cash market is closed (${snapshot.session.name}) and mandate policy is WAIT.`, ["SESSION_CLOSED"]);
    }
    if (mandate.closedPolicy === "ALLOW_IF_CHEAP") {
      const cheapThreshold = mandate.minCheapBps > 0 ? mandate.minCheapBps : 25;
      if (premiumBps > -cheapThreshold) {
        return wait(
          `Cash market closed (${snapshot.session.name}); premium ${premiumBps.toFixed(1)} bps does not clear the ${cheapThreshold} bps discount required to buy while closed.`,
          ["SESSION_CLOSED", "FAIR"],
        );
      }
    }
    // ALLOW_IF_CHEAP passing the discount check, or ALLOW: fall through to sizing.
  }

  // 7. Dead-band requirement during open sessions.
  if (snapshot.session.cashMarketOpen && mandate.minCheapBps > 0 && premiumBps > -mandate.minCheapBps) {
    return wait(
      `Premium ${premiumBps.toFixed(1)} bps does not clear the mandate's required ${mandate.minCheapBps} bps discount.`,
      ["FAIR"],
    );
  }

  // 8. TAKE — size within remaining budget and per-fill cap. Depth-aware
  // shrinking (PRD §11 step 8's midDepthUsd*0.1) is deferred: poolTvlUsdgSide
  // is not yet computed by the QuoteEngine (see DATA-CONTRACT.md §2 item 5
  // successor list), so v1 sizes conservatively by budget/per-fill caps only.
  const maxPerFill = BigInt(mandate.maxPerFillUsdgBaseUnits);
  let size = input.remainingBudgetUsdgBaseUnits < maxPerFill ? input.remainingBudgetUsdgBaseUnits : maxPerFill;
  const ruleHits: RuleHit[] = [premiumBps < 0 ? "CHEAP" : "FAIR"];
  if (size < maxPerFill || size < input.remainingBudgetUsdgBaseUnits) {
    ruleHits.push("SIZE_CAPPED");
  }
  if (snapshot.session.cashMarketOpen) ruleHits.push("SESSION_OPEN");

  const minViable = BigInt(mandate.minViableFillUsdgBaseUnits);
  if (size < minViable) {
    return wait(
      `Permitted size ${size.toString()} USDG-base-units is below the mandate's minimum viable fill ${minViable.toString()}.`,
      ["SIZE_CAPPED"],
    );
  }

  if (size.toString() !== snapshot.executableQuote.inputUsdgBaseUnits) {
    return wait("Obtain an actual-size quote for the permitted fill amount.", ["SIZE_CAPPED"]);
  }

  return {
    ...base,
    action: "TAKE",
    reason: `Premium ${premiumBps.toFixed(1)} bps is within mandate limits during ${snapshot.session.name}.`,
    ruleHits,
    sizeUsdgBaseUnits: size.toString(),
    maxPriceUsdgPerToken: mandate.maxPriceUsdgPerToken,
    confidence: "high",
  };
}
