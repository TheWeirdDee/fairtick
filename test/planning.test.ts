import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrderStore } from "../src/orders/store.js";
import { processOrder, type Planner, type WorkerDependencies } from "../src/orders/worker.js";
import { allowedRoute } from "../src/orders/config.js";
import { requestPlan, type PlannerResult } from "../src/engine/servPlanner.js";
import { mandateDigest, type ExecutionMandate } from "../src/engine/executionValidator.js";
import type { MarketSnapshot } from "../src/engine/types.js";
import { fixture, NOW, address, usableSnapshot, passingPrerequisites, unavailablePrerequisites } from "./order-fixtures.js";

// Every planner response and every market observation in this file is SYNTHETIC.
// Real parts: processOrder, OrderStore, temporary SQLite files, validator, prepareBuy.
const dirs: string[] = [], stores: OrderStore[] = [];
afterEach(() => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  for (const s of stores.splice(0)) if (s.db.open) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function open(dir?: string) {
  const d = dir ?? mkdtempSync(join(tmpdir(), "fairtick-plan-"));
  if (!dir) dirs.push(d);
  const store = new OrderStore(join(d, "orders.db")); stores.push(store);
  return { store, dir: d };
}
/** Real allowlisted route, so the deterministic validator can find a candidate. */
function confirm(store: OrderStore, id: string, overrides: Partial<ExecutionMandate> = {}, mode: "buy_now" | "work_my_order" = "work_my_order", at = NOW) {
  const m: ExecutionMandate = { ...fixture(id, mode).mandate, route: allowedRoute(), ...overrides };
  store.create(m, at);
  return m;
}
function deps(m: ExecutionMandate, plan: Planner, extra: Partial<WorkerDependencies> = {}): WorkerDependencies {
  return { now: () => NOW, mode: "synthetic", quote: async () => usableSnapshot(m, NOW), chain: async () => null, prerequisites: passingPrerequisites, plan, planTimeoutMs: 5000, ...extra };
}
const clock = (start: number) => { let t = start; return { now: () => t, set: (v: number) => { t = v; } }; };
const gate = () => {
  let release!: () => void, entered!: () => void;
  const opened = new Promise<void>(r => { release = r; }), inside = new Promise<void>(r => { entered = r; });
  return { opened, inside, release: () => release(), enter: () => entered() };
};
const SUCCEEDED = (proposal: unknown): PlannerResult => ({ status: "SUCCEEDED", proposal, model: "synthetic-model", requestId: "synthetic-request", transactionAuthorized: false, synthetic: true });
const EXECUTE = { action: "PROPOSE_EXECUTION", reason: "SYNTHETIC: code-validated candidate within limits", evidenceIds: ["deterministic_candidate", "reference"] };

const intents = (s: OrderStore) => (s.db.prepare("SELECT count(*) n FROM fill_intents").get() as { n: number }).n;
const decisions = (s: OrderStore, id: string) => (s.db.prepare("SELECT origin, body FROM decisions WHERE order_id=? ORDER BY created_at, rowid").all(id) as { origin: string; body: string }[])
  .map(r => ({ ...JSON.parse(r.body), origin: r.origin }));
const planning = (s: OrderStore, id: string) => decisions(s, id).filter(d => d.kind === "PLANNING");
function expectNoSpend(s: OrderStore, id: string) {
  expect(s.get(id).reserved).toBe("0");
  expect(s.get(id).attempts).toBe(0);
  expect(intents(s)).toBe(0);
}

describe("SERV planning through the real worker and store (synthetic planner responses)", () => {
  it("a valid proposal on synthetic evidence reaches validation and persistence as a labeled simulation preview, never a purchase", async () => {
    const { store } = open(); const m = confirm(store, "valid");
    const plan = vi.fn<Planner>(async () => SUCCEEDED(EXECUTE));
    expect(await processOrder(store, m.orderId, deps(m, plan))).toBe("SIMULATION_PREVIEW");
    expect(plan).toHaveBeenCalledTimes(1);
    const input = plan.mock.calls[0]![0];
    expect(input.permittedActions).toEqual(["PROPOSE_EXECUTION", "WAIT", "ESCALATE"]);
    expect(Object.keys(input.evidence)).toEqual(expect.arrayContaining(["mandate_limits", "remaining_budget", "order_history", "deterministic_candidate", "provenance"]));
    // Wallet addresses are withheld from the external planner.
    const seen = JSON.stringify(input).toLowerCase();
    expect(seen).not.toContain(m.signer.toLowerCase().slice(2)); expect(seen).not.toContain(m.recipient.toLowerCase().slice(2));
    const [d] = planning(store, m.orderId);
    expect(d).toMatchObject({ origin: "serv", outcome: "SIMULATION_PREVIEW", label: "SYNTHETIC PLANNER ON SYNTHETIC MARKET DATA", evidenceProvenance: "SYNTHETIC", synthetic: true, validation: { valid: true }, executionAuthorized: false, submitted: false, fundsReserved: false });
    expect(d.preview).toMatchObject({ label: "SIMULATION_PREVIEW", evidenceProvenance: "SYNTHETIC", liveExecutable: false });
    expect(d.planner).toMatchObject({ model: "synthetic-model", requestId: "synthetic-request" });
    expect(d.preview).toMatchObject({ transactionAuthorized: false, signed: false, submitted: false, fundsReserved: false, amountIn: "25000000", minimumOutput: "100000000000000000" });
    expect(d.preview.unsignedRequest.to.toLowerCase()).toBe(m.route.router.toLowerCase());
    expect(store.get(m.orderId).status).toBe("NEEDS_ATTENTION");
    expectNoSpend(store, m.orderId);
    expect(store.view(m.orderId, "operator").latestDecision).toMatchObject({ origin: "serv", outcome: "SIMULATION_PREVIEW", synthetic: true, evidenceProvenance: "SYNTHETIC" });
  });

  it.each([["WAIT", "WAIT_ACCEPTED", "WAITING"], ["ESCALATE", "ESCALATED", "NEEDS_ATTENTION"]] as const)("a valid %s proposal is applied without any execution state", async (action, outcome, status) => {
    const { store } = open(); const m = confirm(store, `valid-${action}`);
    expect(await processOrder(store, m.orderId, deps(m, async () => SUCCEEDED({ action, reason: "SYNTHETIC", evidenceIds: ["reference"] })))).toBe(outcome);
    expect(store.get(m.orderId).status).toBe(status);
    expect(planning(store, m.orderId)[0]).toMatchObject({ origin: "serv", outcome });
    expectNoSpend(store, m.orderId);
  });

  it("rejects a proposal that tries to change budget, price limit, recipient or deadline; the mandate is untouched", async () => {
    const { store } = open(); const m = confirm(store, "tamper");
    const tamper = { ...EXECUTE, budget: "999000000", maxPriceMicroUsdg: "999999999999", recipient: address(99), expiresAt: NOW + 999999 };
    expect(await processOrder(store, m.orderId, deps(m, async () => SUCCEEDED(tamper)))).toBe("PLANNER_REJECTED_SERV_OUTPUT_INVALID");
    expect(store.mandate(m.orderId)).toEqual(m);
    expect(mandateDigest(store.mandate(m.orderId))).toBe(mandateDigest(m));
    const [d] = planning(store, m.orderId);
    expect(d).toMatchObject({ origin: "serv", validation: { valid: false, reason: "SERV_OUTPUT_INVALID" } });
    expect(d.preview).toBeUndefined();
    expect(store.get(m.orderId)).toMatchObject({ status: "WAITING", failures: 1 });
    expectNoSpend(store, m.orderId);
  });

  it("rejects an execution proposal that deterministic revalidation finds would break the session policy at acceptance", async () => {
    const T = Date.parse("2026-09-24T19:59:50Z") / 1000; // 15:59:50 ET, regular session
    const c = clock(T); const { store } = open();
    const m = confirm(store, "session-close", { confirmedAt: T - 60, expiresAt: T + 3600 }, "work_my_order", T);
    const plan: Planner = async () => { c.set(T + 20); return SUCCEEDED(EXECUTE); }; // answers at 16:00:10 ET, after the close
    expect(await processOrder(store, m.orderId, deps(m, plan, { now: c.now, quote: async () => usableSnapshot(m, T) }))).toBe("REJECTED_BY_REVALIDATION");
    const [d] = planning(store, m.orderId);
    expect(d).toMatchObject({ origin: "serv", validation: { valid: true }, revalidation: "SESSION_CLOSED" });
    expect(d.preview).toBeUndefined();
    expectNoSpend(store, m.orderId);
  });

  const failures: [string, Planner, string, "serv" | "code"][] = [
    ["malformed output", async () => SUCCEEDED("PROPOSE_EXECUTION please"), "PLANNER_REJECTED_SERV_OUTPUT_INVALID", "serv"],
    ["an unknown action", async () => SUCCEEDED({ action: "SIGN_AND_SEND", reason: "x", evidenceIds: [] }), "PLANNER_REJECTED_SERV_OUTPUT_INVALID", "serv"],
    ["an action not permitted here", async () => SUCCEEDED({ action: "REQUEST_CLARIFICATION", reason: "x", evidenceIds: [] }), "PLANNER_REJECTED_UNSUPPORTED_ACTION", "serv"],
    ["an invented evidence ID", async () => SUCCEEDED({ ...EXECUTE, evidenceIds: ["price_prediction"] }), "PLANNER_REJECTED_INVENTED_EVIDENCE_ID", "serv"],
    ["an inherited property name as evidence ID", async () => SUCCEEDED({ ...EXECUTE, evidenceIds: ["constructor"] }), "PLANNER_REJECTED_INVENTED_EVIDENCE_ID", "serv"],
    ["an HTTP failure", async () => ({ status: "FAILED", reason: "SERV_HTTP_ERROR", httpStatus: 503, transactionAuthorized: false }), "PLANNER_REJECTED_SERV_HTTP_ERROR", "code"],
    ["a thrown planner error", async () => { throw new Error("SYNTHETIC transport failure"); }, "PLANNER_REJECTED_PLANNER_THREW", "code"],
    ["a timeout", () => new Promise<PlannerResult>(() => {}), "PLANNER_REJECTED_PLANNER_TIMEOUT", "code"],
  ];
  it.each(failures)("%s creates no spend reservation or execution intent", async (_, plan, outcome, origin) => {
    const { store } = open(); const m = confirm(store, "failure");
    expect(await processOrder(store, m.orderId, deps(m, plan, { planTimeoutMs: 25 }))).toBe(outcome);
    const [d] = planning(store, m.orderId);
    expect(d).toMatchObject({ origin, validation: { valid: false } });
    expect(d.preview).toBeUndefined();
    expect(store.get(m.orderId)).toMatchObject({ status: "WAITING", failures: 1 });
    expectNoSpend(store, m.orderId);
  });

  it("missing SERV credentials stay explicitly unavailable through the real planner and are labeled code, not SERV", async () => {
    vi.stubEnv("SERV_API_KEY", "");
    const network = vi.fn(); vi.stubGlobal("fetch", network);
    const { store } = open(); const m = confirm(store, "no-key");
    expect(await processOrder(store, m.orderId, deps(m, requestPlan))).toBe("SERV_UNAVAILABLE");
    expect(network).not.toHaveBeenCalled();
    const [d] = planning(store, m.orderId);
    expect(d).toMatchObject({ origin: "code", outcome: "SERV_UNAVAILABLE", validation: { valid: false, reason: "SERV_UNAVAILABLE" }, planner: { status: "BLOCKED", reason: "SERV_API_KEY_MISSING" } });
    expect(store.get(m.orderId).status).toBe("NEEDS_ATTENTION");
    expectNoSpend(store, m.orderId);
  });

  it.each(["cancel", "expire", "out-of-band change", "stale evidence"] as const)("%s during inference prevents accepting the proposal", async kind => {
    const { store } = open(); const c = clock(NOW);
    const m = confirm(store, `race-${kind.replaceAll(" ", "-")}`, kind === "expire" ? { expiresAt: NOW + 100 } : {});
    const g = gate();
    const work = processOrder(store, m.orderId, deps(m, async () => { g.enter(); await g.opened; return SUCCEEDED(EXECUTE); }, { now: c.now }));
    await g.inside;
    if (kind === "cancel") store.cancel(m.orderId, "operator", NOW);
    if (kind === "expire") c.set(NOW + 100);
    if (kind === "out-of-band change") store.db.prepare("UPDATE orders SET reason=? WHERE id=?").run("SYNTHETIC out-of-band writer", m.orderId);
    if (kind === "stale evidence") c.set(NOW + 61); // quote older than maxQuoteAgeSeconds=60
    g.release();
    const expected = { cancel: "DISCARDED_CANCELLED_DURING_INFERENCE", expire: "DISCARDED_EXPIRED_DURING_INFERENCE", "out-of-band change": "DISCARDED_ORDER_CHANGED_DURING_INFERENCE", "stale evidence": "DISCARDED_STALE_EVIDENCE" }[kind];
    expect(await work).toBe(expected);
    const [d] = planning(store, m.orderId);
    expect(d.outcome).toBe(expected); expect(d.preview).toBeUndefined();
    expect(store.get(m.orderId).status).toBe({ cancel: "CANCELLED", expire: "EXPIRED", "out-of-band change": "ACTIVE", "stale evidence": "WAITING" }[kind]);
    expectNoSpend(store, m.orderId);
  });

  it("duplicate worker processing on separate connections yields one planning result and no intent", async () => {
    const { store, dir } = open(); const other = open(dir).store;
    const m = confirm(store, "duplicate");
    const g = gate();
    const plan = vi.fn<Planner>(async () => { g.enter(); await g.opened; return SUCCEEDED(EXECUTE); });
    const first = processOrder(store, m.orderId, deps(m, plan));
    await g.inside;
    expect(await processOrder(other, m.orderId, deps(m, plan))).toBe("NOT_CLAIMED");
    g.release();
    expect(await first).toBe("SIMULATION_PREVIEW");
    expect(await processOrder(other, m.orderId, deps(m, plan))).toBe("NOT_CLAIMED");
    expect(await processOrder(store, m.orderId, deps(m, plan))).toBe("NOT_CLAIMED");
    expect(plan).toHaveBeenCalledTimes(1);
    expect(planning(other, m.orderId)).toHaveLength(1);
    expectNoSpend(other, m.orderId);
  });

  const quote = (outputTokenBaseUnits: string): MarketSnapshot["executableQuote"] => ({ inputUsdgBaseUnits: "25000000", outputTokenBaseUnits, effectivePriceUsdgPerToken: 252.5, priceImpactBps: 5, gasEstimateUnits: null });
  const hardStops: [string, Partial<MarketSnapshot>, WorkerDependencies["prerequisites"], string][] = [
    ["a stale reference", { referenceStatus: "STALE", feedUpdatedAt: NOW - 1000, feedAgeSeconds: 1000 }, passingPrerequisites, "WAIT"],
    ["a pending corporate action", { pendingCorporateAction: true }, passingPrerequisites, "WAIT"],
    ["a price above the confirmed cap", { executableQuote: quote("99000000000000000") }, passingPrerequisites, "REFUSE"],
    ["unmeasured wallet and fee evidence", {}, unavailablePrerequisites, "UNKNOWN"],
    ["an unavailable halt status", { tradingHalt: null }, passingPrerequisites, "UNKNOWN"],
  ];
  it.each(hardStops)("%s is decided by code without spending a planner call", async (_, overrides, prerequisites, action) => {
    const { store } = open(); const m = confirm(store, "hard-stop");
    const plan = vi.fn<Planner>(async () => SUCCEEDED(EXECUTE));
    expect(await processOrder(store, m.orderId, deps(m, plan, { quote: async () => usableSnapshot(m, NOW, overrides), prerequisites }))).toBe("CHECKED_DISABLED");
    expect(plan).not.toHaveBeenCalled();
    const all = decisions(store, m.orderId);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ origin: "code", action, plannerCalled: false });
    expectNoSpend(store, m.orderId);
  });
});
