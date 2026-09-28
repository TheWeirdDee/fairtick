import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { OrderStore } from "../src/orders/store.js";
import { processOrder, type Planner, type WorkerDependencies } from "../src/orders/worker.js";
import { allowedRoute } from "../src/orders/config.js";
import { executionMandateSchema, mandateDigest, validateExecution, type ExecutionMandate } from "../src/engine/executionValidator.js";
import type { PlannerResult } from "../src/engine/servPlanner.js";
import { fixture, NOW, usableSnapshot, passingPrerequisites, unavailablePrerequisites, liveTestDouble } from "./order-fixtures.js";

// All data here is SYNTHETIC. Objects passed through liveTestDouble are explicit test doubles
// for live-adapter attestation, used only to prove what the live path accepts and rejects.
const dirs: string[] = [], stores: OrderStore[] = [];
afterEach(() => { for (const s of stores.splice(0)) if (s.db.open) s.close(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function openStore() { const d = mkdtempSync(join(tmpdir(), "fairtick-prov-")); dirs.push(d); const s = new OrderStore(join(d, "orders.db")); stores.push(s); return s; }
const intents = (s: OrderStore) => (s.db.prepare("SELECT count(*) n FROM fill_intents").get() as { n: number }).n;
const EXECUTE = { action: "PROPOSE_EXECUTION", reason: "SYNTHETIC", evidenceIds: ["deterministic_candidate"] };

function validatorInput(evidence: unknown, purpose: "live_execution" | "preview") {
  const { mandate } = fixture("prov");
  return { mandate, confirmedHash: mandateDigest(mandate), evidence, allowedRoute: mandate.route, configuredSigner: mandate.signer, now: NOW, purpose,
    state: { status: "ACTIVE", cancelled: false, settled: "0", reserved: "0", gasSpent: "0", gasReserved: "0", fillCount: 0, attempts: 0 } };
}

describe("shared execution validator: provenance", () => {
  it.each(["SYNTHETIC", "REPLAY"] as const)("live execution rejects %s evidence", provenance => {
    expect(validateExecution(validatorInput({ ...fixture().evidence, provenance }, "live_execution"))).toEqual({ ok: false, reason: "EVIDENCE_NOT_LIVE" });
  });
  it.each(["live_execution", "preview"] as const)("mixed evidence is rejected for %s", purpose => {
    expect(validateExecution(validatorInput({ ...fixture().evidence, provenance: "MIXED" }, purpose))).toEqual({ ok: false, reason: "EVIDENCE_PROVENANCE_MIXED" });
  });
  it("a LIVE label from JSON (request body, database) is only a claim and does not qualify", () => {
    const forged = JSON.parse(JSON.stringify(liveTestDouble(fixture().evidence)));
    expect(forged.provenance).toBe("LIVE");
    expect(validateExecution(validatorInput(forged, "live_execution"))).toEqual({ ok: false, reason: "EVIDENCE_NOT_LIVE" });
  });
  it("only attested live evidence is live-executable; synthetic evidence can still yield a labeled preview", () => {
    expect(validateExecution(validatorInput(liveTestDouble(fixture().evidence), "live_execution"))).toMatchObject({ ok: true, provenance: "LIVE", liveExecutable: true });
    expect(validateExecution(validatorInput(fixture().evidence, "preview"))).toMatchObject({ ok: true, provenance: "SYNTHETIC", liveExecutable: false });
  });
  it("an unrecognized purpose fails closed to live-execution rules", () => {
    expect(validateExecution({ ...validatorInput(fixture().evidence, "preview"), purpose: "demo" as never })).toEqual({ ok: false, reason: "EVIDENCE_NOT_LIVE" });
  });
  it("public mandate input cannot carry provenance", () => {
    expect(executionMandateSchema.safeParse({ ...fixture().mandate, provenance: "LIVE" }).success).toBe(false);
  });
});

describe("live path rejects synthetic and mixed evidence", () => {
  it.each([
    ["synthetic evidence", () => fixture().evidence],
    ["JSON evidence claiming LIVE", () => JSON.parse(JSON.stringify(liveTestDouble(fixture().evidence)))],
  ])("%s can never create a spend reservation", (_, evidence) => {
    const store = openStore(), { mandate: m } = fixture("reserve");
    store.create(m, NOW); const lease = store.claim(m.orderId, NOW)!;
    expect(() => store.reserve(m.orderId, lease, "job", evidence(), m.route, m.signer, NOW)).toThrow("EVIDENCE_NOT_LIVE");
    expect(intents(store)).toBe(0); expect(store.get(m.orderId).reserved).toBe("0");
  });

  const mixed: [string, WorkerDependencies["mode"], (m: ExecutionMandate) => ReturnType<typeof usableSnapshot>, WorkerDependencies["prerequisites"]][] = [
    ["live worker with synthetic snapshot and prerequisites", "live", m => usableSnapshot(m, NOW), passingPrerequisites],
    ["live worker with a live snapshot but synthetic prerequisites", "live", m => liveTestDouble(usableSnapshot(m, NOW)), passingPrerequisites],
    ["synthetic worker given a live snapshot", "synthetic", m => liveTestDouble(usableSnapshot(m, NOW)), passingPrerequisites],
  ];
  it.each(mixed)("%s is a deterministic hard stop without a planner call", async (_, mode, snapshot, prerequisites) => {
    const store = openStore(), m: ExecutionMandate = { ...fixture("mixed").mandate, route: allowedRoute() };
    store.create(m, NOW);
    const plan = vi.fn<Planner>(async () => ({ status: "SUCCEEDED", proposal: EXECUTE, transactionAuthorized: false, synthetic: true }));
    const outcome = await processOrder(store, m.orderId, { now: () => NOW, mode, quote: async () => snapshot(m), chain: async () => null, prerequisites, plan });
    expect(outcome).toBe("CHECKED_DISABLED");
    expect(plan).not.toHaveBeenCalled();
    const d = JSON.parse((store.db.prepare("SELECT body FROM decisions WHERE order_id=?").get(m.orderId) as { body: string }).body);
    expect(d).toMatchObject({ action: "UNKNOWN", plannerCalled: false });
    expect(d.reason).toContain("EVIDENCE_PROVENANCE_MIXED");
    expect(intents(store)).toBe(0);
  });

  it("a real SERV call on synthetic market data is labeled exactly that and stays a simulation", async () => {
    const store = openStore(), m: ExecutionMandate = { ...fixture("real-on-synthetic").mandate, route: allowedRoute() };
    store.create(m, NOW);
    // Shaped like requestPlan's real result (HTTP status and response ID recorded, no synthetic flag).
    const realShaped: PlannerResult = { status: "SUCCEEDED", proposal: EXECUTE, transactionAuthorized: false, model: "gpt-5.4-mini", httpStatus: 200, responseId: "SYNTHETIC-stand-in" };
    expect(await processOrder(store, m.orderId, { now: () => NOW, mode: "synthetic", quote: async () => usableSnapshot(m, NOW), chain: async () => null, prerequisites: passingPrerequisites, plan: async () => realShaped })).toBe("SIMULATION_PREVIEW");
    const d = JSON.parse((store.db.prepare("SELECT body FROM decisions WHERE order_id=?").get(m.orderId) as { body: string }).body);
    expect(d).toMatchObject({ label: "REAL SERV CALL ON SYNTHETIC MARKET DATA", evidenceProvenance: "SYNTHETIC", preview: { liveExecutable: false, label: "SIMULATION_PREVIEW" } });
    expect(intents(store)).toBe(0);
  });

  it("fully attested live evidence (test doubles) gives an execution-disabled preview and still reserves nothing", async () => {
    const store = openStore(), m: ExecutionMandate = { ...fixture("live-double").mandate, route: allowedRoute() };
    store.create(m, NOW);
    const outcome = await processOrder(store, m.orderId, { now: () => NOW, mode: "live", quote: async () => liveTestDouble(usableSnapshot(m, NOW)), chain: async () => null,
      prerequisites: async () => liveTestDouble(await passingPrerequisites()), plan: async () => ({ status: "SUCCEEDED", proposal: EXECUTE, transactionAuthorized: false, synthetic: true }) });
    expect(outcome).toBe("EXECUTION_DISABLED_PREVIEW");
    const d = JSON.parse((store.db.prepare("SELECT body FROM decisions WHERE order_id=?").get(m.orderId) as { body: string }).body);
    expect(d).toMatchObject({ label: "SYNTHETIC PLANNER ON LIVE MARKET DATA", preview: { liveExecutable: true, transactionAuthorized: false, submitted: false, fundsReserved: false } });
    expect(intents(store)).toBe(0); expect(store.get(m.orderId).reserved).toBe("0");
  });

  it("unmeasured live prerequisites keep a live worker at UNKNOWN", async () => {
    const store = openStore(), m: ExecutionMandate = { ...fixture("unmeasured").mandate, route: allowedRoute() };
    store.create(m, NOW);
    await processOrder(store, m.orderId, { now: () => NOW, mode: "live", quote: async () => liveTestDouble(usableSnapshot(m, NOW)), chain: async () => null,
      prerequisites: async () => liveTestDouble(await unavailablePrerequisites()), plan: async () => { throw new Error("must not be called"); } });
    expect(JSON.parse((store.db.prepare("SELECT body FROM decisions WHERE order_id=?").get(m.orderId) as { body: string }).body)).toMatchObject({ action: "UNKNOWN", plannerCalled: false });
  });
});

describe("attestation boundary", () => {
  it("only the live adapters attest evidence in application code and scripts", () => {
    const files: string[] = [];
    const walk = (dir: string) => { for (const name of readdirSync(dir)) { const p = join(dir, name); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(name)) files.push(p); } };
    walk("src"); walk("scripts");
    const callers = files.filter(f => /attestLive\(/.test(readFileSync(f, "utf8"))).map(f => relative(".", f).replaceAll("\\", "/")).sort();
    expect(callers).toEqual(["src/engine/quote.ts", "src/orders/worker.ts"]);
  });
});
