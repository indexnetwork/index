/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect, afterEach } from "bun:test";
import { createAskUserQuestionTools, setQuestionerAgentForTesting } from "../questioner.ask.tool.js";
import type { QuestionerAgent } from "../questioner.agent.js";
import type { ResolvedToolContext } from "../../shared/agent/tool.helpers.js";
import type { PersistableQuestion, PersistedQuestion, ChatQuestionAnswerOutcome, ChatQuestionsHost } from "../../shared/interfaces/questioner.interface.js";
import type { Question } from "../../shared/schemas/question.schema.js";
import { requestContext, type TraceEmitter } from "../../shared/observability/request-context.js";

const userId = '00000000-0000-4000-8000-000000000001';
const sessionId = '00000000-0000-4000-8000-00000000abcd';

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
    sessionId,
    ...overrides,
  } as ResolvedToolContext;
}

const generatedQuestion: Question = {
  title: 'Timing',
  prompt: 'When do you want to start the collaboration?',
  options: [
    { label: 'Right away (Recommended)', description: 'Discovery focuses on people available now.' },
    { label: 'In a few months', description: 'Discovery includes slower-moving candidates.' },
  ],
  multiSelect: false,
};

function makeAgentStub(result: { questions: Question[]; strategies: Array<'refine_intent' | 'surface_missing_detail'> } | null) {
  const calls: unknown[] = [];
  const agent = {
    invoke: async (input: unknown) => {
      calls.push(input);
      return result;
    },
  } as unknown as QuestionerAgent;
  return { agent, calls };
}

