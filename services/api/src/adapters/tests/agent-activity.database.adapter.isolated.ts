import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, inArray } from 'drizzle-orm/sql';
import { v4 as uuidv4 } from 'uuid';

import db from '../../lib/drizzle/drizzle';
import { ChatDatabaseAdapter } from '../database.adapter';
import { conversations, tasks } from '../../schemas/conversation.schema';
import { intents, opportunities, questions, users } from '../../schemas/database.schema';

const TEST_PREFIX = `agent_activity_${Date.now()}_`;
const userId = uuidv4();
const otherUserId = uuidv4();
const unrelatedUserId = uuidv4();
const activeIntentId = uuidv4();
const secondActiveIntentId = uuidv4();
const pausedIntentId = uuidv4();
const archivedIntentId = uuidv4();
const recentOpportunityId = uuidv4();
const secondRecentOpportunityId = uuidv4();
const oldOpportunityId = uuidv4();
const unrelatedOpportunityId = uuidv4();
const conversationId = uuidv4();
const questionIds = [uuidv4(), uuidv4(), uuidv4(), uuidv4(), uuidv4()];
const taskIds = [uuidv4(), uuidv4(), uuidv4(), uuidv4()];

const now = new Date();
const recent = new Date(now.getTime() - 2 * 60 * 60 * 1000);
const old = new Date(now.getTime() - 48 * 60 * 60 * 1000);

function opportunity(id: string, createdAt: Date, actorUserId: string, intentId?: string) {
  return {
    id,
    detection: { source: 'opportunity_graph' as const, timestamp: createdAt.toISOString() },
    actors: [
      { userId: actorUserId, networkId: uuidv4(), role: 'patient', ...(intentId ? { intent: intentId } : {}) },
      { userId: otherUserId, networkId: uuidv4(), role: 'peer' },
    ],
    interpretation: { category: 'test', reasoning: 'test-only', confidence: 0.8 },
    context: {},
    confidence: '0.8',
    status: 'pending' as const,
    createdAt,
    updatedAt: createdAt,
    expiresAt: null,
  };
}

