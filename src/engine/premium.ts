/**
 * premiumBps = ((dex - feed) / feed) * 10_000
 *
 * Positive = DEX rich to feed (a buyer overpays vs the official reference).
 * Negative = DEX cheap to feed.
 *
 * Both inputs must already be multiplier-adjusted, raw-token USD/USDG
 * prices from the same snapshot. This function never recomputes or is
 * recomputed by a model (PRD §8.2) — it is the single source of truth the
 * rest of the engine (and every decider) must treat as authoritative.
 */
export function computePremiumBps(dexPrice: number, feedPrice: number): number {
  if (!Number.isFinite(dexPrice) || !Number.isFinite(feedPrice) || feedPrice <= 0) {
    throw new Error(
      `computePremiumBps requires a finite dexPrice and a positive finite feedPrice; got dexPrice=${dexPrice}, feedPrice=${feedPrice}`,
    );
  }
  return ((dexPrice - feedPrice) / feedPrice) * 10_000;
}
