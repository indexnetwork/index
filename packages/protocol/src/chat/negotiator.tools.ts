import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { NegotiatorMemoryToolsHost, NegotiatorMemoryToolView } from "../shared/interfaces/negotiator-memory.interface.js";
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

/** Tool names appended to the negotiator persona toolset when the host bridge is present. */
export const NEGOTIATOR_MEMORY_TOOL_NAMES = ["remember", "forget"] as const;

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
