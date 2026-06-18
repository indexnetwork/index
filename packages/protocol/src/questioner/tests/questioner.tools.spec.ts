/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import { createQuestionerTools } from "../questioner.tools.js";
import type { ResolvedToolContext } from "../../shared/agent/tool.helpers.js";
import type { PendingQuestionSummary } from "../../shared/schemas/pending-question.schema.js";

const userId = '00000000-0000-4000-8000-000000000001';

type CapturedFilters = {
  sourceType?: string;
  sourceId?: string;
  modes?: string[];
  limit?: number;
} | undefined;

function makeContext(overrides?: Partial<ResolvedToolContext>): ResolvedToolContext {
  return {
    userId,
    userName: 'Test User',
    userEmail: 'test@example.com',
    user: { id: userId, name: 'Test User', email: 'test@example.com' } as never,
    userProfile: null,
    userNetworks: [],
    indexScope: [],
    isOnboarding: false,
    hasName: true,
    ...overrides,
  } as ResolvedToolContext;
}

const mockQuestion: PendingQuestionSummary = {
  id: 'q-0001',
  title: 'Collaboration focus',
  prompt: 'What kind of collaboration are you most open to right now?',
  options: [
    { label: 'Co-building', description: 'Working together on a project' },
    { label: 'Knowledge exchange', description: 'Sharing expertise' },
  ],
  multiSelect: false,
  mode: 'enrichment',
  sourceType: 'profile',
  sourceId: userId,
  createdAt: '2026-06-11T00:00:00Z',
};

function makeDeps(overrides?: {
  findPendingQuestions?: ((userId: string, filters?: CapturedFilters) => Promise<PendingQuestionSummary[]>) | undefined;
  reportToolError?: (error: unknown, report: Record<string, unknown>) => void;
}) {
  return {
    findPendingQuestions: overrides?.findPendingQuestions,
    reportToolError: overrides?.reportToolError,
  } as never;
}

function makeDefineTool() {
  type ToolSpec = {
    name: string;
    handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
  };
  const tools = new Map<string, ToolSpec>();
  const defineTool = (spec: ToolSpec) => { tools.set(spec.name, spec); return spec; };
  async function call(name: string, query: unknown, context: ResolvedToolContext = makeContext()): Promise<unknown> {
    const tool = tools.get(name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return JSON.parse(await tool.handler({ context, query }));
  }
  return { defineTool, call };
}

describe("createQuestionerTools", () => {
  describe("read_pending_questions", () => {
    it("returns questions from findPendingQuestions", async () => {
      const { defineTool, call } = makeDefineTool();
      createQuestionerTools(defineTool as never, makeDeps({ findPendingQuestions: async () => [mockQuestion] }));
      const result = await call("read_pending_questions", {}) as { success: boolean; data: { questions: PendingQuestionSummary[] } };
      expect(result.success).toBe(true);
      expect(result.data.questions).toHaveLength(1);
      expect(result.data.questions[0].id).toBe("q-0001");
    });

    it("returns an empty list when no questions are pending", async () => {
      const { defineTool, call } = makeDefineTool();
      createQuestionerTools(defineTool as never, makeDeps({ findPendingQuestions: async () => [] }));
      const result = await call("read_pending_questions", {}) as { success: boolean; data: { questions: PendingQuestionSummary[] } };
      expect(result.success).toBe(true);
      expect(result.data.questions).toHaveLength(0);
    });

    it("returns an error when findPendingQuestions is absent", async () => {
      const { defineTool, call } = makeDefineTool();
      createQuestionerTools(defineTool as never, makeDeps({ findPendingQuestions: undefined }));
      const result = await call("read_pending_questions", {}) as { success: boolean; error: string };
      expect(result.success).toBe(false);
      expect(result.error).toContain("not available");
    });

    it("pushes the limit into the data-layer filters and re-caps defensively", async () => {
      const { defineTool, call } = makeDefineTool();
      let captured: CapturedFilters;
      createQuestionerTools(defineTool as never, makeDeps({
        findPendingQuestions: async (_userId, filters) => {
          captured = filters;
          return [
            mockQuestion,
            { ...mockQuestion, id: "q-0002" },
            { ...mockQuestion, id: "q-0003" },
          ];
        },
      }));
      const result = await call("read_pending_questions", { limit: 1 }) as { success: boolean; data: { questions: PendingQuestionSummary[] } };
      expect(result.success).toBe(true);
      expect(captured?.limit).toBe(1);
      expect(result.data.questions).toHaveLength(1);
      expect(result.data.questions[0].id).toBe("q-0001");
    });

    it("clamps network-scoped callers to self-owned modes and reports the restriction", async () => {
      const { defineTool, call } = makeDefineTool();
      let captured: CapturedFilters;
      createQuestionerTools(defineTool as never, makeDeps({
        findPendingQuestions: async (_userId, filters) => {
          captured = filters;
          return [mockQuestion];
        },
      }));
      const scoped = makeContext({ networkId: 'net-0001', indexName: 'Edge Esmeralda' });
      const result = await call("read_pending_questions", {}, scoped) as {
        success: boolean;
        data: { questions: PendingQuestionSummary[]; scopeRestriction?: { isScoped: boolean; scopedToIndex: string } };
      };
      expect(result.success).toBe(true);
      expect(captured?.modes).toEqual(["enrichment", "intent", "discovery"]);
      expect(result.data.scopeRestriction?.isScoped).toBe(true);
      expect(result.data.scopeRestriction?.scopedToIndex).toBe("Edge Esmeralda");
    });

    it("does not clamp modes for unscoped callers", async () => {
      const { defineTool, call } = makeDefineTool();
      let captured: CapturedFilters;
      createQuestionerTools(defineTool as never, makeDeps({
        findPendingQuestions: async (_userId, filters) => {
          captured = filters;
          return [mockQuestion];
        },
      }));
      const result = await call("read_pending_questions", {}) as { success: boolean; data: Record<string, unknown> };
      expect(result.success).toBe(true);
      expect(captured?.modes).toBeUndefined();
      expect(result.data.scopeRestriction).toBeUndefined();
    });

    it("excludes negotiation-mode rows for scoped callers even when the dep ignores the modes filter", async () => {
      const { defineTool, call } = makeDefineTool();
      createQuestionerTools(defineTool as never, makeDeps({
        findPendingQuestions: async () => [
          { ...mockQuestion, id: "q-neg", mode: "negotiation", sourceType: "opportunity", sourceId: "opp-1" },
          mockQuestion,
        ],
      }));
      const scoped = makeContext({ networkId: 'net-0001', indexName: 'Edge Esmeralda' });
      const result = await call("read_pending_questions", {}, scoped) as { success: boolean; data: { questions: PendingQuestionSummary[] } };
      expect(result.success).toBe(true);
      expect(result.data.questions.map((q) => q.id)).toEqual(["q-0001"]);
    });

    it("reports and surfaces an error when the lookup throws", async () => {
      const { defineTool, call } = makeDefineTool();
      const reports: Array<Record<string, unknown>> = [];
      createQuestionerTools(defineTool as never, makeDeps({
        findPendingQuestions: async () => { throw new Error("db down"); },
        reportToolError: (_err, report) => { reports.push(report); },
      }));
      const result = await call("read_pending_questions", {}) as { success: boolean; error: string };
      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to read pending questions");
      expect(reports).toHaveLength(1);
      expect(reports[0].toolName).toBe("read_pending_questions");
      expect(reports[0].operation).toBe("read-pending-questions");
    });
  });
});
