import { and, desc, eq, isNull } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import * as conversationSchema from '../schemas/conversation.schema';
import type { ClarificationQuestion } from '../types/chat-streaming.types';
import { intentDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { IntentEvents } from '../events/intent.event';

const logger = log.service.from('ClarificationService');

export interface PersistInput {
  conversationId: string;
  userId: string;
  intentId: string | null;
  searchQuery: string | null;
  questions: ClarificationQuestion[];
}

export interface AnswerInput {
  questionId: string;
  userId: string;
  answer?: string;
  skip?: boolean;
}

export interface AnswerResult {
  ok: boolean;
  status: number;
  intentId?: string;
  error?: string;
}

/**
 * Persists clarification questions surfaced from orchestrator-inline negotiations
 * and applies the user's answers back to the source intent.
 *
 * Lifecycle:
 *   1. Stream emits a `clarification_request` event with one or more questions.
 *   2. {@link ClarificationService.persist} writes a row per question.
 *   3. User answers via the chat card → `POST /chat/sessions/:id/clarification`.
 *   4. {@link ClarificationService.recordAnswer} appends the Q+A to the intent
 *      payload, regenerates the embedding, and emits `IntentEvents.onUpdated`
 *      so existing maintenance hooks pick up rediscovery.
 */
export class ClarificationService {
  private embedder = new EmbedderAdapter();

  /**
   * Bulk-insert pending clarifications. Idempotent on `id`: re-emitting the
   * same question (e.g. a stream retry) is a no-op.
   */
  async persist(input: PersistInput): Promise<void> {
    if (input.questions.length === 0) return;

    const rows = input.questions.map((q) => ({
      id: q.id,
      conversationId: input.conversationId,
      userId: input.userId,
      intentId: input.intentId,
      candidateUserId: q.candidateUserId,
      opportunityId: q.opportunityId ?? null,
      networkId: q.networkId ?? null,
      sourceAgentName: q.sourceAgentName ?? null,
      question: q.question,
      relevancyScore: q.relevancyScore.toString(),
      searchQuery: input.searchQuery,
    }));

    try {
      await db
        .insert(conversationSchema.pendingClarifications)
        .values(rows)
        .onConflictDoNothing({ target: conversationSchema.pendingClarifications.id });
    } catch (err) {
      logger.error('Failed to persist clarifications', { conversationId: input.conversationId, error: err });
    }
  }

  /**
   * Mark a clarification answered or skipped. On answer, append the Q+A to the
   * source intent's payload and trigger re-indexing via `IntentEvents.onUpdated`.
   *
   * Returns 404 when no row matches the user-scoped id (prevents cross-user
   * answers), 409 when already resolved.
   */
  async recordAnswer(input: AnswerInput): Promise<AnswerResult> {
    const [row] = await db
      .select()
      .from(conversationSchema.pendingClarifications)
      .where(
        and(
          eq(conversationSchema.pendingClarifications.id, input.questionId),
          eq(conversationSchema.pendingClarifications.userId, input.userId),
        ),
      )
      .limit(1);

    if (!row) return { ok: false, status: 404, error: 'Clarification not found' };
    if (row.answeredAt || row.skippedAt) {
      return { ok: false, status: 409, error: 'Clarification already resolved' };
    }

    const now = new Date();

    if (input.skip) {
      await db
        .update(conversationSchema.pendingClarifications)
        .set({ skippedAt: now })
        .where(eq(conversationSchema.pendingClarifications.id, input.questionId));
      return { ok: true, status: 200 };
    }

    const answer = input.answer?.trim();
    if (!answer) return { ok: false, status: 400, error: 'Answer is required' };

    await db
      .update(conversationSchema.pendingClarifications)
      .set({ answer, answeredAt: now })
      .where(eq(conversationSchema.pendingClarifications.id, input.questionId));

    if (row.intentId) {
      await this.appendToIntent(row.intentId, input.userId, row.question, answer);
    }

    return { ok: true, status: 200, ...(row.intentId && { intentId: row.intentId }) };
  }

  /** Returns unanswered, non-skipped clarifications for a conversation, newest first. */
  async listPending(conversationId: string, userId: string) {
    return db
      .select()
      .from(conversationSchema.pendingClarifications)
      .where(
        and(
          eq(conversationSchema.pendingClarifications.conversationId, conversationId),
          eq(conversationSchema.pendingClarifications.userId, userId),
          isNull(conversationSchema.pendingClarifications.answeredAt),
          isNull(conversationSchema.pendingClarifications.skippedAt),
        ),
      )
      .orderBy(desc(conversationSchema.pendingClarifications.createdAt));
  }

  /**
   * Appends a Q+A pair to the intent's payload, regenerates the embedding, and
   * fires `IntentEvents.onUpdated` so downstream rediscovery can run.
   */
  private async appendToIntent(intentId: string, userId: string, question: string, answer: string): Promise<void> {
    const owned = await intentDatabaseAdapter.isOwnedByUser(intentId, userId);
    if (!owned) {
      logger.warn('Refusing to append clarification to intent owned by another user', { intentId, userId });
      return;
    }

    const intent = await intentDatabaseAdapter.getIntentById(intentId, userId);
    if (!intent) return;

    const enrichedPayload = `${intent.payload}\n\nClarification — ${question}\nAnswer: ${answer}`;

    let embedding: number[] | undefined;
    try {
      embedding = (await this.embedder.generate(enrichedPayload)) as number[];
    } catch (err) {
      logger.warn('Embedding regeneration failed; updating payload without re-embedding', {
        intentId,
        error: err,
      });
    }

    await intentDatabaseAdapter.updateIntent(intentId, {
      payload: enrichedPayload,
      ...(embedding && { embedding }),
    });

    IntentEvents.onUpdated(intentId, userId);
  }
}

export const clarificationService = new ClarificationService();
