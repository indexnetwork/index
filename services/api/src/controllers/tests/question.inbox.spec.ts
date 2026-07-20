/**
 * P4.3 pending question inbox (IND-404) — API-layer integration tests.
 *
 * Covers the acceptance criteria that live in the API layer:
 * - an open (pending) question is visible through the DM-inbox query the
 *   negotiator chat surface uses (noConversation, all modes)
 * - the answer_pending_question host dep (ToolService wiring) records answers
 *   through the standard pipeline: atomic pending→answered flip + the
 *   QuestionEvents.onAnswered mode dispatch
 * - the double-answer race is guarded at every entry surface: the second
 *   answer returns false at the adapter and 404 at the REST endpoint the
 *   question cards use
 *
 * Uses the real database adapters against the test DB.
 */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect, beforeAll as bunBeforeAll, afterAll as bunAfterAll, beforeEach } from "bun:test";
import { eq, inArray } from "drizzle-orm/sql";
import { QuestionController } from "../question.controller";
import { QuestionerAdapter, type AdapterPersistableQuestion } from "../../adapters/questioner.adapter";
import { UserDatabaseAdapter } from "../../adapters/database.adapter";
import { questionService } from "../../services/question.service";
import { QuestionEvents } from "../../events/question.event";
import db from "../../lib/drizzle/drizzle";
import { withMinimumDatabaseHookBudget } from "../../lib/testing/database-test-budget";
import { questions } from "../../schemas/database.schema";
import type { AuthenticatedUser } from "../../guards/auth.guard";

const EMAIL = "test-question-inbox@example.com";
const beforeAll = withMinimumDatabaseHookBudget(bunBeforeAll, 30_000);
const afterAll = withMinimumDatabaseHookBudget(bunAfterAll, 30_000);

