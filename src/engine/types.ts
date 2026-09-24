import type { Address, Hash } from "viem";

/**
 * Domain types for FairTick. Reconciles FairTick_PRD.md §8 with the merged
 * product plan (FairTick_Merged_Product_Plan.md §5-§6), which takes precedence
 * where the two disagree. Money amounts that flow through execution logic are
 * `bigint` integer base units (never floats) per the merged plan's invariant
 * section. Display-only numbers (premium bps, USD estimates) are `number`.
 */

export type Side = "BUY"; // SELL is out of first-release scope (merged plan §1, §2).

export type ClosedPolicy = "WAIT" | "ALLOW_IF_CHEAP" | "ALLOW";

export type ReferenceValidityPolicy = "WAIT_IF_STALE" | "REFUSE_IF_STALE";

export type Mode = "buy_now" | "work_my_order";

/**
 * Confirmed, immutable mandate. A new version requires explicit
 * reauthorization (merged plan §3 step 4) — this type is never mutated after
 * confirmation; a change produces a new Mandate with an incremented version
 * and the same orderId.
 */
export interface Mandate {
  orderId: string; // ulid
  version: number; // starts at 1
  mode: Mode;
  owner: string; // wallet or account identifier that authorized this mandate
  signerAddress: Address; // fixed execution signer
  recipientAddress: Address; // fixed recipient of purchased tokens
  chainId: 4663;
  symbol: string; // e.g. "NVDA" — must resolve in data/registry.json
  side: Side;

  // Budget & sizing, all in USDG base units (6 decimals) as integer strings.
  budgetUsdgBaseUnits: string;
  maxPerFillUsdgBaseUnits: string;
  partialFillAllowed: boolean;
  minViableFillUsdgBaseUnits: string;

  // Price / premium bounds. At least one of the two must be set; if both are
  // set, the stricter effective bound applies (merged plan §5).
  maxPriceUsdgPerToken: string | null; // decimal string, USDG per whole token
  maxPremiumBps: number | null; // vs the usable reference price

  maxFeedAgeSeconds: number;
  maxQuoteAgeSeconds: number;
  maxSlippageBps: number;
  referenceValidityPolicy: ReferenceValidityPolicy;
  closedPolicy: ClosedPolicy;
  minCheapBps: number; // 0 = not required

  expiresAt: string; // ISO
  maxFillCount: number;
  maxExecutionAttempts: number;
  maxCumulativeGasWei: string;
  minGasReserveWei: string;

  confirmedAt: string; // ISO
  mandateHash: Hash; // sha256/keccak of the canonical mandate JSON, computed at confirmation
}

export type SessionName = "REGULAR" | "PRE" | "POST" | "OVERNIGHT" | "WEEKEND" | "HOLIDAY";

export interface Session {
  name: SessionName;
  cashMarketOpen: boolean; // true only for REGULAR
  tz: "America/New_York";
  asOf: string; // ISO instant this classification was computed for
}

export type ReferenceStatus = "USABLE" | "STALE" | "PAUSED" | "UNAVAILABLE";

/**
 * Produced only by the QuoteEngine. Nothing else may fabricate or adjust
 * these fields — SERV never recomputes premiumBps (PRD §8.2).
 */
export interface MarketSnapshot {
  capturedAt: string; // ISO
  chainId: 4663;
  blockNumber: string;
  blockHash: Hash;
  symbol: string;
  token: Address;
  feedProxy: Address;
  pool: Address;
  poolFeeTier: number;
  quoteToken: "USDG";

  referenceStatus: ReferenceStatus;
  feedPriceUsd: number | null; // already multiplier-adjusted; null if unusable
  feedDecimals: number;
  feedRoundId: string | null;
  feedUpdatedAt: number | null; // unix seconds
  feedAgeSeconds: number | null;

  uiMultiplier: string; // raw uint256 as decimal string, display-only

  dexSpotPriceUsdg: number | null; // pool spot price, informational only — never the executed price
  executableQuote: {
    inputUsdgBaseUnits: string;
    outputTokenBaseUnits: string;
    effectivePriceUsdgPerToken: number;
    priceImpactBps: number | null;
    gasEstimateUnits: string | null;
  } | null;

  premiumBps: number | null; // (dex executable price - feed price) / feed price * 10_000

  poolTvlUsdgSide: number | null;
  tradingHalt: boolean | null;
  pendingCorporateAction: boolean;

  session: Session;
  notes: string[];
}

export type Action = "TAKE" | "WAIT" | "REFUSE" | "UNKNOWN";

export type RuleHit =
  | "RICH"
  | "CHEAP"
  | "FAIR"
  | "FEED_STALE"
  | "FEED_MISSING"
  | "FEED_PAUSED"
  | "SESSION_CLOSED"
  | "SESSION_OPEN"
  | "THIN_POOL"
  | "SIZE_CAPPED"
  | "MANDATE_SIDE"
  | "MISSING_INPUT"
  | "SQUEEZE_SUSPECTED"
  | "BUDGET_EXHAUSTED"
  | "TRADING_HALT"
  | "CORPORATE_ACTION_PENDING";

export type Decider = "serv" | "raw" | "threshold";

export interface DecisionPacket {
  action: Action;
  reason: string;
  ruleHits: RuleHit[];
  sizeUsdgBaseUnits: string; // "0" unless TAKE
  maxPriceUsdgPerToken: string | null;
  confidence: "low" | "medium" | "high";
  decider: Decider;
  model?: string;
  servRequestId?: string;
  snapshotHash: Hash;
  mandateId: string;
  mandateVersion: number;
  createdAt: string;
}

export type OrderStatus =
  | "DRAFT"
  | "ACTIVE"
  | "WAITING"
  | "SUBMITTING"
  | "PENDING"
  | "NEEDS_ATTENTION"
  | "COMPLETED"
  | "CANCELLED"
  | "EXPIRED";

export interface FillIntent {
  id: string; // ulid, unique per attempted fill — duplicate-broadcast guard key
  orderId: string;
  mandateVersion: number;
  createdAt: string;
  reservedUsdgBaseUnits: string;
  snapshotHash: Hash;
  minOutputTokenBaseUnits: string; // stricter of slippage bound vs mandate max-price bound
  status: "RESERVED" | "BROADCAST" | "CONFIRMED" | "FAILED" | "RECONCILED";
  txHash: Hash | null;
  nonce: number | null;
}

export interface Settlement {
  verified: boolean;
  method: "chain_logs_plus_feed";
  fillIntentId: string;
  tokenIn: Address;
  tokenOut: Address;
  amountInBaseUnits: string;
  amountOutBaseUnits: string;
  fillPriceUsdgPerToken: number;
  feedPriceUsdAtVerify: number | null;
  fillPremiumBps: number | null;
  feedAgeSecondsAtVerify: number | null;
  referenceRoundIdAtVerify: string | null;
  inclusionBlock: string;
  verifiedAt: string;
  notes: string[];
}

export interface Order {
  id: string; // ulid, == Mandate.orderId
  status: OrderStatus;
  mandate: Mandate; // latest confirmed version
  settledSpendUsdgBaseUnits: string;
  reservedPendingSpendUsdgBaseUnits: string;
  tokensReceivedBaseUnits: string;
  fillCount: number;
  attemptCount: number;
  lastDecision: DecisionPacket | null;
  nextCheckAt: string | null;
  waitingReason: string | null;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
  cancellationRequestedAt: string | null;
}
