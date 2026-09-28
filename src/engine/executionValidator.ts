import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson } from "./hash.js";
import { sessionAt } from "./session.js";
import { isAttestedLive, type EvidenceProvenance, type ExecutionPurpose } from "./provenance.js";

const isUint = (v: string) => /^(0|[1-9][0-9]*)$/.test(v) && v.length <= 78 && BigInt(v) < 2n ** 256n;
const uint = z.string().refine(isUint);
const positive = uint.refine(v => isUint(v) && BigInt(v) > 0n);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).refine(v => !/^0x0{40}$/.test(v));
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
// 4663 = Robinhood Chain mainnet; 46630 = testnet (mock demo market). The allowed route pins which one.
const routeSchema = z.object({ chainId: z.union([z.literal(4663), z.literal(46630)]), token: address, quoteToken: address, pool: address, router: address, fee: z.number().int().min(1).max(10000), tokenDecimals: z.number().int().min(0).max(36), quoteDecimals: z.literal(6) }).strict();

/** New confirmed execution contract; legacy Mandate is advisory/display only. */
export const executionMandateSchema = z.object({
  orderId: z.string().min(1).max(128), version: z.number().int().positive(), owner: z.string().min(1),
  mode: z.enum(["buy_now", "work_my_order"]), side: z.literal("BUY"),
  signer: address, recipient: address, route: routeSchema,
  budget: positive, maxPerFill: positive, minimumFill: positive, partialFillAllowed: z.boolean(),
  // Micro-USDG per whole token, or reference premium with explicit parity consent.
  maxPriceMicroUsdg: positive.nullable(), maxPremiumBps: z.number().int().min(-9999).max(10000).nullable(),
  usdgParityAccepted: z.boolean(), minCheapBps: z.number().int().min(0).max(9999),
  closedPolicy: z.enum(["WAIT", "ALLOW", "ALLOW_IF_CHEAP"]),
  maxSlippageBps: z.number().int().min(0).max(9999), maxPriceImpactBps: z.number().int().min(0).max(10000),
  maxFeedAgeSeconds: integer, maxQuoteAgeSeconds: integer, maxBlockAgeSeconds: integer,
  confirmedAt: integer, expiresAt: integer, maxFillCount: z.number().int().positive(), maxAttempts: z.number().int().positive(),
  maxGasWei: positive, minimumGasReserveWei: uint,
}).strict().refine(m => m.maxPriceMicroUsdg !== null || m.maxPremiumBps !== null, "Price bound required")
  .refine(m => [m.minimumFill, m.maxPerFill, m.budget].every(isUint) && m.expiresAt > m.confirmedAt && BigInt(m.minimumFill) <= BigInt(m.maxPerFill) && BigInt(m.maxPerFill) <= BigInt(m.budget), "Invalid mandate limits");

export type ExecutionMandate = z.infer<typeof executionMandateSchema>;
export type ExecutionRoute = z.infer<typeof routeSchema>;
export function mandateDigest(mandate: ExecutionMandate): string {
  return `0x${createHash("sha256").update(canonicalJson(mandate)).digest("hex")}`;
}

const evidenceSchema = z.object({
  route: routeSchema, blockHash: hash, blockNumber: uint, blockTimestamp: integer, capturedAt: integer,
  // Named for what is measured: code present at each route address (not code
  // identity) and a fresh evidence block (not comprehensive network health).
  routeBytecodePresent: z.literal(true), evidenceBlockFresh: z.literal(true),
  reference: z.object({ answer: positive, decimals: z.number().int().min(0).max(36), roundId: positive, answeredInRound: positive, updatedAt: integer, oraclePaused: z.literal(false), multiplierTransition: z.literal(false) }).strict(),
  tradingHalt: z.literal(false), corporateActionPending: z.literal(false),
  quote: z.object({ amountIn: positive, amountOut: positive, priceImpactBps: z.number().finite().min(0) }).strict(),
  // Must include conservative L2 total fees, not the Quoter's gas units.
  gasUpperBoundWei: positive, walletGasBalanceWei: uint, walletUsdgBalance: uint, allowance: uint,
  // Required. A "LIVE" label alone is a claim; live execution also needs adapter attestation.
  provenance: z.enum(["LIVE", "SYNTHETIC", "REPLAY", "MIXED"]),
}).strict();
export type ExecutionEvidence = z.infer<typeof evidenceSchema>;
const stateSchema = z.object({
  status: z.enum(["ACTIVE", "WAITING"]), cancelled: z.literal(false),
  settled: uint, reserved: uint, gasSpent: uint, gasReserved: uint,
  fillCount: integer, attempts: integer,
}).strict();
export type ExecutionState = z.infer<typeof stateSchema>;

export function ceilDiv(n: bigint, d: bigint): bigint {
  if (n < 0n || d <= 0n) throw new Error("Invalid nonnegative ratio");
  return (n + d - 1n) / d;
}

/** Pure pre-signing foundation. Passing is NOT signing permission or a lock.
 * Caller must hold durable order and wallet coordination and re-read immediately
 * before signing. No caller or network adapter is wired to signing in this build.
 */
