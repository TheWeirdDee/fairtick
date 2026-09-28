export type EvidenceProvenance = "LIVE" | "SYNTHETIC" | "REPLAY" | "MIXED";
export type SourceProvenance = Exclude<EvidenceProvenance, "MIXED">;
export type ExecutionPurpose = "live_execution" | "preview";

// Objects produced by live adapters from live reads. Membership is by object
// identity, so data parsed from JSON, a request body or the database can never
// be attested — a "LIVE" label in data alone is only a claim.
const attested = new WeakSet<object>();

/** For live adapters only (src/engine/quote.ts, src/orders/worker.ts); enforced by test/provenance.test.ts. */
export function attestLive<T extends object>(value: T): T {
  attested.add(value);
  return value;
}

export function isAttestedLive(value: unknown): boolean {
  return typeof value === "object" && value !== null && attested.has(value);
}