beforeAll(async () => {
  await db.insert(users).values([
    { id: userId, email: `${TEST_PREFIX}owner@example.com`, name: 'Activity Owner' },
    { id: otherUserId, email: `${TEST_PREFIX}other@example.com`, name: 'Other User' },
    { id: unrelatedUserId, email: `${TEST_PREFIX}unrelated@example.com`, name: 'Unrelated User' },
  ]);
  await db.insert(intents).values([
    { id: activeIntentId, userId, payload: 'Find climate founders', summary: 'Climate founders', status: 'ACTIVE' },
    { id: secondActiveIntentId, userId, payload: 'Find product advisors', summary: null, status: 'ACTIVE' },
    { id: pausedIntentId, userId, payload: 'Find investors', summary: 'Investors', status: 'PAUSED' },
    { id: archivedIntentId, userId, payload: 'Archived signal', summary: 'Archived', status: 'ACTIVE', archivedAt: old },
  ]);
  await db.insert(opportunities).values([
    opportunity(recentOpportunityId, recent, userId, activeIntentId),
    opportunity(secondRecentOpportunityId, recent, userId, activeIntentId),
    opportunity(oldOpportunityId, old, userId, secondActiveIntentId),
    opportunity(unrelatedOpportunityId, recent, unrelatedUserId),
  ]);
  await db.insert(questions).values([
    {
      id: questionIds[0],
      detection: { mode: 'intent', sourceType: 'intent', sourceId: activeIntentId, timestamp: recent.toISOString() },
      actors: [{ userId, role: 'subject' }],
      payload: { title: 'Current question', prompt: 'Current question', options: [], multiSelect: false } as never,
      status: 'pending',
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      createdAt: recent,
    },
    {
      id: questionIds[1],
      detection: { mode: 'intent', sourceType: 'intent', sourceId: activeIntentId, timestamp: old.toISOString() },
      actors: [{ userId, role: 'subject' }],
      payload: { title: 'Expired question', prompt: 'Expired question', options: [], multiSelect: false } as never,
      status: 'pending',
      expiresAt: new Date(now.getTime() - 60 * 60 * 1000),
      createdAt: old,
    },
    {
      id: questionIds[2],
      detection: { mode: 'intent', sourceType: 'intent', sourceId: activeIntentId, timestamp: recent.toISOString() },
      actors: [{ userId, role: 'subject' }],
      payload: { title: 'Answered question', prompt: 'Answered question', options: [], multiSelect: false } as never,
      status: 'answered',
      answer: { selectedOptions: ['yes'], answeredBy: userId, answeredAt: recent.toISOString() },
      createdAt: old,
    },
    {
      id: questionIds[3],
      detection: { mode: 'intent', sourceType: 'intent', sourceId: activeIntentId, timestamp: old.toISOString() },
      actors: [{ userId, role: 'subject' }],
      payload: { title: 'Old answered question', prompt: 'Old answered question', options: [], multiSelect: false } as never,
      status: 'answered',
      answer: { selectedOptions: ['no'], answeredBy: userId, answeredAt: old.toISOString() },
      createdAt: old,
    },
    {
      id: questionIds[4],
      detection: { mode: 'intent', sourceType: 'intent', sourceId: activeIntentId, timestamp: recent.toISOString() },
      actors: [{ userId: unrelatedUserId, role: 'subject' }],
      payload: { title: 'Other question', prompt: 'Other question', options: [], multiSelect: false } as never,
      status: 'answered',
      answer: { selectedOptions: ['yes'], answeredBy: unrelatedUserId, answeredAt: recent.toISOString() },
      createdAt: recent,
    },
  ]);
  await db.insert(conversations).values({ id: conversationId });
  await db.insert(tasks).values([
    {
      id: taskIds[0], conversationId, state: 'working',
      metadata: { type: 'negotiation', opportunityId: recentOpportunityId }, createdAt: recent, updatedAt: recent,
    },
    {
      id: taskIds[1], conversationId, state: 'completed',
      metadata: { type: 'negotiation', opportunityId: recentOpportunityId }, createdAt: recent, updatedAt: recent,
    },
    {
      id: taskIds[2], conversationId, state: 'completed',
      metadata: { type: 'negotiation', opportunityId: secondRecentOpportunityId }, createdAt: old, updatedAt: old,
    },
    {
      id: taskIds[3], conversationId, state: 'completed',
      metadata: { type: 'negotiation', opportunityId: unrelatedOpportunityId }, createdAt: recent, updatedAt: recent,
    },
  ]);
});

afterAll(async () => {
  await db.delete(tasks).where(inArray(tasks.id, taskIds));
  await db.delete(conversations).where(eq(conversations.id, conversationId));
  await db.delete(questions).where(inArray(questions.id, questionIds));
  await db.delete(opportunities).where(inArray(opportunities.id, [recentOpportunityId, secondRecentOpportunityId, oldOpportunityId, unrelatedOpportunityId]));
  await db.delete(intents).where(inArray(intents.id, [activeIntentId, secondActiveIntentId, pausedIntentId, archivedIntentId]));
  await db.delete(users).where(inArray(users.id, [userId, otherUserId, unrelatedUserId]));
});

describe('ChatDatabaseAdapter.getAgentActivitySummary', () => {
  it('returns exact owner-scoped aggregate counts from seeded rows', async () => {
    const summary = await new ChatDatabaseAdapter().getAgentActivitySummary(userId, { sinceHours: 24 });

    expect(summary).toEqual({
      sinceHours: 24,
      liveSignalsWatched: 2,
      opportunitiesSurfaced: 2,
      opportunitiesBySignal: [
        { intentId: activeIntentId, title: 'Climate founders', count: 2 },
      ],
      pendingQuestionCount: 1,
      questionsAnswered: 1,
      negotiationsStarted: 1,
      negotiationsCompleted: 1,
    });
  });
});