export function validateExecution(input: {
  mandate: unknown; confirmedHash: string; evidence: unknown; state: unknown;
  allowedRoute: ExecutionRoute; configuredSigner: string; now: number;
  purpose: ExecutionPurpose;
}): { ok: false; reason: string } | { ok: true; amountIn: string; minimumOutput: string; referenceRound: string; deadline: number; mandateHash: string; provenance: EvidenceProvenance; liveExecutable: boolean } {
  const deny = (reason: string) => ({ ok: false as const, reason });
  const mp = executionMandateSchema.safeParse(input.mandate);
  const ep = evidenceSchema.safeParse(input.evidence);
  const sp = stateSchema.safeParse(input.state);
  if (!mp.success) return deny("INVALID_MANDATE");
  if (!ep.success) return deny("UNUSABLE_EVIDENCE");
  if (!sp.success) return deny("ORDER_NOT_EXECUTABLE");
  const m = mp.data, e = ep.data, s = sp.data;
  // Provenance first. Anything but an explicit "preview" is held to live-execution rules.
  const purpose: ExecutionPurpose = input.purpose === "preview" ? "preview" : "live_execution";
  if (e.provenance === "MIXED") return deny("EVIDENCE_PROVENANCE_MIXED");
  const liveExecutable = e.provenance === "LIVE" && isAttestedLive(input.evidence);
  if (purpose === "live_execution" && !liveExecutable) return deny("EVIDENCE_NOT_LIVE");
  const now = input.now;
  if (!Number.isSafeInteger(now) || now < m.confirmedAt || now >= m.expiresAt) return deny("EXPIRED_OR_INVALID_CLOCK");
  if (mandateDigest(m) !== input.confirmedHash) return deny("MANDATE_CHANGED");
  if (m.signer.toLowerCase() !== input.configuredSigner.toLowerCase()) return deny("SIGNER_MISMATCH");
  const routeKey = (r: ExecutionRoute) => canonicalJson(r).toLowerCase();
  if (routeKey(m.route) !== routeKey(input.allowedRoute) || routeKey(e.route) !== routeKey(m.route)) return deny("ROUTE_MISMATCH");
  const ageValid = (at: number, limit: number) => at > 0 && at <= now && now - at <= limit;
  if (!ageValid(e.capturedAt, m.maxQuoteAgeSeconds) || !ageValid(e.blockTimestamp, m.maxBlockAgeSeconds)) return deny("QUOTE_OR_BLOCK_STALE");
  const r = e.reference;
  if (!ageValid(r.updatedAt, m.maxFeedAgeSeconds) || r.updatedAt > e.blockTimestamp || r.roundId !== r.answeredInRound) return deny("REFERENCE_INVALID_OR_STALE");
  const session = sessionAt(new Date(now * 1000));
  if (session.name === "UNKNOWN") return deny("SESSION_UNKNOWN");
  if (!session.cashMarketOpen && m.closedPolicy === "WAIT") return deny("SESSION_CLOSED");
  const budget = BigInt(m.budget), settled = BigInt(s.settled), reserved = BigInt(s.reserved);
  if (settled + reserved > budget) return deny("BUDGET_INVARIANT_BROKEN");
  if (reserved !== 0n || BigInt(s.gasReserved) !== 0n) return deny("PENDING_RECONCILIATION");
  const amount = BigInt(e.quote.amountIn), output = BigInt(e.quote.amountOut);
  if (amount > budget - settled - reserved || amount > BigInt(m.maxPerFill) || amount < BigInt(m.minimumFill)) return deny("SIZE_OUTSIDE_MANDATE");
  if (!m.partialFillAllowed && amount !== budget - settled) return deny("PARTIAL_FILL_FORBIDDEN");
  if (s.fillCount >= m.maxFillCount || s.attempts >= m.maxAttempts || (m.mode === "buy_now" && s.attempts > 0)) return deny("ATTEMPT_OR_FILL_LIMIT");
  if (amount > BigInt(e.walletUsdgBalance) || amount > BigInt(e.allowance)) return deny("INSUFFICIENT_BALANCE_OR_ALLOWANCE");
  const gas = BigInt(e.gasUpperBoundWei);
  if (gas + BigInt(s.gasSpent) + BigInt(s.gasReserved) > BigInt(m.maxGasWei) || gas + BigInt(m.minimumGasReserveWei) > BigInt(e.walletGasBalanceWei)) return deny("GAS_LIMIT");
  if (e.quote.priceImpactBps > m.maxPriceImpactBps) return deny("PRICE_IMPACT_LIMIT");

  const tokenScale = 10n ** BigInt(m.route.tokenDecimals);
  let minimum = ceilDiv(output * BigInt(10000 - m.maxSlippageBps), 10000n);
  if (m.maxPriceMicroUsdg !== null) minimum = max(minimum, ceilDiv(amount * tokenScale, BigInt(m.maxPriceMicroUsdg)));
  let premium = m.maxPremiumBps;
  const cheap = !session.cashMarketOpen && m.closedPolicy === "ALLOW_IF_CHEAP" ? (m.minCheapBps || 25) : m.minCheapBps;
  if (cheap > 0) premium = premium === null ? -cheap : Math.min(premium, -cheap);
  if (premium !== null) {
    if (!m.usdgParityAccepted) return deny("USDG_PARITY_NOT_ACCEPTED");
    minimum = max(minimum, ceilDiv(amount * tokenScale * 10n ** BigInt(r.decimals) * 10000n, BigInt(r.answer) * 1000000n * BigInt(10000 + premium)));
  }
  if (minimum > output) return deny("PRICE_BOUND_EXCEEDED");
  if (minimum <= 0n || minimum >= 2n ** 256n) return deny("INVALID_MINIMUM_OUTPUT");
  const deadline = Math.min(m.expiresAt, e.capturedAt + m.maxQuoteAgeSeconds, now + 120);
  if (deadline <= now) return deny("QUOTE_EXPIRED");
  return { ok: true, amountIn: amount.toString(), minimumOutput: minimum.toString(), referenceRound: r.roundId, deadline, mandateHash: input.confirmedHash, provenance: e.provenance, liveExecutable };
}
function max(a: bigint, b: bigint) { return a > b ? a : b; }
