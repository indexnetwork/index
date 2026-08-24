/**
 * #1494 round-2 finding 9: respond_to_negotiation's ready_for_verdict pause
 * used `query.recommendation ?? 'reject'`, fabricating a reject
 * recommendation the agent never actually made whenever it omitted the
 * field. No defaults on verdicts — the schema must require the field
 * instead, so the tool call itself fails rather than silently substituting
 * a decision.
 */
import { describe, expect, it } from "bun:test";
import { z } from "zod";

import { createNegotiationTools } from "../negotiation.tools.js";
import type { NegotiationToolDeps } from "../negotiation.tools.port.js";
import type { DefineTool } from "../../shared/agent/tool.helpers.js";

// Minimal passthrough defineTool — mirrors the real registration shape but
// does not itself enforce querySchema; each test calls it explicitly.
function defineTool<T extends z.ZodType>(opts: {
  name: string;
  description: string;
  querySchema: T;
  handler: (input: { context: unknown; query: z.infer<T> }) => Promise<string>;
}) {
  return opts;
}

const NEGOTIATION_ID = "negotiation-1";
const USER_ID = "user-1";

function parseResult(text: string) {
  return JSON.parse(text) as { success: boolean; data?: Record<string, unknown>; error?: string };
}

function getRespondTool(overrides?: Partial<NegotiationToolDeps>) {
  const task = {
    id: NEGOTIATION_ID,
    conversationId: "conversation-1",
    state: "working" as const,
    brief: "brief",
    metadata: {
      type: "negotiation" as const,
      opportunityId: "opportunity-1",
      sourceUserId: USER_ID,
      candidateUserId: "user-2",
      initiatorUserId: USER_ID,
      networkId: "network-1",
      intentId: "intent-1",
      round: 1,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const invokeCalls: unknown[] = [];
  const deps: NegotiationToolDeps = {
    negotiationDatabase: {
      getNegotiationTask: async () => task,
    } as never,
    negotiationGraph: {
      invoke: async (input: unknown) => {
        invokeCalls.push(input);
        return { negotiationId: NEGOTIATION_ID, status: "paused", turns: [] };
      },
    } as never,
    ...overrides,
  };
  const [, , tool] = createNegotiationTools(defineTool as unknown as DefineTool, deps);
  return { tool, invokeCalls };
}

describe("respond_to_negotiation — ready_for_verdict requires a real recommendation", () => {
  it("schema rejects ready_for_verdict with no recommendation — no default fabricated", () => {
    const { tool } = getRespondTool();
    const parsed = tool.querySchema.safeParse({
      negotiationId: NEGOTIATION_ID,
      pauseReason: "ready_for_verdict",
      reasoning: "Terms converged.",
    });
    expect(parsed.success).toBe(false);
  });

  it("schema rejects needs_principal with no question", () => {
    const { tool } = getRespondTool();
    const parsed = tool.querySchema.safeParse({
      negotiationId: NEGOTIATION_ID,
      pauseReason: "needs_principal",
    });
    expect(parsed.success).toBe(false);
  });

  it("an explicit recommendation is applied verbatim, not overridden", async () => {
    const { tool, invokeCalls } = getRespondTool();
    const query = tool.querySchema.parse({
      negotiationId: NEGOTIATION_ID,
      pauseReason: "ready_for_verdict",
      recommendation: "pending",
      reasoning: "Both sides converged.",
    });
    const result = parseResult(await tool.handler({ context: { userId: USER_ID }, query }));
    expect(result.success).toBe(true);
    expect(invokeCalls[0]).toMatchObject({
      turn: { verb: "pause", reason: "ready_for_verdict", payload: { recommendation: "pending" } },
    });
  });
});