function makeHost(overrides?: Partial<{
  persistCalls: PersistableQuestion[][];
  outcomes: (ids: string[]) => ChatQuestionAnswerOutcome[];
}>) {
  const persistCalls: PersistableQuestion[][] = overrides?.persistCalls ?? [];
  const host: ChatQuestionsHost = {
    persist: async (batch) => {
      persistCalls.push(batch);
      return batch.map((q, i): PersistedQuestion => ({
        id: `q-${i}`,
        detection: q.detection,
        actors: q.actors,
        payload: q.payload,
        status: 'pending',
        answer: null,
        createdAt: new Date().toISOString(),
      }));
    },
    awaitAnswers: async (ids) =>
      overrides?.outcomes?.(ids) ??
      ids.map((id) => ({
        questionId: id,
        status: 'answered' as const,
        answer: {
          selectedOptions: ['Right away (Recommended)'],
          answeredBy: userId,
          answeredAt: new Date().toISOString(),
        },
      })),
  };
  return { host, persistCalls };
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

/** Run `fn` inside a requestContext carrying a capturing traceEmitter. */
async function withTrace<T>(fn: () => Promise<T>, opts?: { signal?: AbortSignal }): Promise<{ result: T; events: Array<Record<string, unknown>> }> {
  const events: Array<Record<string, unknown>> = [];
  const traceEmitter: TraceEmitter = (e) => { events.push(e as Record<string, unknown>); };
  const result = await requestContext.run(
    { traceEmitter, ...(opts?.signal ? { abortSignal: opts.signal } : {}) },
    fn,
  );
  return { result, events };
}

afterEach(() => {
  setQuestionerAgentForTesting(null);
});

describe("ask_user_question", () => {
  it("generates, persists, streams, waits, and returns the answers", async () => {
    const { agent, calls } = makeAgentStub({ questions: [generatedQuestion], strategies: ['surface_missing_detail'] });
    setQuestionerAgentForTesting(agent);
    const { host, persistCalls } = makeHost();
    const { defineTool, call } = makeDefineTool();
    createAskUserQuestionTools(defineTool as never, { chatQuestions: host } as never);

    const { result, events } = await withTrace(() =>
      call("ask_user_question", { purpose: "Need to know when the user wants to start before running discovery." }),
    );

    const typed = result as { success: boolean; data: { answers: Array<{ questionId: string; status: string; selectedOptions?: string[] }>; summary: string } };
    expect(typed.success).toBe(true);
    expect(typed.data.answers).toHaveLength(1);
    expect(typed.data.answers[0].status).toBe("answered");
    expect(typed.data.answers[0].selectedOptions).toEqual(['Right away (Recommended)']);
    expect(typed.data.summary).toContain("1 of 1");

    // QuestionerAgent invoked in chat mode with the session as source.
    expect(calls).toHaveLength(1);
    expect((calls[0] as { mode: string }).mode).toBe("chat");
    expect((calls[0] as { sourceId: string }).sourceId).toBe(sessionId);

    // Persisted with chat mode + conversation linkage.
    expect(persistCalls).toHaveLength(1);
    expect(persistCalls[0][0].detection.mode).toBe("chat");
    expect(persistCalls[0][0].conversationId).toBe(sessionId);
    expect(persistCalls[0][0].actors).toEqual([{ userId, role: 'subject' }]);

    // user_question stream event carries persisted ids.
    const userQuestionEvents = events.filter((e) => e.type === "user_question");
    expect(userQuestionEvents).toHaveLength(1);
    const streamed = (userQuestionEvents[0] as { questions: Array<{ id: string; prompt: string }> }).questions;
    expect(streamed[0].id).toBe("q-0");
    expect(streamed[0].prompt).toBe(generatedQuestion.prompt);
  });

  it("falls back to the orchestrator's drafts when the agent returns nothing", async () => {
    const { agent } = makeAgentStub(null);
    setQuestionerAgentForTesting(agent);
    const { host, persistCalls } = makeHost();
    const { defineTool, call } = makeDefineTool();
    createAskUserQuestionTools(defineTool as never, { chatQuestions: host } as never);

    const { result } = await withTrace(() =>
      call("ask_user_question", {
        purpose: "Need the user's budget range before filtering candidates.",
        questions: [{ prompt: "What budget range fits this project?", options: ["Under 10k", "10k-50k", "Above 50k"] }],
      }),
    );

    expect((result as { success: boolean }).success).toBe(true);
    expect(persistCalls[0][0].payload.prompt).toBe("What budget range fits this project?");
    expect(persistCalls[0][0].payload.options).toHaveLength(3);
  });

  it("errors gracefully when the agent returns nothing and drafts have no options", async () => {
    const { agent } = makeAgentStub(null);
    setQuestionerAgentForTesting(agent);
    const { host, persistCalls } = makeHost();
    const { defineTool, call } = makeDefineTool();
    createAskUserQuestionTools(defineTool as never, { chatQuestions: host } as never);

    const { result } = await withTrace(() =>
      call("ask_user_question", {
        purpose: "Need the user's budget range before filtering candidates.",
        questions: [{ prompt: "What budget range fits this project?" }],
      }),
    );

    expect((result as { success: boolean }).success).toBe(false);
    expect(persistCalls).toHaveLength(0);
  });

  it("reports timeout outcomes with guidance and keeps questions pending", async () => {
    const { agent } = makeAgentStub({ questions: [generatedQuestion], strategies: ['surface_missing_detail'] });
    setQuestionerAgentForTesting(agent);
    const { host } = makeHost({
      outcomes: (ids) => ids.map((id) => ({ questionId: id, status: 'timeout' as const })),
    });
    const { defineTool, call } = makeDefineTool();
    createAskUserQuestionTools(defineTool as never, { chatQuestions: host } as never);

    const { result } = await withTrace(() =>
      call("ask_user_question", { purpose: "Need to know when the user wants to start before running discovery." }),
    );

    const typed = result as { success: boolean; data: { answers: Array<{ status: string }>; guidance?: string } };
    expect(typed.success).toBe(true);
    expect(typed.data.answers[0].status).toBe("timeout");
    expect(typed.data.guidance).toContain("has not answered");
  });

  it("errors when no streaming trace emitter is available", async () => {
    const { agent } = makeAgentStub({ questions: [generatedQuestion], strategies: ['surface_missing_detail'] });
    setQuestionerAgentForTesting(agent);
    const { host } = makeHost();
    const { defineTool, call } = makeDefineTool();
    createAskUserQuestionTools(defineTool as never, { chatQuestions: host } as never);

    // No requestContext.run wrapper — no traceEmitter.
    const result = await call("ask_user_question", { purpose: "Need to know the user's timing before discovery." }) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toContain("streaming chat turn");
  });

  it("errors for MCP contexts and missing sessions", async () => {
    const { agent } = makeAgentStub({ questions: [generatedQuestion], strategies: ['surface_missing_detail'] });
    setQuestionerAgentForTesting(agent);
    const { host } = makeHost();
    const { defineTool, call } = makeDefineTool();
    createAskUserQuestionTools(defineTool as never, { chatQuestions: host } as never);

    const { result: mcpResult } = await withTrace(() =>
      call("ask_user_question", { purpose: "Need timing before discovery runs." }, makeContext({ isMcp: true })),
    );
    expect((mcpResult as { success: boolean }).success).toBe(false);

    const { result: noSessionResult } = await withTrace(() =>
      call("ask_user_question", { purpose: "Need timing before discovery runs." }, makeContext({ sessionId: undefined })),
    );
    expect((noSessionResult as { success: boolean }).success).toBe(false);
  });
});