describe("Pending question inbox (IND-404)", () => {
  const userAdapter = new UserDatabaseAdapter();
  const questionerAdapter = new QuestionerAdapter(db);
  const controller = new QuestionController();
  let testUserId: string;
  const createdQuestionIds: string[] = [];
  let answeredEvents: Array<{ questionId: string; mode: string; sourceId: string }> = [];
  const prevOnAnswered = QuestionEvents.onAnswered;

  const mockUser = (): AuthenticatedUser => ({
    id: testUserId,
    email: EMAIL,
    name: "Test Inbox User",
  });

  /** Persist a pending question for the test user and track it for cleanup. */
  async function persistQuestion(overrides?: Partial<AdapterPersistableQuestion>): Promise<string> {
    const batch: AdapterPersistableQuestion[] = [{
      detection: {
        mode: 'negotiation',
        sourceType: 'opportunity',
        sourceId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      },
      actors: [{ userId: testUserId, role: 'subject' }],
      payload: {
        title: "Timeline check",
        prompt: "The counterparty asked about your timeline — when could you start?",
        options: [
          { label: "Within a month", description: "Ready to move quickly" },
          { label: "Later this year", description: "Not before Q4" },
        ],
        multiSelect: false,
      },
      strategy: 'surface_missing_detail',
      ...overrides,
    }];
    const [id] = await questionerAdapter.persist(batch);
    createdQuestionIds.push(id);
    return id;
  }

  const answerReq = (body: Record<string, unknown>) =>
    new Request("http://localhost/questions/x/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const listReq = (query: string) =>
    new Request(`http://localhost/questions?${query}`);

  async function answerQuestion(
    questionId: string,
    userId: string,
    answeredAt: string,
    freeText?: string,
  ): Promise<void> {
    const answered = await questionerAdapter.answer(questionId, userId, {
      selectedOptions: ["Within a month"],
      ...(freeText ? { freeText } : {}),
      answeredBy: userId,
      answeredAt,
    });
    expect(answered).toBe(true);
  }

  beforeAll(async () => {
    const existingUser = await userAdapter.findByEmail(EMAIL);
    if (existingUser) await userAdapter.deleteByEmail(EMAIL);
    const user = await userAdapter.create({ email: EMAIL, name: "Test Inbox User" });
    testUserId = user.id;

    QuestionEvents.onAnswered = (payload) => {
      answeredEvents.push({ questionId: payload.questionId, mode: payload.mode, sourceId: payload.sourceId });
    };
  });

  afterAll(async () => {
    QuestionEvents.onAnswered = prevOnAnswered;
    if (createdQuestionIds.length > 0) {
      await db.delete(questions).where(inArray(questions.id, createdQuestionIds)).catch(() => {});
    }
    if (testUserId) await userAdapter.deleteById(testUserId);
  });

  beforeEach(() => {
    answeredEvents = [];
  });

  // ── DM inbox visibility ────────────────────────────────────────────────

  test("a pending question appears in the DM-inbox query (noConversation, all modes)", async () => {
    const questionId = await persistQuestion();

    // The negotiator DM surface queries the same way the global inbox does:
    // pending, not bound to a conversation, no mode clamp.
    const pending = await questionService.findPending(testUserId, { noConversation: true });
    const ids = pending.map((q) => q.id);
    expect(ids).toContain(questionId);
    const row = pending.find((q) => q.id === questionId)!;
    expect(row.detection.mode).toBe('negotiation');
    expect(row.status).toBe('pending');
  });

  test("status=answered lists the caller's intent questions with answer payload in chronological order", async () => {
    const intentId = crypto.randomUUID();
    const otherIntentId = crypto.randomUUID();
    const laterQuestionId = await persistQuestion({
      detection: {
        mode: 'intent',
        sourceType: 'intent',
        sourceId: intentId,
        timestamp: new Date().toISOString(),
      },
    });
    const earlierQuestionId = await persistQuestion({
      detection: {
        mode: 'intent',
        sourceType: 'intent',
        sourceId: intentId,
        timestamp: new Date().toISOString(),
      },
    });
    const otherIntentQuestionId = await persistQuestion({
      detection: {
        mode: 'intent',
        sourceType: 'intent',
        sourceId: otherIntentId,
        timestamp: new Date().toISOString(),
      },
    });
    const foreignUserId = crypto.randomUUID();
    const foreignQuestionId = await persistQuestion({
      actors: [{ userId: foreignUserId, role: 'subject' }],
      detection: {
        mode: 'intent',
        sourceType: 'intent',
        sourceId: intentId,
        timestamp: new Date().toISOString(),
      },
    });

    await answerQuestion(laterQuestionId, testUserId, '2026-01-02T00:00:00.000Z', 'later answer');
    await answerQuestion(earlierQuestionId, testUserId, '2026-01-01T00:00:00.000Z', 'earlier answer');
    await answerQuestion(otherIntentQuestionId, testUserId, '2026-01-01T12:00:00.000Z');
    await answerQuestion(foreignQuestionId, foreignUserId, '2026-01-01T00:30:00.000Z');

    const response = await controller.list(
      listReq(`status=answered&intentId=${intentId}`),
      mockUser(),
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { questions: Array<{
      id: string;
      status: string;
      payload: { prompt: string; options: unknown[] };
      answer: { selectedOptions: string[]; freeText?: string; answeredAt: string };
    }> };

    expect(body.questions.map((question) => question.id)).toEqual([
      earlierQuestionId,
      laterQuestionId,
    ]);
    expect(body.questions.every((question) => question.status === 'answered')).toBe(true);
    expect(body.questions[0]).toMatchObject({
      payload: {
        prompt: "The counterparty asked about your timeline — when could you start?",
        options: [
          { label: "Within a month", description: "Ready to move quickly" },
          { label: "Later this year", description: "Not before Q4" },
        ],
      },
      answer: {
        selectedOptions: ["Within a month"],
        freeText: "earlier answer",
        answeredAt: '2026-01-01T00:00:00.000Z',
      },
    });
  });

  test("status=answered without an intent filter still scopes to the caller", async () => {
    const ownedQuestionId = await persistQuestion();
    const foreignUserId = crypto.randomUUID();
    const foreignQuestionId = await persistQuestion({
      actors: [{ userId: foreignUserId, role: 'subject' }],
    });
    await answerQuestion(ownedQuestionId, testUserId, '2026-02-01T00:00:00.000Z');
    await answerQuestion(foreignQuestionId, foreignUserId, '2026-02-01T00:01:00.000Z');

    const response = await controller.list(listReq('status=answered'), mockUser());
    expect(response.status).toBe(200);
    const body = await response.json() as { questions: Array<{ id: string; actors: Array<{ userId: string }> }> };
    const ids = body.questions.map((question) => question.id);
    expect(ids).toContain(ownedQuestionId);
    expect(ids).not.toContain(foreignQuestionId);
    expect(body.questions.every((question) => question.actors.some((actor) => actor.userId === testUserId))).toBe(true);
  });

  test("dismissed and invalid status values remain rejected", async () => {
    for (const status of ['dismissed', 'garbage']) {
      const response = await controller.list(listReq(`status=${status}`), mockUser());
      expect(response.status).toBe(400);
    }
  });

  test("excludeModes drops pool_discovery from the non-scoped inbox but keeps other modes (IND-418 surfaces fix)", async () => {
    const poolQuestionId = await persistQuestion({
      detection: {
        mode: 'pool_discovery',
        sourceType: 'intent',
        sourceId: crypto.randomUUID(),
        triggeredBy: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      },
    });
    const negotiationQuestionId = await persistQuestion();

    // Non-scoped surfaces (global chat, questions inbox) exclude pool questions.
    const excluded = await questionService.findPending(testUserId, {
      noConversation: true,
      excludeModes: ['pool_discovery'],
    });
    expect(excluded.map((q) => q.id)).not.toContain(poolQuestionId);
    expect(excluded.map((q) => q.id)).toContain(negotiationQuestionId);

    // Without the exclusion the pool question is still reachable (intent page path).
    const all = await questionService.findPending(testUserId, { noConversation: true });
    expect(all.map((q) => q.id)).toContain(poolQuestionId);
  });

  test("conversation-bound questions stay out of the DM inbox", async () => {
    const questionId = await persistQuestion({
      detection: {
        mode: 'chat',
        sourceType: 'conversation',
        sourceId: 'session-1',
        timestamp: new Date().toISOString(),
      },
      conversationId: crypto.randomUUID(),
    });
    const pending = await questionService.findPending(testUserId, { noConversation: true });
    expect(pending.map((q) => q.id)).not.toContain(questionId);
  });

  // ── answer pipeline through the tool-host dep shape ────────────────────

  test("answering flips pending→answered and fires the onAnswered mode dispatch", async () => {
    const questionId = await persistQuestion();

    // Exactly what ToolService.answerPendingQuestion does for the
    // answer_pending_question tool.
    const answered = await questionerAdapter.answer(questionId, testUserId, {
      selectedOptions: ["Within a month"],
      freeText: "assuming the contract closes",
      answeredBy: testUserId,
      answeredAt: new Date().toISOString(),
    });
    expect(answered).toBe(true);

    expect(answeredEvents).toHaveLength(1);
    expect(answeredEvents[0].questionId).toBe(questionId);
    expect(answeredEvents[0].mode).toBe('negotiation');

    const [row] = await db.select().from(questions).where(eq(questions.id, questionId));
    expect(row.status).toBe('answered');
    expect(row.answer?.selectedOptions).toEqual(["Within a month"]);
    expect(row.answer?.freeText).toBe("assuming the contract closes");

    // No longer pending anywhere.
    const pending = await questionService.findPending(testUserId, { noConversation: true });
    expect(pending.map((q) => q.id)).not.toContain(questionId);
  });

  test("double-answer race: the second answer is refused and fires no second event", async () => {
    const questionId = await persistQuestion();
    const answer = {
      selectedOptions: ["Later this year"],
      answeredBy: testUserId,
      answeredAt: new Date().toISOString(),
    };

    expect(await questionerAdapter.answer(questionId, testUserId, answer)).toBe(true);
    expect(await questionerAdapter.answer(questionId, testUserId, answer)).toBe(false);
    expect(answeredEvents).toHaveLength(1);
  });

  test("another user cannot answer the client's question", async () => {
    const questionId = await persistQuestion();
    const answered = await questionerAdapter.answer(questionId, crypto.randomUUID(), {
      selectedOptions: ["Within a month"],
      answeredBy: 'someone-else',
      answeredAt: new Date().toISOString(),
    });
    expect(answered).toBe(false);
    expect(answeredEvents).toHaveLength(0);
  });

  // ── REST entry (the path the question cards use) ───────────────────────

  test("REST double answer: 200 then 404 (card-path regression)", async () => {
    const questionId = await persistQuestion();
    const body = { selectedOptions: ["Within a month"] };

    const first = await controller.answer(answerReq(body), mockUser(), { id: questionId });
    expect(first.status).toBe(200);
    const firstJson = await first.json() as { success: boolean; resumed: boolean };
    expect(firstJson.success).toBe(true);
    expect(firstJson.resumed).toBe(false);

    const second = await controller.answer(answerReq(body), mockUser(), { id: questionId });
    expect(second.status).toBe(404);
    expect(answeredEvents).toHaveLength(1);
  });
});
