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
  networkId?: string;
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
  actors: [{ userId, networkId: 'net-0001' }],
};

function makeDeps(overrides?: {
  findPendingQuestions?: ((userId: string, filters?: CapturedFilters) => Promise<PendingQuestionSummary[]>) | undefined;
  answerPendingQuestion?: ((userId: string, questionId: string, answer: { selectedOptions: string[]; freeText?: string }) => Promise<boolean>) | undefined;
  reportToolError?: (error: unknown, report: Record<string, unknown>) => void;
}) {
  return {
    findPendingQuestions: overrides?.findPendingQuestions,
    answerPendingQuestion: overrides?.answerPendingQuestion,
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
      const scoped = makeContext({ networkId: 'net-0001', scopeType: 'network', scopeId: 'net-0001', indexName: 'Edge Esmeralda' });
      const result = await call("read_pending_questions", {}, scoped) as {
        success: boolean;
        data: { questions: PendingQuestionSummary[]; scopeRestriction?: { isScoped: boolean; scopedToIndex: string } };
      };
      expect(result.success).toBe(true);
      expect(captured?.modes).toEqual(["enrichment", "intent", "discovery"]);
      expect(captured?.networkId).toBe('net-0001');
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
      const scoped = makeContext({ networkId: 'net-0001', scopeType: 'network', scopeId: 'net-0001', indexName: 'Edge Esmeralda' });
      const result = await call("read_pending_questions", {}, scoped) as { success: boolean; data: { questions: PendingQuestionSummary[] } };
      expect(result.success).toBe(true);
      expect(result.data.questions.map((q) => q.id)).toEqual(["q-0001"]);
    });

    it("excludes other-network rows for scoped callers even when the dep ignores the network filter", async () => {
      const { defineTool, call } = makeDefineTool();
      createQuestionerTools(defineTool as never, makeDeps({
        findPendingQuestions: async () => [
          { ...mockQuestion, id: "q-other", actors: [{ userId, networkId: "net-0002" }] },
          { ...mockQuestion, id: "q-missing", actors: undefined },
          mockQuestion,
        ],
      }));
      const scoped = makeContext({ networkId: 'net-0001', scopeType: 'network', scopeId: 'net-0001', indexName: 'Edge Esmeralda' });
      const result = await call("read_pending_questions", {}, scoped) as { success: boolean; data: { questions: PendingQuestionSummary[] } };
      expect(result.success).toBe(true);
      expect(result.data.questions.map((q) => q.id)).toEqual(["q-0001"]);
      expect(result.data.questions[0].actors).toBeUndefined();
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

  describe("answer_pending_question (P4.3/IND-404)", () => {
    type AnswerCall = { userId: string; questionId: string; answer: { selectedOptions: string[]; freeText?: string } };

    function makeAnswerDeps(opts?: {
      pending?: PendingQuestionSummary[];
      answered?: boolean;
      reportToolError?: (error: unknown, report: Record<string, unknown>) => void;
    }) {
      const calls: AnswerCall[] = [];
      const capturedFilters: CapturedFilters[] = [];
      const deps = makeDeps({
        findPendingQuestions: async (_userId, filters) => {
          capturedFilters.push(filters);
          return opts?.pending ?? [mockQuestion];
        },
        answerPendingQuestion: async (uid, questionId, answer) => {
          calls.push({ userId: uid, questionId, answer });
          return opts?.answered ?? true;
        },
        reportToolError: opts?.reportToolError,
      });
      return { deps, calls, capturedFilters };
    }

    it("records the client's explicit answer through the pipeline", async () => {
      const { defineTool, call } = makeDefineTool();
      const { deps, calls } = makeAnswerDeps();
      createQuestionerTools(defineTool as never, deps);
      const result = await call("answer_pending_question", {
        questionId: "q-0001",
        selectedOptions: ["Co-building"],
        freeText: "ideally something climate-adjacent",
      }) as { success: boolean; data: { answered: boolean; question: { id: string } } };
      expect(result.success).toBe(true);
      expect(result.data.answered).toBe(true);
      expect(result.data.question.id).toBe("q-0001");
      expect(calls).toEqual([{
        userId,
        questionId: "q-0001",
        answer: { selectedOptions: ["Co-building"], freeText: "ideally something climate-adjacent" },
      }]);
    });

    it("rejects an empty answer (never answers on the client's behalf)", async () => {
      const { defineTool, call } = makeDefineTool();
      const { deps, calls } = makeAnswerDeps();
      createQuestionerTools(defineTool as never, deps);
      const result = await call("answer_pending_question", {
        questionId: "q-0001",
        selectedOptions: ["  "],
      }) as { success: boolean; error: string };
      expect(result.success).toBe(false);
      expect(result.error).toContain("No answer provided");
      expect(calls).toHaveLength(0);
    });

    it("refuses network-scoped agents", async () => {
      const { defineTool, call } = makeDefineTool();
      const { deps, calls } = makeAnswerDeps();
      createQuestionerTools(defineTool as never, deps);
      const scoped = makeContext({ networkId: 'net-0001', scopeType: 'network', scopeId: 'net-0001', indexName: 'Edge Esmeralda' });
      const result = await call("answer_pending_question", { questionId: "q-0001", freeText: "hi" }, scoped) as { success: boolean; error: string };
      expect(result.success).toBe(false);
      expect(result.error).toContain("network-scoped");
      expect(calls).toHaveLength(0);
    });

    it("clamps the visibility check to the pinned intent in intent-scoped sessions", async () => {
      const { defineTool, call } = makeDefineTool();
      const { deps, capturedFilters } = makeAnswerDeps();
      createQuestionerTools(defineTool as never, deps);
      const scoped = makeContext({ scopeType: 'intent', scopeId: 'intent-42' });
      const result = await call("answer_pending_question", { questionId: "q-0001", freeText: "answer" }, scoped) as { success: boolean };
      expect(result.success).toBe(true);
      expect(capturedFilters[0]).toEqual({ scopeType: 'intent', scopeId: 'intent-42' });
    });

    it("errors when the question is not among the client's pending questions", async () => {
      const { defineTool, call } = makeDefineTool();
      const { deps, calls } = makeAnswerDeps({ pending: [] });
      createQuestionerTools(defineTool as never, deps);
      const result = await call("answer_pending_question", { questionId: "q-gone", freeText: "answer" }) as { success: boolean; error: string };
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found among the client's pending questions");
      expect(calls).toHaveLength(0);
    });

    it("surfaces the already-answered race as an error, not a success", async () => {
      const { defineTool, call } = makeDefineTool();
      const { deps } = makeAnswerDeps({ answered: false });
      createQuestionerTools(defineTool as never, deps);
      const result = await call("answer_pending_question", { questionId: "q-0001", freeText: "answer" }) as { success: boolean; error: string };
      expect(result.success).toBe(false);
      expect(result.error).toContain("already answered or dismissed");
    });

    it("returns an error when the answer dep is absent", async () => {
      const { defineTool, call } = makeDefineTool();
      createQuestionerTools(defineTool as never, makeDeps({ findPendingQuestions: async () => [mockQuestion] }));
      const result = await call("answer_pending_question", { questionId: "q-0001", freeText: "answer" }) as { success: boolean; error: string };
      expect(result.success).toBe(false);
      expect(result.error).toContain("not available");
    });

    it("reports and surfaces an error when the pipeline throws", async () => {
      const { defineTool, call } = makeDefineTool();
      const reports: Array<Record<string, unknown>> = [];
      createQuestionerTools(defineTool as never, makeDeps({
        findPendingQuestions: async () => [mockQuestion],
        answerPendingQuestion: async () => { throw new Error("db down"); },
        reportToolError: (_err, report) => { reports.push(report); },
      }));
      const result = await call("answer_pending_question", { questionId: "q-0001", freeText: "answer" }) as { success: boolean; error: string };
      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to record the answer");
      expect(reports).toHaveLength(1);
      expect(reports[0].toolName).toBe("answer_pending_question");
    });
  });
});
