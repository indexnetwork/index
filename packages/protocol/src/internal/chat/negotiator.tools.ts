import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { NegotiatorMemoryToolsHost, NegotiatorMemoryToolView } from "../../platform/negotiation/memory.js";
import type { NegotiatorVerdictInput, NegotiatorVerdictResult, NegotiatorVerdictToolsHost } from "../../platform/negotiation/verdict.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";

// ═══════════════════════════════════════════════════════════════════════════════
// NEGOTIATOR MEMORY TOOLS (P5.4)
// ═══════════════════════════════════════════════════════════════════════════════
//
// `remember` and `forget` exist ONLY in the negotiator persona's toolset —
// they are appended by `createNegotiatorTools` after the allowlist filter and
// never enter the shared chat-tool registry, so the orchestrator (and the MCP
// tool listing built from the registry) cannot see them.
//
// Registration is host-gated: the tools are created only when the composition
// root injects a `NegotiatorMemoryToolsHost` (which it does only while
// negotiator memory writes are enabled). The host owns every policy decision
// (flag, caps, embedding, matching); these wrappers only translate between
// the model and the host bridge.

const logger = protocolLogger("NegotiatorMemoryTools");

const RememberSchema = z.object({
  kind: z
    .enum(["disclosure_rule", "playbook", "threshold"])
    .describe(
      "disclosure_rule: what may or may not be shared, and with whom. " +
        "threshold: a hard limit or reservation point (minimum rate, maximum scope). " +
        "playbook: a tactic or approach the client wants used.",
    ),
  content: z
    .string()
    .min(1)
    .max(2000)
    .describe(
      "The standing rule as ONE self-contained sentence, faithful to what the client actually said. No IDs, no meta-commentary.",
    ),
});

const ForgetSchema = z.object({
  memoryId: z
    .string()
    .uuid()
    .optional()
    .describe("Exact memory id, when known (e.g. from an ambiguous forget result)."),
  description: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe("The client's description of the memory to forget, used for matching."),
});

const describeMemory = (m: NegotiatorMemoryToolView) => ({
  memoryId: m.id,
  kind: m.kind,
  content: m.content,
});

/**
 * Creates the negotiator persona's `remember`/`forget` memory tools bound to
 * the acting client. Both tools operate exclusively on the client's own
 * negotiator memory store — the host bridge is keyed on `userId`.
 */
