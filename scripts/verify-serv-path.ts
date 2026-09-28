// One bounded check of SERV through the REAL worker/store path with execution
// disabled. The planner is the real requestPlan; the mandate and market evidence
// are SYNTHETIC and labeled as such to SERV and in the output. Uses an isolated
// temporary database — never the operator database — and never signs, approves
// or broadcasts. Credentials are read from .env.local and never printed.
import "../src/lib/env.js";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OrderStore } from "../src/orders/store.js";
import { processOrder } from "../src/orders/worker.js";
import { allowedRoute } from "../src/orders/config.js";
import { requestPlan } from "../src/engine/servPlanner.js";
import { fixture, usableSnapshot, passingPrerequisites } from "../test/order-fixtures.js";

const now = () => Math.floor(Date.now() / 1000);
const start = now();
const dir = mkdtempSync(join(tmpdir(), "fairtick-serv-path-"));
const store = new OrderStore(join(dir, "orders.db"));
// ALLOW keeps this diagnostic independent of market hours, and the wider age
// limits cover model latency. Neither touches any operator mandate.
const m = { ...fixture("serv-path", "buy_now").mandate, route: allowedRoute(), closedPolicy: "ALLOW" as const,
  confirmedAt: start - 5, expiresAt: start + 900, maxQuoteAgeSeconds: 120, maxBlockAgeSeconds: 120 };
try {
  store.create(m, start);
  const outcome = await processOrder(store, m.orderId, { now, mode: "synthetic", quote: async () => usableSnapshot(m, start),
    chain: async () => null, prerequisites: passingPrerequisites, plan: requestPlan });
  const rows = store.db.prepare("SELECT origin, body FROM decisions WHERE order_id=?").all(m.orderId) as { origin: string; body: string }[];
  const row = rows.find(r => JSON.parse(r.body).kind === "PLANNING");
  const d = row ? JSON.parse(row.body) : null;
  const order = store.get(m.orderId);
  const report = {
    observedAt: new Date().toISOString(),
    servKeyPresent: Boolean(process.env.SERV_API_KEY),
    authenticatedRequestCompleted: d?.planner?.httpStatus === 200,
    outputValidated: d?.validation?.valid === true,
    provenance: "SYNTHETIC mandate and market evidence; real requestPlan, worker and store; isolated temporary database",
    label: d?.label ?? null, evidenceProvenance: d?.evidenceProvenance ?? null, liveExecutable: d?.preview?.liveExecutable ?? false,
    outcome, decisionOrigin: row?.origin ?? null,
    planner: d?.planner ?? null, proposal: d?.proposal ?? null, validation: d?.validation ?? null, persistedOutcome: d?.outcome ?? null,
    orderStatus: order.status, reserved: order.reserved,
    fillIntents: (store.db.prepare("SELECT count(*) n FROM fill_intents").get() as { n: number }).n,
    signed: false, broadcast: false, temporaryDatabase: dir,
  };
  mkdirSync("data/evidence", { recursive: true });
  const file = `data/evidence/serv-path-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ file, ...report }, null, 2));
} finally { store.close(); }
