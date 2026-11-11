import { randomUUID } from 'node:crypto';

import { and, asc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { openQuestions, type GroupState, type OpenQuestion, type QuestionScope } from '../lib/personal-agent/question-groups';
import { messages, questionGroupMembers, questionGroups } from '../schemas/database.schema';

import { toPrincipalMessage } from './agent-session.database.adapter';
import { ConversationDatabaseAdapter } from './conversation.database.adapter';

/** Groups older than this are history: their answers are too old to reuse. */
const GROUP_HORIZON_DAYS = 60;

/** Where the personal agent keeps its question groups. Thin queries; the rules live in `question-groups.ts`. */
export class QuestionGroupsDatabaseAdapter {
  /** @returns Every question still waiting on the owner, across all intents, oldest first. */
  static async listOpenQuestions(userId: string): Promise<OpenQuestion[]> {
    const dm = await new ConversationDatabaseAdapter().getOrCreateAgentDm(userId);
    const rows = await db.select().from(messages)
      .where(and(
        eq(messages.conversationId, dm.id),
        sql`${messages.metadata}->'principalMessage'->>'kind' in ('question', 'answer', 'expire')`,
      ))
      .orderBy(asc(messages.createdAt), asc(messages.id));
    return openQuestions(rows.map((row) => ({
      intentId: (row.metadata as { intentId?: string } | null)?.intentId ?? '',
      message: toPrincipalMessage(row),
    })));
  }

  /**
   * @param open - The owner's open questions, so each member knows whether it still waits.
   * @returns The owner's recent groups, oldest first.
   */
  static async listGroups(userId: string, open: OpenQuestion[]): Promise<GroupState[]> {
    const groups = await db.select().from(questionGroups)
      .where(and(
        eq(questionGroups.userId, userId),
        gt(questionGroups.createdAt, sql`now() - make_interval(days => ${GROUP_HORIZON_DAYS}::int)`),
      ))
      .orderBy(asc(questionGroups.createdAt), asc(questionGroups.id));
    if (!groups.length) return [];
    const members = await db.select().from(questionGroupMembers)
      .where(inArray(questionGroupMembers.groupId, groups.map((group) => group.id)))
      .orderBy(asc(questionGroupMembers.createdAt));
    const waiting = new Set(open.map((question) => question.questionId));
    return groups.map((group) => ({
      id: group.id,
      state: group.state === 'shown' ? 'shown' : 'held',
      leadQuestionId: group.leadQuestionId,
      answerText: group.answerText,
      createdAt: group.createdAt,
      shownAt: group.shownAt,
      emailedAt: group.emailedAt,
      members: members.filter((member) => member.groupId === group.id).map((member) => ({
        questionId: member.questionId,
        intentId: member.intentId,
        scope: member.scope as QuestionScope,
        open: waiting.has(member.questionId),
      })),
    }));
  }

  /** @returns Ids of every question already in a group. */
  static async groupedQuestionIds(questionIds: string[]): Promise<Set<string>> {
    if (!questionIds.length) return new Set();
    const rows = await db.select({ questionId: questionGroupMembers.questionId }).from(questionGroupMembers)
      .where(inArray(questionGroupMembers.questionId, questionIds));
    return new Set(rows.map((row) => row.questionId));
  }

  /** Start a held group led by this question. @returns The new group's id. */
  static async createGroup(userId: string, question: OpenQuestion): Promise<string> {
    const id = randomUUID();
    await db.transaction(async (tx) => {
      await tx.insert(questionGroups).values({ id, userId, leadQuestionId: question.questionId });
      await tx.insert(questionGroupMembers).values({ questionId: question.questionId, groupId: id, intentId: question.intentId, scope: question.scope });
    });
    return id;
  }

  /** Add a question to a group. A question already in a group stays where it is. */
  static async addMember(groupId: string, question: OpenQuestion): Promise<void> {
    await db.insert(questionGroupMembers)
      .values({ questionId: question.questionId, groupId, intentId: question.intentId, scope: question.scope })
      .onConflictDoNothing();
  }

  /** Put held groups on Home. Their clock starts now. */
  static async show(groupIds: string[], at: Date): Promise<void> {
    if (!groupIds.length) return;
    await db.update(questionGroups).set({ state: 'shown', shownAt: at })
      .where(and(inArray(questionGroups.id, groupIds), eq(questionGroups.state, 'held')));
  }

  /**
   * Keep the person's answer on the group. The first answer wins, so two
   * surfaces answering at once cannot overwrite each other.
   *
   * @returns Whether this call recorded it.
   */
  static async recordAnswer(groupId: string, text: string, at: Date): Promise<boolean> {
    const updated = await db.update(questionGroups).set({ answerText: text, answeredAt: at })
      .where(and(eq(questionGroups.id, groupId), isNull(questionGroups.answerText)))
      .returning({ id: questionGroups.id });
    return updated.length > 0;
  }

  /** Mark groups as sent in a morning email, so none is emailed twice. */
  static async markEmailed(groupIds: string[], at: Date): Promise<void> {
    if (!groupIds.length) return;
    await db.update(questionGroups).set({ emailedAt: at }).where(inArray(questionGroups.id, groupIds));
  }

  /** @returns Open member questions of unanswered groups shown longer than the TTL. */
  static async overdueQuestionIds(ttlHours: number): Promise<{ userId: string; intentId: string; questionId: string }[]> {
    return db.select({ userId: questionGroups.userId, intentId: questionGroupMembers.intentId, questionId: questionGroupMembers.questionId })
      .from(questionGroupMembers)
      .innerJoin(questionGroups, eq(questionGroups.id, questionGroupMembers.groupId))
      .where(and(
        eq(questionGroups.state, 'shown'),
        isNull(questionGroups.answerText),
        lt(questionGroups.shownAt, sql`now() - make_interval(hours => ${ttlHours}::int)`),
        // Closed members drop out here, so a sweep never rereads them.
        sql`not exists (
          select 1 from ${messages} r
          where r.metadata->'principalMessage'->>'questionId' = ${questionGroupMembers.questionId}
            and r.metadata->'principalMessage'->>'kind' in ('answer', 'expire')
        )`,
      ));
  }
}