export function createNegotiatorMemoryTools(opts: {
  host: NegotiatorMemoryToolsHost;
  userId: string;
  sessionId?: string;
}) {
  const { host, userId, sessionId } = opts;

  const remember = tool(
    async (query: z.infer<typeof RememberSchema>) => {
      logger.info("Tool invoked", { toolName: "remember", userId, kind: query.kind });
      try {
        const saved = await host.remember(userId, {
          kind: query.kind,
          content: query.content,
          ...(sessionId ? { sessionId } : {}),
        });
        if (!saved) {
          return JSON.stringify({
            status: "disabled",
            message:
              "Negotiator memory is currently disabled, so this rule was not saved. Tell the client and suggest trying again later.",
          });
        }
        return JSON.stringify({
          status: "remembered",
          memory: describeMemory(saved),
          message:
            "Saved. Confirm to the client in one short sentence and mention they can review or edit everything you remember on their agent page.",
        });
      } catch (err) {
        logger.error("Tool failed", {
          toolName: "remember",
          error: err instanceof Error ? err.message : String(err),
        });
        return JSON.stringify({ status: "error", message: "Failed to save the memory. Tell the client honestly." });
      }
    },
    {
      name: "remember",
      description:
        "Save a standing rule the client just stated, into your private negotiator memory: a disclosure rule (what to protect or share), a threshold (hard limit), or a playbook note (preferred tactic). Use ONLY for durable guidance the client explicitly gave — never for one-off instructions or your own inferences.",
      schema: RememberSchema,
    },
  );

  const forget = tool(
    async (query: z.infer<typeof ForgetSchema>) => {
      logger.info("Tool invoked", { toolName: "forget", userId, byId: !!query.memoryId });
      if (!query.memoryId && !query.description?.trim()) {
        return JSON.stringify({
          status: "error",
          message: "Provide either memoryId or a description of the memory to forget.",
        });
      }
      try {
        const result = await host.forget(userId, {
          ...(query.memoryId ? { memoryId: query.memoryId } : {}),
          ...(query.description ? { description: query.description } : {}),
        });
        switch (result.status) {
          case "deleted":
            return JSON.stringify({
              status: "forgotten",
              memory: describeMemory(result.memory),
              message: "Deleted. Confirm to the client what exactly was forgotten (quote the deleted rule).",
            });
          case "ambiguous":
            return JSON.stringify({
              status: "ambiguous",
              candidates: result.candidates.map(describeMemory),
              message:
                "Several memories match. Describe the candidates to the client in plain language and ask which one to forget; then call forget again with that memoryId.",
            });
          case "not_found":
            return JSON.stringify({
              status: "not_found",
              message: "No stored memory matches that. Tell the client nothing was found to forget.",
            });
        }
      } catch (err) {
        logger.error("Tool failed", {
          toolName: "forget",
          error: err instanceof Error ? err.message : String(err),
        });
        return JSON.stringify({ status: "error", message: "Failed to delete the memory. Tell the client honestly." });
      }
    },
    {
      name: "forget",
      description:
        "Delete an entry from your private negotiator memory when the client asks you to forget or retract it. Pass the client's description of it (or an exact memoryId after an ambiguous result). If several match, you'll get candidates to clarify with the client.",
      schema: ForgetSchema,
    },
  );

  return [remember, forget];
}

// ═══════════════════════════════════════════════════════════════════════════════
// OWNER VERDICT TOOLS (#1471)
// ═══════════════════════════════════════════════════════════════════════════════
//
// The owner's three decisions in their signal's DM are ANSWER, EDIT, and
// VERDICT. Answer got a lane in #1466 and edit always had one; verdict had
// none. On 2026-08-20 a client told their agent, in the DM of a parked
// pairing, to reject the counterparty — and the agent's whole toolset held no
// lever that could do it. The verdict levers were the Radar card's Skip and
// Start-Chat, and the REST endpoints behind them. `update_opportunity` is in
// the toolset and cannot substitute: its admission blocks `negotiating`
// outright, and the IND-593 owner-approval boundary fails closed on the chat
// surface. So the persona's only available move on "reject them" was to say
// something, or to edit the signal instead.
//
// Positions, never ids — the same rule `answer_pending_question` follows, and
// for a sharper reason: a ref the model can name is a ref it can get wrong,
// and a wrong ref here rejects the wrong person. The model is shown a numbered
// list of this signal's actionable counterparties and hands back a number; the
// host owns the mapping and reports back WHO it acted on, so the confirmation
// the client reads names the person the write actually landed on.
//
// Registered only in intent-pinned negotiator sessions with the host injected:
// the counterparties are one signal's, so a number with no signal behind it
// would decide nothing — or something.

const verdictLogger = protocolLogger("NegotiatorVerdictTools");

const VerdictSchema = z.object({
  counterparty: z
    .number()
    .int()
    .min(1)
    .describe("Which counterparty the client is deciding on, by the number shown in your context."),
  reason: z
    .string()
    .min(1)
    .max(500)
    .optional()
    .describe(
      "Why, in the client's OWN words, if they gave a reason. For the record only. Leave it out entirely when they did not say — never infer one, never write one for them.",
    ),
});

