import { describe, expect, it } from "bun:test";
import { z } from "zod";

import { createNegotiationTools } from "../negotiation.tools.js";
import type { NegotiationToolDeps } from "../negotiation.tools.port.js";
import type { DefineTool } from "../../shared/agent/tool.helpers.js";

function defineTool<T extends z.ZodType>(opts: {
  name: string;
  description: string;
  querySchema: T;
  handler: (input: { context: unknown; query: z.infer<T> }) => Promise<string>;
}) {
  return opts;
}

const NEGOTIATION_ID = "negotiation-1";
const SOURCE_ID = "user-1";
const CANDIDATE_ID = "user-2";

function parseResult(text: string) {
  return JSON.parse(text) as {
    success: boolean;
    data?: {
      turns: Array<{
        speaker: string;
        turn: { verb: string; message?: string; reasoning?: string } | null;
      }>;
    };
    error?: string;
  };
}

describe("get_negotiation — counterparty reasoning is seat-private", () => {
  it("strips continue-turn reasoning from the counterparty seat", async () => {
    const task = {
      id: NEGOTIATION_ID,
      conversationId: "conversation-1",
      state: "working" as const,
      brief: "brief",
      briefs: { [SOURCE_ID]: "source brief", [CANDIDATE_ID]: "candidate brief" },
      metadata: {
        type: "negotiation" as const,
        opportunityId: "opportunity-1",
        sourceUserId: SOURCE_ID,
        candidateUserId: CANDIDATE_ID,
        initiatorUserId: SOURCE_ID,
        networkId: "network-1",
        intentId: "intent-1",
        round: 1,
        seats: {},
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const deps: NegotiationToolDeps = {
      negotiationDatabase: {
        getNegotiationTask: async () => task,
        getNegotiationMessages: async () => [
          {
            senderId: `agent:${SOURCE_ID}`,
            parts: [{ kind: "data", data: { verb: "outreach", message: "Hello", reasoning: "source private why" } }],
            createdAt: new Date(),
          },
          {
            senderId: `agent:${CANDIDATE_ID}`,
            parts: [{ kind: "data", data: { verb: "counter", message: "Hi back", reasoning: "candidate private why" } }],
            createdAt: new Date(),
          },
        ],
        getOpportunity: async () => null,
      } as never,
      negotiationGraph: { invoke: async () => ({ negotiationId: NEGOTIATION_ID, status: "working", turns: [] }) } as never,
    };

    const [, getTool] = createNegotiationTools(defineTool as unknown as DefineTool, deps);
    const query = getTool.querySchema.parse({ negotiationId: NEGOTIATION_ID });
    const result = parseResult(await getTool.handler({ context: { userId: SOURCE_ID }, query }));

    expect(result.success).toBe(true);
    const turns = result.data?.turns ?? [];
    expect(turns).toHaveLength(2);
    expect(turns[0]?.turn).toMatchObject({ verb: "outreach", message: "Hello", reasoning: "source private why" });
    expect(turns[1]?.turn).toMatchObject({ verb: "counter", message: "Hi back" });
    expect(turns[1]?.turn).not.toHaveProperty("reasoning");
  });
});
