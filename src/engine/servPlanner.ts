import "../lib/env.js";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";

export const proposalSchema = z.object({
  action: z.enum(["REQUEST_QUOTE", "PROPOSE_EXECUTION", "WAIT", "REQUEST_CLARIFICATION", "ESCALATE"]),
  reason: z.string().min(1).max(1000),
  evidenceIds: z.array(z.string()).max(20),
}).strict();
export type Proposal = z.infer<typeof proposalSchema>;
export type PlannerAction = Proposal["action"];
export type PlannerInput = { permittedActions: PlannerAction[]; evidence: Record<string, unknown> };

/** Planner result contract. `proposal` is untrusted until checkProposal accepts it. */
export interface PlannerResult {
  status: "BLOCKED" | "FAILED" | "SUCCEEDED";
  reason?: string;
  proposal?: unknown;
  untrustedRawOutput?: string | null;
  model?: string;
  returnedModel?: string | null;
  promptVersion?: string;
  promptHash?: string;
  requestId?: string | null;
  responseId?: string | null;
  httpStatus?: number;
  latencyMs?: number;
  usage?: unknown;
  outputValid?: boolean;
  transactionAuthorized: false;
  synthetic?: boolean;
}

export type ProposalCheck =
  | { ok: true; proposal: Proposal }
  | { ok: false; reason: "SERV_OUTPUT_INVALID" | "UNSUPPORTED_ACTION" | "INVENTED_EVIDENCE_ID" };

/** Shared by requestPlan and the worker, which re-checks injected planners. */
export function checkProposal(raw: unknown, permitted: readonly PlannerAction[], evidenceIds: readonly string[]): ProposalCheck {
  const parsed = proposalSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "SERV_OUTPUT_INVALID" };
  if (!permitted.includes(parsed.data.action)) return { ok: false, reason: "UNSUPPORTED_ACTION" };
  // Own keys only: `in` would accept inherited names such as "constructor".
  if (parsed.data.evidenceIds.some(id => !evidenceIds.includes(id))) return { ok: false, reason: "INVENTED_EVIDENCE_ID" };
  return { ok: true, proposal: parsed.data };
}

export async function requestPlan(input: PlannerInput): Promise<PlannerResult> {
  const key = process.env.SERV_API_KEY;
  if (!key) return { status: "BLOCKED", reason: "SERV_API_KEY_MISSING", transactionAuthorized: false };
  const prompt = readFileSync(new URL("../prompts/fairtick.v2.txt", import.meta.url), "utf8");
  const model = process.env.SERV_MODEL || "gpt-5.4-mini";
  const started = Date.now();
  const metadata = { model, promptVersion: "fairtick.v2", promptHash: createHash("sha256").update(prompt).digest("hex"), transactionAuthorized: false as const };
  try {
    // No automatic retry here: a failed response authorizes nothing. The
    // worker applies its own bounded backoff and escalation policy.
    const response = await fetch("https://inference-api.openserv.ai/v1/chat/completions", {
      method: "POST", signal: AbortSignal.timeout(45000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_completion_tokens: 1200,
        messages: [{ role: "system", content: prompt }, { role: "user", content: JSON.stringify(input) }],
        tools: [
          { type: "function", function: { name: "serv_prompt_guard" } },
          { type: "function", function: { name: "serv_shadow_agent", parameters: { type: "object", properties: {
            hint: { type: "string", default: "Use only permittedActions and supplied evidence IDs. Never change confirmed limits or authorize transactions." },
            max_iterations: { type: "integer", default: 3 },
          } } } },
        ],
        response_format: { type: "json_schema", json_schema: { name: "fairtick_plan", strict: true, schema: z.toJSONSchema(proposalSchema) } },
      }),
    });
    const meta = { ...metadata, httpStatus: response.status, requestId: response.headers.get("x-request-id"), latencyMs: Date.now() - started };
    if (!response.ok) return { ...meta, status: "FAILED", reason: "SERV_HTTP_ERROR" };
    const body = await response.json();
    const choice = body.choices?.[0], message = choice?.message;
    const content = typeof message?.content === "string" ? message.content : null;
    let raw: unknown;
    try { raw = JSON.parse(content ?? "null"); } catch { raw = undefined; }
    const checked = checkProposal(raw, input.permittedActions, Object.keys(input.evidence));
    const structural = message?.tool_calls?.length ? "SERV_TOOL_CALL_RETURNED" : choice?.finish_reason !== "stop" ? "SERV_INCOMPLETE_OUTPUT" : null;
    const common = { ...meta, usage: body.usage ?? null, returnedModel: body.model ?? null, responseId: body.id ?? null };
    if (structural || !checked.ok) {
      return { ...common, status: "FAILED", reason: structural ?? (checked.ok ? "SERV_OUTPUT_INVALID" : checked.reason), outputValid: false, untrustedRawOutput: content?.slice(0, 2000) ?? null };
    }
    return { ...common, status: "SUCCEEDED", outputValid: true, proposal: checked.proposal };
  } catch {
    return { ...metadata, status: "FAILED", reason: "SERV_TRANSPORT_OR_OUTPUT_ERROR", outputValid: false, latencyMs: Date.now() - started };
  }
}
