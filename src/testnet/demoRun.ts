import { randomUUID } from "node:crypto";
import type { Address } from "viem";
import type { ExecutionMandate, ExecutionRoute } from "../engine/executionValidator.js";
import { processOrder, type WorkerDependencies } from "../orders/worker.js";
import type { OrderStore } from "../orders/store.js";

/**
 * TESTNET DEMO mandate: one Buy-now check for 25 mock USDG, at most 230 mock USDG per mNVDA and
 * at most 15 bps over the MOCK reference. closedPolicy ALLOW is an explicit mandate choice: the
 * validator still classifies the real US session, and a mock market has no exchange hours.
 */
export function demoMandate(signer: Address, route: ExecutionRoute, now: number, owner = "operator"): ExecutionMandate {
  return {
    orderId: randomUUID(), version: 1, owner, mode: "buy_now", side: "BUY", signer, recipient: signer, route,
    budget: "25000000", maxPerFill: "25000000", minimumFill: "1000000", partialFillAllowed: false,
    maxPriceMicroUsdg: "230000000", maxPremiumBps: 15, usdgParityAccepted: true, minCheapBps: 0, closedPolicy: "ALLOW",
    maxSlippageBps: 30, maxPriceImpactBps: 100, maxFeedAgeSeconds: 900, maxQuoteAgeSeconds: 60, maxBlockAgeSeconds: 30,
    confirmedAt: now, expiresAt: now + 3600, maxFillCount: 1, maxAttempts: 3,
    maxGasWei: "1000000000000000", minimumGasReserveWei: "100000000000000",
  };
}

export interface DemoStep { at: string; result: string; status: string; reason: string; decision: unknown }

/** Same loop as scripts/worker.ts, for one order, until its receipt is reconciled or it stops. */
export async function runUntilSettled(store: OrderStore, id: string, owner: string, deps: WorkerDependencies, opts: { timeoutMs: number; pollMs?: number; log?: (s: DemoStep) => void }) {
  const steps: DemoStep[] = [];
  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    const now = Math.floor(Date.now() / 1000);
    if (store.due(now).some(r => r.id === id)) {
      const result = await processOrder(store, id, deps);
      const view = store.view(id, owner);
      const step = { at: new Date().toISOString(), result, status: view.order.status, reason: view.order.reason, decision: view.latestDecision };
      steps.push(step); opts.log?.(step);
    }
    const view = store.view(id, owner);
    if (view.receipts.length > 0 && view.order.reserved === "0") return { settled: true, steps, view };
    const stopped = view.order.reserved === "0" && ["COMPLETED", "CANCELLED", "EXPIRED", "NEEDS_ATTENTION"].includes(view.order.status) && view.intents.length === 0 && steps.length > 0;
    if (stopped) return { settled: false, steps, view };
    await new Promise(r => setTimeout(r, opts.pollMs ?? 2000));
  }
  return { settled: false, steps, view: store.view(id, owner), timedOut: true };
}
