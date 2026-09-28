import { afterEach, expect, it, vi } from "vitest";
import { requestPlan } from "./servPlanner.js";
const input = { permittedActions: ["WAIT" as const], evidence: { synthetic: { usable: false } } };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("missing key makes no request", async () => {
  vi.stubEnv("SERV_API_KEY", ""); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect((await requestPlan(input)).status).toBe("BLOCKED"); expect(fetch).not.toHaveBeenCalled();
});
it.each([
  { action: "PROPOSE_EXECUTION", reason: "buy", evidenceIds: ["synthetic"] },
  { action: "WAIT", reason: "wait", evidenceIds: ["invented"] },
  { action: "WAIT", reason: "wait", evidenceIds: ["synthetic"], budget: 999 },
])( "rejects unauthorized or invalid synthetic model outputs", async proposal => {
  vi.stubEnv("SERV_API_KEY", "synthetic-test-key");
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: async () => ({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(proposal) } }] }) });
  vi.stubGlobal("fetch", fetch);
  const r = await requestPlan(input); expect(r.status).toBe("FAILED"); expect(r.transactionAuthorized).toBe(false); expect(fetch).toHaveBeenCalledTimes(1);
});
function respond(message: Record<string, unknown>, headers = new Headers()) {
  vi.stubEnv("SERV_API_KEY", "synthetic-test-key");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, headers, json: async () => ({ id: "synthetic-response", model: "synthetic-model", usage: { total_tokens: 5 }, choices: [{ finish_reason: "stop", message }] }) }));
}
it("keeps request metadata and the untrusted raw output when SERV returns malformed JSON", async () => {
  respond({ content: "not json {" }, new Headers({ "x-request-id": "synthetic-request" }));
  expect(await requestPlan(input)).toMatchObject({ status: "FAILED", reason: "SERV_OUTPUT_INVALID", requestId: "synthetic-request", responseId: "synthetic-response", returnedModel: "synthetic-model", untrustedRawOutput: "not json {", transactionAuthorized: false });
});
it("rejects inherited property names as evidence IDs", async () => {
  respond({ content: JSON.stringify({ action: "WAIT", reason: "wait", evidenceIds: ["constructor"] }) });
  expect(await requestPlan(input)).toMatchObject({ status: "FAILED", reason: "INVENTED_EVIDENCE_ID" });
});
it("rejects a response that carries tool calls", async () => {
  respond({ content: JSON.stringify({ action: "WAIT", reason: "wait", evidenceIds: ["synthetic"] }), tool_calls: [{ id: "synthetic" }] });
  expect(await requestPlan(input)).toMatchObject({ status: "FAILED", reason: "SERV_TOOL_CALL_RETURNED" });
});
