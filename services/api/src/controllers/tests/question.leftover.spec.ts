/**
 * Leftover-row handling for the retired card questions
 * (conversational-questions plan, "Retirements") — API-layer integration
 * tests against the real test DB.
 *
 * The contract: answering or dismissing a leftover row must not error and
 * must never invoke a retired reaction handler. Contact voids the row with
 * the auditable `retired_mode` marker; a second contact on the settled row
 * still reports success; a foreign or unknown row is a plain 404. No
 * QuestionEvents fire — the reaction dispatch is deleted, and the void path
 * never touches it.
 */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect, beforeAll as bunBeforeAll, afterAll as bunAfterAll } from "bun:test";
import { inArray } from "drizzle-orm/sql";
import { QuestionController } from "../question.controller";
import { QuestionerAdapter, type AdapterPersistableQuestion } from "../../adapters/questioner.adapter";
import { UserDatabaseAdapter } from "../../adapters/database.adapter";
import { QuestionEvents } from "../../events/question.event";
import db from "../../lib/drizzle/drizzle";
import { withMinimumDatabaseHookBudget } from "../../lib/testing/database-test-budget";
import { questions } from "../../schemas/database.schema";
import type { AuthenticatedUser } from "../../guards/auth.guard";

const EMAIL = "test-question-leftover@example.com";
const OTHER_EMAIL = "test-question-leftover-other@example.com";
const beforeAll = withMinimumDatabaseHookBudget(bunBeforeAll, 30_000);
const afterAll = withMinimumDatabaseHookBudget(bunAfterAll, 30_000);

describe("Leftover card questions void on contact", () => {
  const userAdapter = new UserDatabaseAdapter();
  const questionerAdapter = new QuestionerAdapter(db);
  const controller = new QuestionController();
  let testUserId: string;
  let otherUserId: string;
  const createdQuestionIds: string[] = [];
  const firedEvents: string[] = [];
  const prevOnAnswered = QuestionEvents.onAnswered;
  const prevOnDismissed = QuestionEvents.onDismissed;

  const mockUser = (id?: string): AuthenticatedUser => ({
    id: id ?? testUserId,
    email: EMAIL,
    name: "Test Leftover User",
  });

  /** Persist a leftover pending row shaped like a retired generator's output. */
  async function persistLeftover(overrides?: Partial<AdapterPersistableQuestion>): Promise<string> {
    const batch: AdapterPersistableQuestion[] = [{
      detection: {
        mode: 'pool_discovery',
        sourceType: 'intent',
        sourceId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      },
      actors: [{ userId: testUserId, role: 'subject' }],
      payload: {
        title: "Stage",
        prompt: "Which stage matters most for this match?",
        options: [
          { label: "Early", description: "Pre-seed and seed" },
          { label: "Growth", description: "Series A and beyond" },
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

  const postReq = () =>
    new Request("http://localhost/questions/x/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedOptions: ["Early"] }),
    });

  async function rowStatus(id: string): Promise<{ status: string; voidedReason?: string }> {
    const [row] = await db.select().from(questions).where(inArray(questions.id, [id]));
    const detection = row.detection as { voidedReason?: string };
    return { status: row.status, ...(detection.voidedReason ? { voidedReason: detection.voidedReason } : {}) };
  }

  beforeAll(async () => {
    const existingUser = await userAdapter.findByEmail(EMAIL);
    if (existingUser) await userAdapter.deleteByEmail(EMAIL);
    const user = await userAdapter.create({ email: EMAIL, name: "Test Leftover User" });
    testUserId = user.id;
    const existingOther = await userAdapter.findByEmail(OTHER_EMAIL);
    if (existingOther) await userAdapter.deleteByEmail(OTHER_EMAIL);
    const other = await userAdapter.create({ email: OTHER_EMAIL, name: "Other Leftover User" });
    otherUserId = other.id;
    QuestionEvents.onAnswered = (payload) => { firedEvents.push(`answered:${payload.questionId}`); };
    QuestionEvents.onDismissed = (payload) => { firedEvents.push(`dismissed:${payload.questionId}`); };
  });

  afterAll(async () => {
    QuestionEvents.onAnswered = prevOnAnswered;
    QuestionEvents.onDismissed = prevOnDismissed;
    if (createdQuestionIds.length > 0) {
      await db.delete(questions).where(inArray(questions.id, createdQuestionIds)).catch(() => {});
    }
    if (testUserId) await userAdapter.deleteById(testUserId);
    if (otherUserId) await userAdapter.deleteById(otherUserId);
  });

  test("answering a leftover row voids it with retired_mode and fires no reaction event", async () => {
    const id = await persistLeftover();
    const res = await controller.answer(postReq(), mockUser(), { id });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(await rowStatus(id)).toEqual({ status: 'dismissed', voidedReason: 'retired_mode' });
    expect(firedEvents).toEqual([]);
  });

  test("dismissing a leftover negotiation-family row is the same graceful void", async () => {
    const id = await persistLeftover({
      detection: {
        mode: 'negotiation_inflight',
        purpose: 'inflight_consultation',
        sourceType: 'opportunity',
        sourceId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
      },
    });
    const res = await controller.dismiss(postReq(), mockUser(), { id });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(await rowStatus(id)).toEqual({ status: 'dismissed', voidedReason: 'retired_mode' });
    expect(firedEvents).toEqual([]);
  });

  test("contacting an already-settled row still reports success", async () => {
    const id = await persistLeftover();
    expect((await controller.answer(postReq(), mockUser(), { id })).status).toBe(200);
    // Second contact (either surface) on the now-dismissed row: still 200.
    expect((await controller.answer(postReq(), mockUser(), { id })).status).toBe(200);
    expect((await controller.dismiss(postReq(), mockUser(), { id })).status).toBe(200);
    expect(await rowStatus(id)).toEqual({ status: 'dismissed', voidedReason: 'retired_mode' });
    expect(firedEvents).toEqual([]);
  });

  test("a foreign user's contact is a plain 404 and leaves the row pending", async () => {
    const id = await persistLeftover();
    const res = await controller.answer(postReq(), mockUser(otherUserId), { id });
    expect(res.status).toBe(404);
    expect((await rowStatus(id)).status).toBe('pending');
  });

  test("an unknown id is a plain 404", async () => {
    const res = await controller.dismiss(postReq(), mockUser(), { id: crypto.randomUUID() });
    expect(res.status).toBe(404);
  });
});