/** One verdict's copy, per host status. Kept together so both tools stay honest in the same way. */
function describeVerdict(
  verdict: "rejected" | "accepted",
  result: NegotiatorVerdictResult,
): Record<string, unknown> {
  switch (result.status) {
    case "executed":
      return verdict === "rejected"
        ? {
          status: "executed",
          counterparty: result.counterparty,
          message:
            `Done — you have declined the ${result.counterparty} pairing, and they will not be contacted further about it. Confirm that to the client in one short sentence, naming ${result.counterparty}. Do NOT also edit their signal: a verdict on one match is not a change to what they are looking for.`,
        }
        : {
          status: "executed",
          counterparty: result.counterparty,
          message:
            `Done — you have accepted the ${result.counterparty} pairing on the client's behalf. That is one side of it: the connection is made when ${result.counterparty} accepts too, so tell the client plainly that it is now waiting on them. Do NOT also edit their signal.`,
        };
    case "none_actionable":
      return {
        status: "none_actionable",
        message:
          "There is no counterparty left to decide on for this signal — they have concluded or expired. Tell the client that plainly rather than implying a decision was recorded.",
      };
    case "unknown_counterparty":
      return {
        status: "unknown_counterparty",
        count: result.count,
        actionable: result.actionable,
        message:
          "That number does not name a counterparty of this signal. Nothing was decided. Re-read the list above and call this again with the right number, or ask the client which of them they meant.",
      };
    case "already_decided":
      return {
        status: "already_decided",
        counterparty: result.counterparty,
        message:
          `The client has already acted on the ${result.counterparty} pairing, so nothing changed just now. Say so plainly — for an accept, it is ${result.counterparty}'s move next, not theirs.`,
      };
    case "error":
      return {
        status: "error",
        message:
          `Could not record that ${verdict === "rejected" ? "rejection" : "acceptance"}. Tell the client honestly that it did not go through, and do not describe the pairing as ${verdict}.`,
      };
  }
}

/**
 * Creates the negotiator persona's `reject_opportunity` / `accept_opportunity`
 * tools, bound to the acting client and the signal this session is pinned to.
 */
export function createNegotiatorVerdictTools(opts: {
  host: NegotiatorVerdictToolsHost;
  userId: string;
  intentId: string;
}) {
  const { host, userId, intentId } = opts;

  const run = async (
    verdict: "rejected" | "accepted",
    toolName: string,
    execute: (input: NegotiatorVerdictInput) => Promise<NegotiatorVerdictResult>,
    query: z.infer<typeof VerdictSchema>,
  ) => {
    verdictLogger.info("Tool invoked", { toolName, userId, counterparty: query.counterparty });
    try {
      const result = await execute({
        intentId,
        counterparty: query.counterparty,
        ...(query.reason ? { reason: query.reason } : {}),
      });
      return JSON.stringify(describeVerdict(verdict, result));
    } catch (err) {
      verdictLogger.error("Tool failed", {
        toolName,
        error: err instanceof Error ? err.message : String(err),
      });
      return JSON.stringify(describeVerdict(verdict, { status: "error" }));
    }
  };

  const rejectOpportunity = tool(
    async (query: z.infer<typeof VerdictSchema>) =>
      run("rejected", "reject_opportunity", (input) => host.rejectOpportunity(userId, input), query),
    {
      name: "reject_opportunity",
      description:
        "Decline one of this signal's counterparties, because the client just told you to. This is the ONLY thing that actually declines a match — saying it, or editing their signal, does not. Use it whenever they pass that verdict on a specific counterparty, however they phrase it ('not this one', 'pass', 'tell them no'). Never on your own judgment, and never on a match they have not decided about.",
      schema: VerdictSchema,
    },
  );

  const acceptOpportunity = tool(
    async (query: z.infer<typeof VerdictSchema>) =>
      run("accepted", "accept_opportunity", (input) => host.acceptOpportunity(userId, input), query),
    {
      name: "accept_opportunity",
      description:
        "Accept one of this signal's counterparties on the client's explicit instruction. This is the ONLY thing that records their acceptance. It is one side of a two-party decision — the connection is made when the counterparty accepts too, so never tell the client they are connected on the strength of this alone. Never on your own judgment.",
      schema: VerdictSchema,
    },
  );

  return [rejectOpportunity, acceptOpportunity];
}
