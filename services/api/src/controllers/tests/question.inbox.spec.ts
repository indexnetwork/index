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

import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { eq } from "drizzle-orm/sql";
import { QuestionController } from "../question.controller";
import { QuestionerAdapter, type AdapterPersistableQuestion } from "../../adapters/questioner.adapter";
import { UserDatabaseAdapter } from "../../adapters/database.adapter";
import { questionService } from "../../services/question.service";
import { QuestionEvents } from "../../events/question.event";
import db from "../../lib/drizzle/drizzle";
import { questions } from "../../schemas/database.schema";
import type { AuthenticatedUser } from "../../guards/auth.guard";

const EMAIL = "test-question-inbox@example.com";

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
    for (const id of createdQuestionIds) {
      await db.delete(questions).where(eq(questions.id, id)).catch(() => {});
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
