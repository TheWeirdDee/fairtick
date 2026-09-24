import { createHash } from "node:crypto";
import type { Hash } from "viem";
import type { MarketSnapshot } from "./types.js";

/** Recursively sorts object keys so the resulting JSON string is stable regardless of insertion order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** sha256 of the canonical (key-sorted) snapshot JSON. Stable under key reordering (PRD §22). */
export function snapshotHash(snapshot: MarketSnapshot): Hash {
  const digest = createHash("sha256").update(canonicalJson(snapshot)).digest("hex");
  return `0x${digest}`;
}
