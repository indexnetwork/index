/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import { createQuestionerTools } from "../questioner.tools.js";
import type { ResolvedToolContext } from "../../shared/agent/tool.helpers.js";
import type { PendingQuestionSummary } from "../../shared/schemas/pending-question.schema.js";

const userId = '00000000-0000-4000-8000-000000000001';

const context: ResolvedToolContext = {
  userId,
  userName: 'Test User',
  userEmail: 'test@example.com',
  user: { id: userId, name: 'Test User', email: 'test@example.com' } as never,
  userProfile: null,
  userNetworks: [],
  indexScope: [],
  isOnboarding: false,
  hasName: true,
};

const mockQuestion: PendingQuestionSummary = {
  id: 'q-0001',
  title: 'Collaboration focus',
  prompt: 'What kind of collaboration are you most open to right now?',
  options: [
    { label: 'Co-building', description: 'Working together on a project' },
    { label: 'Knowledge exchange', description: 'Sharing expertise' },
  ],
  multiSelect: false,
  mode: 'profile',
  sourceType: 'profile',
  sourceId: userId,
  createdAt: '2026-06-11T00:00:00Z',
};

function makeDeps(overrides?: {
  findPendingQuestions?: ((userId: string) => Promise<PendingQuestionSummary[]>) | undefined;
}) {
  return { findPendingQuestions: overrides?.findPendingQuestions } as never;
}

function makeDefineTool() {
  type ToolSpec = {
    name: string;
    handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
  };
  const tools = new Map<string, ToolSpec>();
  const defineTool = (spec: ToolSpec) => { tools.set(spec.name, spec); return spec; };
  async function call(name: string, query: unknown): Promise<unknown> {
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

    it("respects the limit parameter", async () => {
      const { defineTool, call } = makeDefineTool();
      createQuestionerTools(defineTool as never, makeDeps({
        findPendingQuestions: async () => [
          mockQuestion,
          { ...mockQuestion, id: "q-0002" },
          { ...mockQuestion, id: "q-0003" },
        ],
      }));
      const result = await call("read_pending_questions", { limit: 1 }) as { success: boolean; data: { questions: PendingQuestionSummary[] } };
      expect(result.success).toBe(true);
      expect(result.data.questions).toHaveLength(1);
      expect(result.data.questions[0].id).toBe("q-0001");
    });
  });
});
