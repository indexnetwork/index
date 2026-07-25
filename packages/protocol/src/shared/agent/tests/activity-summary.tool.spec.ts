import { describe, expect, mock, test } from "bun:test";
import type { z } from "zod";

import { createUtilityTools } from "../utility.tools.js";
import type { DefineTool, ResolvedToolContext } from "../tool.helpers.js";
import type { AgentActivitySummary } from "../../interfaces/database.interface.js";

/**
 * `read_activity_summary` tool contract (IND-605).
 *
 * The canonical tool is registered under exactly one public name on both the
 * REST/chat and MCP surfaces — `report_agent_activity` retains no alias. The
 * handler passes the typed resolved MCP caller context into the centralized
 * permission projection and forwards a network agent's bound community to the
 * adapter so network-bound aggregates are narrowed in the query layer.
 */

type Captured = {
  description: string;
  schema: z.ZodType;
  handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
};

function capture() {
  const tools = new Map<string, Captured>();
  const defineTool = ((opts: {
    name: string;
    description: string;
    querySchema: z.ZodType;
    handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
  }) => {
    tools.set(opts.name, { description: opts.description, schema: opts.querySchema, handler: opts.handler });
    return null;
  }) as unknown as DefineTool;
  return { tools, defineTool };
}

const FULL_SUMMARY: AgentActivitySummary = {
  sinceHours: 24,
  liveSignalsWatched: 2,
  opportunitiesSurfaced: 4,
  opportunitiesBySignal: [{ intentId: "intent-1", title: "Climate founders", count: 4 }],
  pendingQuestionsByMode: { intent: 1 },
  answeredQuestionsByMode: { negotiation: 3 },
  negotiationsStarted: 5,
  negotiationsCompleted: 6,
};

const OWNER_VIEW = {
  sinceHours: 24,
  liveSignalsWatched: 2,
  opportunitiesSurfaced: 4,
  opportunitiesBySignal: FULL_SUMMARY.opportunitiesBySignal,
  pendingQuestionsByDomain: { intents: 1 },
  answeredQuestionsByDomain: { negotiations: 3 },
  negotiationsStarted: 5,
  negotiationsCompleted: 6,
};

function makeDeps() {
  const getAgentActivitySummary = mock(async (input: { sinceHours: number; networkId?: string }) => ({
    ...FULL_SUMMARY,
    sinceHours: input.sinceHours,
  }));
  const deps = {
    scraper: {},
    userDb: { getAgentActivitySummary },
  } as unknown as Parameters<typeof createUtilityTools>[1];
  return { deps, getAgentActivitySummary };
}

function baseContext(): ResolvedToolContext {
  return { userId: "user-1" } as unknown as ResolvedToolContext;
}

async function call(tools: Map<string, Captured>, context: ResolvedToolContext, query: unknown = {}) {
  const tool = tools.get("read_activity_summary")!;
  // Mirror production: callers always pass arguments through the Zod schema
  // first, so defaults (sinceHours: 24) are applied before the handler runs.
  const raw = await tool.handler({ context, query: tool.schema.parse(query) });
  return JSON.parse(raw) as { success: boolean; data: Record<string, unknown> };
}

describe("read_activity_summary tool", () => {
  test("is the only public name; report_agent_activity retains no alias on either surface", () => {
    for (const surface of [undefined, "rest", "mcp"] as const) {
      const { tools, defineTool } = capture();
      const { deps } = makeDeps();
      createUtilityTools(defineTool, deps, surface ? { surface } : {});
      expect(tools.has("read_activity_summary")).toBe(true);
      expect(tools.has("report_agent_activity")).toBe(false);
    }
  });

  test("documents the privacy and per-domain permission contract explicitly", () => {
    const { tools, defineTool } = capture();
    const { deps } = makeDeps();
    createUtilityTools(defineTool, deps, { surface: "mcp" });
    const description = tools.get("read_activity_summary")!.description;
    expect(description).toContain("manage:intents");
    expect(description).toContain("never returns counterparty");
  });

  test("non-MCP (REST/chat) callers receive the full owner view without narrowing", async () => {
    const { tools, defineTool } = capture();
    const { deps, getAgentActivitySummary } = makeDeps();
    createUtilityTools(defineTool, deps);

    const result = await call(tools, baseContext());
    expect(result.success).toBe(true);
    expect(result.data).toEqual(OWNER_VIEW as unknown as Record<string, unknown>);
    expect(getAgentActivitySummary).toHaveBeenCalledWith({ sinceHours: 24 });
  });

  test("MCP human callers receive every domain", async () => {
    const { tools, defineTool } = capture();
    const { deps } = makeDeps();
    createUtilityTools(defineTool, deps, { surface: "mcp" });

    const context = {
      ...baseContext(),
      isMcp: true,
      mcpCaller: { kind: "human", permissions: [], networkScopeId: null },
    } as unknown as ResolvedToolContext;
    const result = await call(tools, context, { sinceHours: 48 });
    expect(result.data).toEqual({ ...OWNER_VIEW, sinceHours: 48 });
  });

  test("MCP global agents receive only permitted domains; signal IDs/titles need manage:intents", async () => {
    const { tools, defineTool } = capture();
    const { deps, getAgentActivitySummary } = makeDeps();
    createUtilityTools(defineTool, deps, { surface: "mcp" });

    const context = {
      ...baseContext(),
      isMcp: true,
      mcpCaller: { kind: "agent", permissions: ["manage:opportunities", "manage:negotiations"], networkScopeId: null },
    } as unknown as ResolvedToolContext;
    const result = await call(tools, context);
    // intent-mode pending counts stay hidden without manage:intents;
    // negotiation-mode answered counts are visible via manage:negotiations.
    expect(result.data).toEqual({
      sinceHours: 24,
      opportunitiesSurfaced: 4,
      answeredQuestionsByDomain: { negotiations: 3 },
      negotiationsStarted: 5,
      negotiationsCompleted: 6,
    });
    expect("opportunitiesBySignal" in result.data).toBe(false);
    expect(getAgentActivitySummary).toHaveBeenCalledWith({ sinceHours: 24 });
  });

  test("MCP network agents narrow network-bound aggregates through the adapter input", async () => {
    const { tools, defineTool } = capture();
    const { deps, getAgentActivitySummary } = makeDeps();
    createUtilityTools(defineTool, deps, { surface: "mcp" });

    const context = {
      ...baseContext(),
      isMcp: true,
      mcpCaller: { kind: "agent", permissions: ["manage:intents"], networkScopeId: "network-1" },
    } as unknown as ResolvedToolContext;
    const result = await call(tools, context);
    expect(getAgentActivitySummary).toHaveBeenCalledWith({ sinceHours: 24, networkId: "network-1" });
    // Only intent-affected question counts are released with manage:intents;
    // negotiation-mode counts stay hidden without manage:negotiations.
    expect(result.data).toEqual({
      sinceHours: 24,
      liveSignalsWatched: 2,
      opportunitiesBySignal: FULL_SUMMARY.opportunitiesBySignal,
      pendingQuestionsByDomain: { intents: 1 },
    });
  });

  test("the result never contains counterparty fields", async () => {
    const { tools, defineTool } = capture();
    const { deps } = makeDeps();
    createUtilityTools(defineTool, deps, { surface: "mcp" });

    const result = await call(tools, baseContext());
    const serialized = JSON.stringify(result.data);
    for (const forbidden of ["counterparty", "transcript", "conversationId", "actors"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
