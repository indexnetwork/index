import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, afterAll as bunAfterAll } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import db from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';

import { withMinimumDatabaseHookBudget } from '../../lib/testing/database-test-budget';
import { ConversationDatabaseAdapter } from '../database.adapter';

const afterAll = withMinimumDatabaseHookBudget(bunAfterAll, 30_000);

describe('ConversationDatabaseAdapter', () => {
  const adapter = new ConversationDatabaseAdapter();
  const createdIds: string[] = [];
  const createdIntentIds: string[] = [];
  const createdOpportunityIds: string[] = [];
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdIds) {
      try { await adapter.deleteConversation(id); } catch { /* Best-effort cleanup. */ }
    }
    if (createdOpportunityIds.length > 0) {
      await db.delete(schema.opportunities).where(inArray(schema.opportunities.id, createdOpportunityIds));
    }
    if (createdIntentIds.length > 0) {
      await db.delete(schema.intents).where(inArray(schema.intents.id, createdIntentIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(schema.users).where(inArray(schema.users.id, createdUserIds));
    }
  });

  describe('createConversation', () => {
    it('creates a conversation with participants', async () => {
      const result = await adapter.createConversation([
        { participantId: 'test-user-1', participantType: 'user' as const },
        { participantId: 'system-agent', participantType: 'agent' as const },
      ]);
      expect(result.id).toBeDefined();
      createdIds.push(result.id);
    }, 10000);
  });

  describe('getConversation', () => {
    it('returns conversation with participants', async () => {
      const result = await adapter.getConversation(createdIds[0]);
      expect(result).not.toBeNull();
      expect(result!.participants).toHaveLength(2);
    }, 10000);
  });

  describe('createMessage', () => {
    it('creates a message with A2A parts', async () => {
      const msg = await adapter.createMessage({
        conversationId: createdIds[0],
        senderId: 'test-user-1',
        role: 'user' as const,
        parts: [{ text: 'hello' }],
      });
      expect(msg.id).toBeDefined();
      expect(msg.parts).toEqual([{ text: 'hello' }]);
    }, 10000);
  });

  describe('getMessages', () => {
    it('returns messages in order', async () => {
      const msgs = await adapter.getMessages(createdIds[0]);
      expect(msgs.length).toBeGreaterThanOrEqual(1);
      expect(msgs[0].parts).toEqual([{ text: 'hello' }]);
    }, 10000);
  });

  describe('getLatestChatSessionMessages', () => {
    it('returns the latest messages chronologically with a same-millisecond id tiebreaker', async () => {
      const conversation = await adapter.createConversation([
        { participantId: 'latest-context-user', participantType: 'user' },
        { participantId: 'system-agent', participantType: 'agent' },
      ]);
      createdIds.push(conversation.id);

      const createdAt = new Date('2026-07-22T00:00:00.000Z');
      const durableSessionId = `latest-context-session-${conversation.id}`;
      await db.insert(schema.conversationSessions).values({
        id: durableSessionId,
        conversationId: conversation.id,
        startedAt: createdAt,
        lastMessageAt: createdAt,
      });
      await db.insert(schema.messages).values([
        { id: 'latest-context-a', conversationId: conversation.id, sessionId: durableSessionId, senderId: 'latest-context-user', role: 'user', parts: [{ text: 'oldest' }], createdAt },
        { id: 'latest-context-b', conversationId: conversation.id, sessionId: durableSessionId, senderId: 'system-agent', role: 'agent', parts: [{ text: 'newer' }], createdAt },
        { id: 'latest-context-c', conversationId: conversation.id, sessionId: durableSessionId, senderId: 'latest-context-user', role: 'user', parts: [{ text: 'latest' }], createdAt },
      ]);

      const messages = await adapter.getLatestChatSessionMessages(conversation.id, 2);

      expect(messages.map((message) => message.id)).toEqual([
        'latest-context-b',
        'latest-context-c',
      ]);
    }, 10000);
  });

  describe('durable conversation sessions', () => {
    it('stamps concurrent H2H writes into one session', async () => {
      const conversation = await adapter.createConversation([
        { participantId: 'session-concurrent-user', participantType: 'user' },
        { participantId: 'session-concurrent-peer', participantType: 'user' },
      ]);
      createdIds.push(conversation.id);

      await Promise.all([
        adapter.createMessage({
          conversationId: conversation.id,
          senderId: 'session-concurrent-user',
          role: 'user',
          parts: [{ text: 'one' }],
        }),
        adapter.createMessage({
          conversationId: conversation.id,
          senderId: 'session-concurrent-peer',
          role: 'user',
          parts: [{ text: 'two' }],
        }),
      ]);

      const sessions = await db.select()
        .from(schema.conversationSessions)
        .where(eq(schema.conversationSessions.conversationId, conversation.id));
      const messages = await adapter.getMessages(conversation.id);

      expect(sessions).toHaveLength(1);
      expect(new Set(messages.map((message) => message.sessionId)).size).toBe(1);
      expect(messages.every((message) => message.sessionId === sessions[0]?.id)).toBe(true);
    }, 10000);

    it('maps all A2A task messages to one task session', async () => {
      const conversation = await adapter.createConversation([
        { participantId: 'session-task-agent', participantType: 'agent' },
        { participantId: 'session-task-peer', participantType: 'agent' },
      ]);
      createdIds.push(conversation.id);
      const task = await adapter.createTask(conversation.id);

      await adapter.createMessage({
        conversationId: conversation.id,
        senderId: 'session-task-agent',
        role: 'agent',
        taskId: task.id,
        parts: [{ text: 'first turn' }],
      });
      await adapter.createMessage({
        conversationId: conversation.id,
        senderId: 'session-task-peer',
        role: 'agent',
        taskId: task.id,
        parts: [{ text: 'second turn' }],
      });

      const history = await adapter.getConversationSessionHistory(conversation.id, { taskId: task.id });

      expect(history.session?.taskId).toBe(task.id);
      expect(history.messages).toHaveLength(2);
      expect(history.messages.every((message) => message.sessionId === history.session?.id)).toBe(true);
      expect(history.hasPreviousSession).toBe(false);
    }, 10000);

    it('loads exactly one preceding session without reordering same-millisecond messages', async () => {
      const conversation = await adapter.createConversation([
        { participantId: 'session-history-user', participantType: 'user' },
        { participantId: 'session-history-peer', participantType: 'user' },
      ]);
      createdIds.push(conversation.id);
      const firstAt = new Date('2026-07-20T00:00:00.000Z');
      const secondAt = new Date('2026-07-21T00:00:00.000Z');
      const olderSessionId = `history-older-${conversation.id}`;
      const newerSessionId = `history-newer-${conversation.id}`;
      await db.insert(schema.conversationSessions).values([
        { id: olderSessionId, conversationId: conversation.id, startedAt: firstAt, lastMessageAt: firstAt },
        { id: newerSessionId, conversationId: conversation.id, startedAt: secondAt, lastMessageAt: secondAt },
      ]);
      await db.insert(schema.messages).values([
        { id: `history-a-${conversation.id}`, conversationId: conversation.id, sessionId: olderSessionId, senderId: 'session-history-user', role: 'user', parts: [{ text: 'old a' }], createdAt: firstAt },
        { id: `history-b-${conversation.id}`, conversationId: conversation.id, sessionId: olderSessionId, senderId: 'session-history-peer', role: 'user', parts: [{ text: 'old b' }], createdAt: firstAt },
        { id: `history-c-${conversation.id}`, conversationId: conversation.id, sessionId: newerSessionId, senderId: 'session-history-user', role: 'user', parts: [{ text: 'new' }], createdAt: secondAt },
      ]);

      const newest = await adapter.getConversationSessionHistory(conversation.id);
      const previous = await adapter.getConversationSessionHistory(conversation.id, {
        beforeSessionId: newest.session?.id,
      });
      const noMore = await adapter.getConversationSessionHistory(conversation.id, {
        beforeSessionId: previous.session?.id,
      });

      expect(newest.session?.id).toBe(newerSessionId);
      expect(newest.messages.map((message) => message.id)).toEqual([`history-c-${conversation.id}`]);
      expect(newest.hasPreviousSession).toBe(true);
      expect(previous.session?.id).toBe(olderSessionId);
      expect(previous.messages.map((message) => message.id)).toEqual([
        `history-a-${conversation.id}`,
        `history-b-${conversation.id}`,
      ]);
      expect(previous.hasPreviousSession).toBe(false);
      expect(noMore.session).toBeNull();
    }, 10000);
  });

  describe('getOrCreateDM', () => {
    it('finds existing DM between two users', async () => {
      const userA = 'dm-user-a-' + Date.now();
      const userB = 'dm-user-b-' + Date.now();
      const dm = await adapter.getOrCreateDM(userA, userB);
      createdIds.push(dm.id);
      const found = await adapter.getOrCreateDM(userA, userB);
      expect(found.id).toBe(dm.id);
    }, 10000);

    it('creates DM if none exists', async () => {
      const dm = await adapter.getOrCreateDM('new-x-' + Date.now(), 'new-y-' + Date.now());
      expect(dm.id).toBeDefined();
      createdIds.push(dm.id);
    }, 10000);
  });

  describe('tasks', () => {
    it('creates and updates task state', async () => {
      const task = await adapter.createTask(createdIds[0]);
      expect(task.state).toBe('submitted');
      const updated = await adapter.updateTaskState(task.id, 'working');
      expect(updated.state).toBe('working');
    }, 10000);
  });

  describe('getStaleNegotiationTasks', () => {
    it('returns only stale submitted/working negotiation tasks', async () => {
      const conv = await adapter.createConversation([
        { participantId: 'agent:watchdog-a', participantType: 'agent' as const },
        { participantId: 'agent:watchdog-b', participantType: 'agent' as const },
      ]);
      createdIds.push(conv.id);

      const staleSubmitted = await adapter.createTask(conv.id, {
        type: 'negotiation', opportunityId: 'watchdog-opportunity-submitted', sourceUserId: 'watchdog-user',
      });
      const staleWorking = await adapter.createTask(conv.id, {
        type: 'negotiation', opportunityId: 'watchdog-opportunity-working', sourceUserId: 'watchdog-user',
      });
      await adapter.updateTaskState(staleWorking.id, 'working');
      const freshSubmitted = await adapter.createTask(conv.id, {
        type: 'negotiation', opportunityId: 'watchdog-opportunity-fresh', sourceUserId: 'watchdog-user',
      });
      const completed = await adapter.createTask(conv.id, {
        type: 'negotiation', opportunityId: 'watchdog-opportunity-completed', sourceUserId: 'watchdog-user',
      });
      await adapter.updateTaskState(completed.id, 'completed');
      const nonNegotiation = await adapter.createTask(conv.id, { type: 'chat' });

      const oldSubmitted = new Date(Date.now() - 11 * 60 * 1000);
      const oldWorking = new Date(Date.now() - 13 * 60 * 60 * 1000);
      await db.update(schema.tasks)
        .set({ createdAt: oldSubmitted, updatedAt: oldSubmitted })
        .where(inArray(schema.tasks.id, [staleSubmitted.id]));
      await db.update(schema.tasks)
        .set({ createdAt: oldWorking, updatedAt: oldWorking })
        .where(inArray(schema.tasks.id, [staleWorking.id]));
      await db.update(schema.tasks)
        .set({ createdAt: new Date(), updatedAt: new Date() })
        .where(inArray(schema.tasks.id, [freshSubmitted.id]));
      await db.update(schema.tasks)
        .set({ createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000), updatedAt: new Date(Date.now() - 24 * 60 * 60 * 1000) })
        .where(inArray(schema.tasks.id, [completed.id, nonNegotiation.id]));

      const stale = await adapter.getStaleNegotiationTasks({
        submittedOlderThanMs: 10 * 60 * 1000,
        workingOlderThanMs: 12 * 60 * 60 * 1000,
        limit: 1000,
      });
      const staleIds = stale.map((task) => task.id);

      expect(staleIds).toContain(staleSubmitted.id);
      expect(staleIds).toContain(staleWorking.id);
      expect(staleIds).not.toContain(freshSubmitted.id);
      expect(staleIds).not.toContain(completed.id);
      expect(staleIds).not.toContain(nonNegotiation.id);
      expect(stale.every((task) => task.metadata && (task.metadata as Record<string, unknown>).type === 'negotiation')).toBe(true);
    }, 10000);
  });

  describe('getOpportunityLifecyclesForNegotiations', () => {
    it('omits unrelated opportunities and projects only owner-scoped lifecycle evidence', async () => {
      const suffix = `${Date.now()}-${crypto.randomUUID()}`;
      const ownerId = `narration-owner-${suffix}`;
      const otherId = `narration-other-${suffix}`;
      const unrelatedId = `narration-unrelated-${suffix}`;
      await db.insert(schema.users).values([
        { id: ownerId, email: `${ownerId}@test.local`, name: 'Narration Owner' },
        { id: otherId, email: `${otherId}@test.local`, name: 'Narration Other' },
        { id: unrelatedId, email: `${unrelatedId}@test.local`, name: 'Narration Unrelated' },
      ]);
      createdUserIds.push(ownerId, otherId, unrelatedId);

      const common = {
        detection: { source: 'manual' as const, timestamp: new Date().toISOString() },
        actors: [
          { networkId: 'narration-network', userId: ownerId, role: 'peer' },
          { networkId: 'narration-network', userId: otherId, role: 'peer' },
        ],
        interpretation: { category: 'test', reasoning: 'Lifecycle narration test.', confidence: 0.8 },
        context: {},
        confidence: '0.8',
        status: 'accepted' as const,
      };
      const inserted = await db.insert(schema.opportunities).values([
        { ...common, acceptedBy: ownerId },
        { ...common, acceptedBy: otherId },
        {
          ...common,
          actors: [
            { networkId: 'narration-network', userId: otherId, role: 'peer' },
            { networkId: 'narration-network', userId: unrelatedId, role: 'peer' },
          ],
          acceptedBy: unrelatedId,
        },
      ]).returning({ id: schema.opportunities.id });
      const opportunityIds = inserted.map((row) => row.id);
      createdOpportunityIds.push(...opportunityIds);

      const result = await adapter.getOpportunityLifecyclesForNegotiations(
        [...opportunityIds, 'missing-opportunity'],
        ownerId,
      );

      expect(result[inserted[0].id]).toEqual({ status: 'accepted', acceptedByOwner: true });
      expect(result[inserted[1].id]).toEqual({ status: 'accepted', acceptedByOwner: false });
      expect(result[inserted[2].id]).toBeUndefined();
      expect(result['missing-opportunity']).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain(otherId);
      expect(JSON.stringify(result)).not.toContain(unrelatedId);
    }, 10000);
  });

  describe('negotiation conversation summaries', () => {
    it('projects the latest task, opportunity, turn, and signal lifecycle', async () => {
      const suffix = `${Date.now()}-${crypto.randomUUID()}`;
      const ownerId = `inbox-owner-${suffix}`;
      const counterpartId = `inbox-counterpart-${suffix}`;
      const opportunityId = `inbox-opportunity-${suffix}`;
      const conversation = await adapter.createConversation([
        { participantId: `agent:${ownerId}`, participantType: 'agent' },
        { participantId: `agent:${counterpartId}`, participantType: 'agent' },
      ]);
      createdIds.push(conversation.id);

      await db.insert(schema.opportunities).values({
        id: opportunityId,
        detection: { source: 'manual', timestamp: new Date().toISOString() },
        actors: [
          { networkId: 'inbox-network', userId: ownerId, role: 'peer' },
          { networkId: 'inbox-network', userId: counterpartId, role: 'peer' },
        ],
        interpretation: { category: 'test', reasoning: 'Inbox lifecycle test.', confidence: 0.8 },
        context: {},
        confidence: '0.8',
        status: 'pending',
      });
      createdOpportunityIds.push(opportunityId);

      const task = await adapter.createTask(conversation.id, {
        type: 'negotiation',
        sourceUserId: ownerId,
        candidateUserId: counterpartId,
        sourceIntentId: 'source-intent',
        candidateIntentId: 'candidate-intent',
        participantBindings: [
          { userId: ownerId, intentId: 'source-intent' },
          { userId: counterpartId, intentId: 'candidate-intent' },
        ],
        opportunityId,
        maxTurns: 6,
        priorTurnCount: 1,
      });
      await adapter.createMessage({
        conversationId: conversation.id,
        senderId: `agent:${ownerId}`,
        role: 'agent',
        taskId: task.id,
        parts: [{ kind: 'data', data: { action: 'accept' } }],
      });
      await adapter.updateTaskState(task.id, 'completed');
      await adapter.createArtifact({
        taskId: task.id,
        name: 'negotiation-outcome',
        parts: [{ kind: 'data', data: { hasOpportunity: true, turnCount: 2 } }],
      });

      const summary = (await adapter.getConversationsForUser(`agent:${ownerId}`, ownerId, true))
        .find((candidate) => candidate.id === conversation.id);

      expect(summary?.negotiation).toMatchObject({
        taskId: task.id,
        state: 'completed',
        opportunityId,
        opportunityStatus: 'pending',
        acceptedByViewer: false,
        turnCount: 2,
        maxTurns: 6,
        signalCount: 2,
        outcome: { hasOpportunity: true, reason: null },
      });
    }, 20000);

    it('lets an older pending approval represent the pair over a newer screened-out pairing', async () => {
      // Two opportunities between the same pair: outreach → accept (pending
      // the owner's approval), then a later pairing the gate screened out.
      // The represented session is the live one, for the owner who may see
      // both AND for the counterparty who may not see the gate at all.
      const suffix = `${Date.now()}-${crypto.randomUUID()}`;
      const ownerId = `rollup-owner-${suffix}`;
      const counterpartId = `rollup-counterpart-${suffix}`;
      const pendingOpportunityId = `rollup-pending-${suffix}`;
      const screenedOpportunityId = `rollup-screened-${suffix}`;
      const conversation = await adapter.createConversation([
        { participantId: `agent:${ownerId}`, participantType: 'agent' },
        { participantId: `agent:${counterpartId}`, participantType: 'agent' },
      ]);
      createdIds.push(conversation.id);

      await db.insert(schema.opportunities).values([
        { id: pendingOpportunityId, status: 'pending' as const },
        { id: screenedOpportunityId, status: 'rejected' as const },
      ].map(({ id, status }) => ({
        id,
        detection: { source: 'manual', timestamp: new Date().toISOString() },
        actors: [
          { networkId: 'rollup-network', userId: ownerId, role: 'peer' },
          { networkId: 'rollup-network', userId: counterpartId, role: 'peer' },
        ],
        interpretation: { category: 'test', reasoning: 'Rollup test.', confidence: 0.8 },
        context: {},
        confidence: '0.8',
        status,
      })));
      createdOpportunityIds.push(pendingOpportunityId, screenedOpportunityId);

      const pendingTask = await adapter.createTask(conversation.id, {
        type: 'negotiation',
        sourceUserId: ownerId,
        candidateUserId: counterpartId,
        initiatorUserId: ownerId,
        opportunityId: pendingOpportunityId,
        maxTurns: 6,
      });
      await adapter.createMessage({
        conversationId: conversation.id,
        senderId: `agent:${counterpartId}`,
        role: 'agent',
        taskId: pendingTask.id,
        parts: [{ kind: 'data', data: { action: 'accept' } }],
      });
      await adapter.updateTaskState(pendingTask.id, 'completed');
      await adapter.createArtifact({
        taskId: pendingTask.id,
        name: 'negotiation-outcome',
        parts: [{ kind: 'data', data: { hasOpportunity: true, turnCount: 2 } }],
      });

      const screenedTask = await adapter.createTask(conversation.id, {
        type: 'negotiation',
        sourceUserId: ownerId,
        candidateUserId: counterpartId,
        initiatorUserId: ownerId,
        opportunityId: screenedOpportunityId,
        maxTurns: 6,
      });
      await adapter.updateTaskState(screenedTask.id, 'completed');
      await adapter.createArtifact({
        taskId: screenedTask.id,
        name: 'negotiation-outcome',
        parts: [{ kind: 'data', data: { hasOpportunity: false, reason: 'screened_out', turnCount: 0, reasoning: 'Not enough mutual value.' } }],
      });
      // Make the screened-out pairing unambiguously the newer task.
      await db.update(schema.tasks).set({ createdAt: new Date(Date.now() + 60_000) }).where(eq(schema.tasks.id, screenedTask.id));

      const ownerSummary = (await adapter.getConversationsForUser(`agent:${ownerId}`, ownerId, true))
        .find((candidate) => candidate.id === conversation.id);
      expect(ownerSummary?.negotiation).toMatchObject({
        taskId: pendingTask.id,
        opportunityId: pendingOpportunityId,
        opportunityStatus: 'pending',
        outcome: { hasOpportunity: true, reason: null },
      });
      // The conversation's last message is still that session's accept, so
      // the web can caption the row from it.
      expect(ownerSummary?.lastMessage?.taskId).toBe(pendingTask.id);

      const counterpartSummary = (await adapter.getConversationsForUser(`agent:${counterpartId}`, counterpartId, true))
        .find((candidate) => candidate.id === conversation.id);
      expect(counterpartSummary?.negotiation?.taskId).toBe(pendingTask.id);
      expect(JSON.stringify(counterpartSummary ?? {})).not.toContain('Not enough mutual value');
    }, 30000);
  });

  describe('getLatestNegotiationTaskForConversation', () => {
    it('returns the negotiation task, ignoring non-negotiation tasks, and null for fresh conversations', async () => {
      const conv = await adapter.createConversation([
        { participantId: 'agent:init-a', participantType: 'agent' as const },
        { participantId: 'agent:init-b', participantType: 'agent' as const },
      ]);
      createdIds.push(conv.id);

      expect(await adapter.getLatestNegotiationTaskForConversation(conv.id)).toBeNull();

      // Non-negotiation task must not match.
      await adapter.createTask(conv.id, { type: 'chat' });
      expect(await adapter.getLatestNegotiationTaskForConversation(conv.id)).toBeNull();

      const negotiationTask = await adapter.createTask(conv.id, {
        type: 'negotiation',
        sourceUserId: 'init-a',
        initiatorUserId: 'init-a',
      });

      const found = await adapter.getLatestNegotiationTaskForConversation(conv.id);
      expect(found?.id).toBe(negotiationTask.id);
      expect(found?.metadata?.initiatorUserId).toBe('init-a');
    }, 10000);
  });

  describe('artifacts', () => {
    it('creates artifact linked to task', async () => {
      const task = await adapter.createTask(createdIds[0]);
      const artifact = await adapter.createArtifact({
        taskId: task.id,
        name: 'test-artifact',
        parts: [{ data: { score: 0.9 }, media_type: 'application/json' }],
      });
      expect(artifact.id).toBeDefined();
      expect(artifact.taskId).toBe(task.id);
    }, 10000);
  });

  describe('getNegotiationsByUser — screened_out visibility (P2.2)', () => {
    it('screened_out rows stay visible to the owner but are excluded from the mutual (non-self) view', async () => {
      const run = Date.now();
      const userA = `screen-owner-${run}`;
      const userB = `screen-counterparty-${run}`;

      const conv = await adapter.createConversation([
        { participantId: `agent:${userA}`, participantType: 'agent' as const },
        { participantId: `agent:${userB}`, participantType: 'agent' as const },
      ]);
      createdIds.push(conv.id);

      // 1. A screened_out negotiation (zero turns, gate declined).
      const screenedTask = await adapter.createTask(conv.id, {
        type: 'negotiation',
        sourceUserId: userA,
        candidateUserId: userB,
        initiatorUserId: userA,
      });
      await adapter.updateTaskState(screenedTask.id, 'completed');
      await adapter.createArtifact({
        taskId: screenedTask.id,
        name: 'negotiation-outcome',
        parts: [{ kind: 'data', data: { hasOpportunity: false, agreedRoles: [], reasoning: 'gate declined', turnCount: 0, reason: 'screened_out' } }],
      });

      // 2. A normally-rejected negotiation between the same pair.
      const rejectedTask = await adapter.createTask(conv.id, {
        type: 'negotiation',
        sourceUserId: userA,
        candidateUserId: userB,
        initiatorUserId: userA,
      });
      await adapter.updateTaskState(rejectedTask.id, 'completed');
      await adapter.createArtifact({
        taskId: rejectedTask.id,
        name: 'negotiation-outcome',
        parts: [{ kind: 'data', data: { hasOpportunity: false, agreedRoles: [], reasoning: 'declined after turns', turnCount: 3 } }],
      });

      // 3. An in-progress negotiation (no artifact yet) — must survive the exclusion filter.
      const inProgressTask = await adapter.createTask(conv.id, {
        type: 'negotiation',
        sourceUserId: userA,
        candidateUserId: userB,
        initiatorUserId: userA,
      });

      // Self view: the owner sees all three, including their own gate decision.
      const selfRows = await adapter.getNegotiationsByUser(userA, { limit: 50 });
      const selfIds = selfRows.map((r) => r.id);
      expect(selfIds).toContain(screenedTask.id);
      expect(selfIds).toContain(rejectedTask.id);
      expect(selfIds).toContain(inProgressTask.id);

      // Mutual view (counterparty viewing the owner's profile): the gate
      // decision is invisible; real negotiations and in-flight rows remain.
      const mutualRows = await adapter.getNegotiationsByUser(userA, { limit: 50, mutualWithUserId: userB });
      const mutualIds = mutualRows.map((r) => r.id);
      expect(mutualIds).not.toContain(screenedTask.id);
      expect(mutualIds).toContain(rejectedTask.id);
      expect(mutualIds).toContain(inProgressTask.id);
    }, 30000);
  });

  describe('getConversationsForUser — opportunity session projection', () => {
    it('projects every viewer-visible opportunity with its newest task without exposing the counterpart intent', async () => {
      const run = crypto.randomUUID();
      const viewerId = `outline-viewer-${run}`;
      const counterpartId = `outline-counterpart-${run}`;
      const viewerIntentId = `outline-intent-${run}`;
      const counterpartIntentId = `outline-private-${run}`;
      const firstOpportunityId = `outline-opportunity-a-${run}`;
      const secondOpportunityId = `outline-opportunity-b-${run}`;
      createdUserIds.push(viewerId, counterpartId);
      createdIntentIds.push(viewerIntentId, counterpartIntentId);
      createdOpportunityIds.push(firstOpportunityId, secondOpportunityId);

      await db.insert(schema.users).values([
        { id: viewerId, email: `${viewerId}@test.com`, name: 'Outline Viewer' },
        { id: counterpartId, email: `${counterpartId}@test.com`, name: 'Outline Counterpart' },
      ]);
      await db.insert(schema.intents).values([
        { id: viewerIntentId, userId: viewerId, payload: 'Need a design partner', summary: 'Design partner' },
        { id: counterpartIntentId, userId: counterpartId, payload: 'Private counterpart intent', summary: 'Private signal' },
      ]);
      await db.insert(schema.opportunities).values([firstOpportunityId, secondOpportunityId].map((id, index) => ({
        id,
        detection: { source: 'manual', timestamp: new Date().toISOString() },
        actors: [{ networkId: 'outline-network', userId: viewerId, role: 'peer' }, { networkId: 'outline-network', userId: counterpartId, role: 'peer' }],
        interpretation: { category: 'test', reasoning: 'Projection test', confidence: 0.8 },
        context: {}, confidence: '0.8', status: index === 0 ? 'negotiating' as const : 'accepted' as const,
      })));
      const conversation = await adapter.createConversation([
        { participantId: `agent:${viewerId}`, participantType: 'agent' },
        { participantId: `agent:${counterpartId}`, participantType: 'agent' },
      ]);
      createdIds.push(conversation.id);
      for (const opportunityId of [firstOpportunityId, secondOpportunityId]) {
        await adapter.appendMatchProvenance(conversation.id, {
          opportunityId,
          intents: [{ userId: viewerId, intentId: viewerIntentId }, { userId: counterpartId, intentId: counterpartIntentId }],
          recordedAt: new Date().toISOString(),
        });
      }
      const olderTask = await adapter.createTask(conversation.id, { type: 'negotiation', sourceUserId: viewerId, candidateUserId: counterpartId, opportunityId: firstOpportunityId });
      const newestTask = await adapter.createTask(conversation.id, { type: 'negotiation', sourceUserId: viewerId, candidateUserId: counterpartId, opportunityId: firstOpportunityId });
      const secondTask = await adapter.createTask(conversation.id, { type: 'negotiation', sourceUserId: viewerId, candidateUserId: counterpartId, opportunityId: secondOpportunityId });
      await db.update(schema.tasks).set({ createdAt: new Date(Date.now() - 1_000) }).where(eq(schema.tasks.id, olderTask.id));

      const summary = (await adapter.getConversationsForUser(`agent:${viewerId}`, viewerId, true))
        .find((candidate) => candidate.id === conversation.id);
      expect(summary?.negotiationOpportunities).toEqual(expect.arrayContaining([
        expect.objectContaining({ intentId: viewerIntentId, opportunityId: firstOpportunityId, title: 'Design partner', taskId: newestTask.id, opportunityStatus: 'negotiating' }),
        expect.objectContaining({ intentId: viewerIntentId, opportunityId: secondOpportunityId, title: 'Design partner', taskId: secondTask.id, opportunityStatus: 'accepted' }),
      ]));
      expect(summary?.negotiationOpportunities?.some((item) => item.taskId === olderTask.id)).toBeFalse();
      expect(JSON.stringify(summary?.negotiationOpportunities)).not.toContain(counterpartIntentId);
    }, 30000);
  });

  describe('getNegotiationTasksForUser — archived filter (#1494 round-2 cap-cut item)', () => {
    it('excludes archived legacy negotiations from list_negotiations', async () => {
      const run = `${Date.now()}-${crypto.randomUUID()}`;
      const userId = `archived-filter-user-${run}`;
      const counterpart = `archived-filter-counterpart-${run}`;

      const conversation = await adapter.createConversation([
        { participantId: `agent:${userId}`, participantType: 'agent' as const },
        { participantId: `agent:${counterpart}`, participantType: 'agent' as const },
      ]);
      createdIds.push(conversation.id);

      const liveTask = await adapter.createTask(conversation.id, {
        type: 'negotiation',
        sourceUserId: userId,
        candidateUserId: counterpart,
      });

      const archivedConversation = await adapter.createConversation([
        { participantId: `agent:${userId}`, participantType: 'agent' as const },
        { participantId: `agent:${counterpart}`, participantType: 'agent' as const },
      ]);
      createdIds.push(archivedConversation.id);
      const archivedTask = await adapter.createTask(archivedConversation.id, {
        type: 'negotiation',
        sourceUserId: userId,
        candidateUserId: counterpart,
        archivedAt: new Date().toISOString(),
      });

      const tasks = await adapter.getNegotiationTasksForUser(userId);
      const ids = tasks.map((t) => t.id);
      expect(ids).toContain(liveTask.id);
      expect(ids).not.toContain(archivedTask.id);
    });
  });

  describe('getNegotiationTaskForOpportunity — archived filter (#1494 round-3 finding 4)', () => {
    it('does not resolve an archived legacy task as the opportunity\'s existing negotiation', async () => {
      const run = `${Date.now()}-${crypto.randomUUID()}`;
      const opportunityId = `archived-opp-filter-${run}`;
      const userId = `archived-opp-filter-user-${run}`;
      const counterpart = `archived-opp-filter-counterpart-${run}`;

      const conversation = await adapter.createConversation([
        { participantId: `agent:${userId}`, participantType: 'agent' as const },
        { participantId: `agent:${counterpart}`, participantType: 'agent' as const },
      ]);
      createdIds.push(conversation.id);
      const archivedTask = await adapter.createTask(conversation.id, {
        type: 'negotiation',
        opportunityId,
        sourceUserId: userId,
        candidateUserId: counterpart,
        archivedAt: new Date().toISOString(),
      });

      const found = await adapter.getNegotiationTaskForOpportunity(opportunityId);
      expect(found?.id).not.toBe(archivedTask.id);
      expect(found).toBeNull();
    });
  });

  describe('updateNegotiationTaskState / setNegotiationRound — no lost updates (#1494 round-3 cap-cut a)', () => {
    it('two concurrent writers touching different metadata keys both land', async () => {
      const run = `${Date.now()}-${crypto.randomUUID()}`;
      const userId = `concurrent-meta-user-${run}`;
      const counterpart = `concurrent-meta-counterpart-${run}`;

      const conversation = await adapter.createConversation([
        { participantId: `agent:${userId}`, participantType: 'agent' as const },
        { participantId: `agent:${counterpart}`, participantType: 'agent' as const },
      ]);
      createdIds.push(conversation.id);
      const task = await adapter.createTask(conversation.id, {
        type: 'negotiation',
        sourceUserId: userId,
        candidateUserId: counterpart,
        round: 1,
      });

      // The old select-then-spread-then-update shape had a lost-update race
      // here: whichever call's UPDATE landed second would overwrite the
      // whole metadata blob with its own stale read, discarding the other's
      // key. jsonb_set merges one key server-side, so both survive
      // regardless of interleaving.
      await Promise.all([
        adapter.setNegotiationRound(task.id, 7),
        adapter.updateNegotiationTaskState(task.id, 'paused', { reason: 'counterparty_silent' }),
      ]);

      const reread = await adapter.getNegotiationTask(task.id);
      expect(reread?.metadata.round).toBe(7);
      expect(reread?.metadata.pause).toMatchObject({ reason: 'counterparty_silent' });
      expect(reread?.state).toBe('paused');
    });
  });

  describe('getConversationsForUser — pause projection (#1494 round-2 finding 10)', () => {
    it('projects pause.reason to every viewer, and payload only to the seat that paused', async () => {
      const run = `${Date.now()}-${crypto.randomUUID()}`;
      const pauser = `pause-pauser-${run}`;
      const other = `pause-other-${run}`;

      const conversation = await adapter.createConversation([
        { participantId: `agent:${pauser}`, participantType: 'agent' as const },
        { participantId: `agent:${other}`, participantType: 'agent' as const },
      ]);
      createdIds.push(conversation.id);

      const task = await adapter.createTask(conversation.id, {
        type: 'negotiation',
        sourceUserId: pauser,
        candidateUserId: other,
        initiatorUserId: pauser,
        pause: {
          reason: 'needs_principal',
          payload: { question: 'What equity split are you open to?' },
          pausedBy: pauser,
        },
      });
      await adapter.updateTaskState(task.id, 'paused');

      const pauserSummary = (await adapter.getConversationsForUser(`agent:${pauser}`, pauser, true))
        .find((c) => c.id === conversation.id);
      expect(pauserSummary?.negotiation?.pause).toEqual({
        reason: 'needs_principal',
        payload: { question: 'What equity split are you open to?' },
      });

      const otherSummary = (await adapter.getConversationsForUser(`agent:${other}`, other, true))
        .find((c) => c.id === conversation.id);
      expect(otherSummary?.negotiation?.pause).toEqual({ reason: 'needs_principal' });
      expect(JSON.stringify(otherSummary?.negotiation?.pause)).not.toContain('equity split');
    }, 30000);

    it('never projects a stale metadata.pause once the task is no longer paused (#1494 round-3 finding 5)', async () => {
      const run = `${Date.now()}-${crypto.randomUUID()}`;
      const pauser = `stale-pause-pauser-${run}`;
      const other = `stale-pause-other-${run}`;

      const conversation = await adapter.createConversation([
        { participantId: `agent:${pauser}`, participantType: 'agent' as const },
        { participantId: `agent:${other}`, participantType: 'agent' as const },
      ]);
      createdIds.push(conversation.id);

      // The task WAS paused (metadata.pause still set, as a caller that
      // forgot to clear it on resume would leave), but state has moved on —
      // the projection must not read a stale answered question as live.
      const task = await adapter.createTask(conversation.id, {
        type: 'negotiation',
        sourceUserId: pauser,
        candidateUserId: other,
        initiatorUserId: pauser,
        pause: {
          reason: 'needs_principal',
          payload: { question: 'What equity split are you open to?' },
          pausedBy: pauser,
        },
      });
      await adapter.updateTaskState(task.id, 'working');

      const pauserSummary = (await adapter.getConversationsForUser(`agent:${pauser}`, pauser, true))
        .find((c) => c.id === conversation.id);
      expect(pauserSummary?.negotiation?.pause).toBeNull();
    }, 30000);
  });

  describe('getConversationsForUser — screenDecision privacy (IND-610)', () => {
    it('projects named screenDecision fields to the initiator only, never to the non-owner counterparty, even for a mutually-visible negotiation', async () => {
      const run = `${Date.now()}-${crypto.randomUUID()}`;
      const initiator = `screendecision-initiator-${run}`;
      const counterpart = `screendecision-counterpart-${run}`;

      const conversation = await adapter.createConversation([
        { participantId: `agent:${initiator}`, participantType: 'agent' as const },
        { participantId: `agent:${counterpart}`, participantType: 'agent' as const },
      ]);
      createdIds.push(conversation.id);

      // An ordinary (non screened_out) negotiation that stays mutually visible
      // to both sides — the outer screened_out skip does NOT apply here, so
      // the screenDecision projection is the only thing standing between the
      // counterparty and the initiator's private outreach-gate reasoning.
      const task = await adapter.createTask(conversation.id, {
        type: 'negotiation',
        sourceUserId: initiator,
        candidateUserId: counterpart,
        initiatorUserId: initiator,
        screenDecision: {
          decision: 'reach_out',
          reasoning: 'Strong overlap on ML tooling need.',
          mode: 'enforce',
          evidence: {
            counterpartyPremiseFit: 'Counterpart actively seeks ML engineering help.',
            intentAlignment: 'Both intents describe the same collaboration shape.',
          },
          screenedAt: new Date().toISOString(),
          durationMs: 120,
        },
      });
      await adapter.updateTaskState(task.id, 'completed');
      await adapter.createArtifact({
        taskId: task.id,
        name: 'negotiation-outcome',
        parts: [{ kind: 'data', data: { hasOpportunity: true, turnCount: 1 } }],
      });

      // Owner (initiator) view: named fields are present verbatim.
      const ownerSummary = (await adapter.getConversationsForUser(`agent:${initiator}`, initiator, true))
        .find((c) => c.id === conversation.id);
      expect(ownerSummary?.negotiation?.screenDecision).toMatchObject({
        decision: 'reach_out',
        reasoning: 'Strong overlap on ML tooling need.',
        counterpartyPremiseFit: 'Counterpart actively seeks ML engineering help.',
        intentAlignment: 'Both intents describe the same collaboration shape.',
      });

      // Counterparty (non-owner) direct fetch: the negotiation itself remains
      // visible (this is not a screened_out row), but no screenDecision field
      // — named or raw — is present at all.
      const counterpartSummary = (await adapter.getConversationsForUser(`agent:${counterpart}`, counterpart, true))
        .find((c) => c.id === conversation.id);
      expect(counterpartSummary?.negotiation).toBeTruthy();
      expect(counterpartSummary?.negotiation?.screenDecision).toBeFalsy();
      // Defense in depth: the raw metadata blob must never surface either.
      expect(JSON.stringify(counterpartSummary?.negotiation)).not.toContain('reasoning');
      expect(JSON.stringify(counterpartSummary?.negotiation)).not.toContain('counterpartyPremiseFit');
      expect(JSON.stringify(counterpartSummary?.negotiation)).not.toContain('intentAlignment');
    }, 30000);

    it('gives the owner the screen reasoning on a zero-turn screened_out negotiation, hides the whole negotiation from the counterparty, and creates no messages', async () => {
      const run = `${Date.now()}-${crypto.randomUUID()}`;
      const initiator = `screenedout-initiator-${run}`;
      const counterpart = `screenedout-counterpart-${run}`;

      const conversation = await adapter.createConversation([
        { participantId: `agent:${initiator}`, participantType: 'agent' as const },
        { participantId: `agent:${counterpart}`, participantType: 'agent' as const },
      ]);
      createdIds.push(conversation.id);

      const task = await adapter.createTask(conversation.id, {
        type: 'negotiation',
        sourceUserId: initiator,
        candidateUserId: counterpart,
        initiatorUserId: initiator,
        screenDecision: {
          decision: 'pass',
          reasoning: 'Their focus is fundraising, not the hiring help you asked for.',
          mode: 'enforce',
          evidence: {
            counterpartyPremiseFit: 'Counterpart is raising a seed round.',
            intentAlignment: 'No overlap with your open engineering role.',
          },
          screenedAt: new Date().toISOString(),
          durationMs: 90,
        },
      });
      await adapter.updateTaskState(task.id, 'completed');
      await adapter.createArtifact({
        taskId: task.id,
        name: 'negotiation-outcome',
        parts: [{
          kind: 'data',
          data: { hasOpportunity: false, reason: 'screened_out', turnCount: 0, reasoning: 'Their focus is fundraising, not the hiring help you asked for.' },
        }],
      });

      const ownerSummary = (await adapter.getConversationsForUser(`agent:${initiator}`, initiator, true))
        .find((c) => c.id === conversation.id);
      expect(ownerSummary?.negotiation?.outcome).toMatchObject({ hasOpportunity: false, reason: 'screened_out' });
      expect(ownerSummary?.negotiation?.screenDecision).toMatchObject({
        source: 'screen',
        decision: 'pass',
        reasoning: 'Their focus is fundraising, not the hiring help you asked for.',
        counterpartyPremiseFit: 'Counterpart is raising a seed round.',
        intentAlignment: 'No overlap with your open engineering role.',
      });

      // The counterparty never learns a gate decision was made at all.
      const counterpartSummary = (await adapter.getConversationsForUser(`agent:${counterpart}`, counterpart, true))
        .find((c) => c.id === conversation.id);
      expect(counterpartSummary?.negotiation ?? null).toBeNull();
      expect(JSON.stringify(counterpartSummary ?? {})).not.toContain('fundraising');

      // HARD CONSTRAINT: surfacing the decline must add zero message rows, or
      // it would enter the shared thread both sides read back as priorDialogue.
      const messageRows = await db
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, conversation.id));
      expect(messageRows).toHaveLength(0);
    }, 30000);

    it('falls back to the outcome reasoning when the refusal happened at the opening turn instead of the screen node', async () => {
      const run = `${Date.now()}-${crypto.randomUUID()}`;
      const initiator = `openingwithdraw-initiator-${run}`;
      const counterpart = `openingwithdraw-counterpart-${run}`;

      const conversation = await adapter.createConversation([
        { participantId: `agent:${initiator}`, participantType: 'agent' as const },
        { participantId: `agent:${counterpart}`, participantType: 'agent' as const },
      ]);
      createdIds.push(conversation.id);

      // No metadata.screenDecision at all — this is the shape a turn-0 withdraw
      // leaves behind: same `screened_out` outcome, reasoning only on the artifact.
      const task = await adapter.createTask(conversation.id, {
        type: 'negotiation',
        sourceUserId: initiator,
        candidateUserId: counterpart,
        initiatorUserId: initiator,
      });
      await adapter.updateTaskState(task.id, 'completed');
      await adapter.createArtifact({
        taskId: task.id,
        name: 'negotiation-outcome',
        parts: [{
          kind: 'data',
          data: { hasOpportunity: false, reason: 'screened_out', turnCount: 0, reasoning: 'Not worth spending your name on this one.' },
        }],
      });

      const ownerSummary = (await adapter.getConversationsForUser(`agent:${initiator}`, initiator, true))
        .find((c) => c.id === conversation.id);
      expect(ownerSummary?.negotiation?.screenDecision).toMatchObject({
        source: 'outcome',
        decision: 'pass',
        reasoning: 'Not worth spending your name on this one.',
        counterpartyPremiseFit: null,
        intentAlignment: null,
      });

      // The shared `outcome` projection must not carry the reasoning: it is the
      // owner-only field that does, and only via the initiator-gated branch.
      expect(Object.keys(ownerSummary?.negotiation?.outcome ?? {})).toEqual(['hasOpportunity', 'reason']);

      const counterpartSummary = (await adapter.getConversationsForUser(`agent:${counterpart}`, counterpart, true))
        .find((c) => c.id === conversation.id);
      expect(counterpartSummary?.negotiation ?? null).toBeNull();
      expect(JSON.stringify(counterpartSummary ?? {})).not.toContain('Not worth spending');
    }, 30000);
  });

  describe('unread tracking', () => {
    it('counts only counterpart messages and clears only the viewer cursor', async () => {
      const viewerId = `unread-viewer-${Date.now()}`;
      const peerId = `unread-peer-${Date.now()}`;
      const dm = await adapter.getOrCreateDM(viewerId, peerId);
      createdIds.push(dm.id);

      await adapter.createMessage({
        conversationId: dm.id,
        senderId: peerId,
        role: 'user',
        parts: [{ text: 'counterpart message' }],
      });
      await adapter.createMessage({
        conversationId: dm.id,
        senderId: viewerId,
        role: 'user',
        parts: [{ text: 'own message' }],
      });

      let summary = (await adapter.getConversationsForUser(viewerId)).find((conversation) => conversation.id === dm.id);
      expect(summary?.unreadCount).toBe(1);

      await adapter.markConversationRead(viewerId, dm.id);
      const marked = await adapter.getConversation(dm.id);
      expect(marked?.participants.find((p) => p.participantId === viewerId)?.lastReadAt).not.toBeNull();
      expect(marked?.participants.find((p) => p.participantId === peerId)?.lastReadAt).toBeNull();

      summary = (await adapter.getConversationsForUser(viewerId)).find((conversation) => conversation.id === dm.id);
      expect(summary?.unreadCount).toBe(0);

      await adapter.createMessage({
        conversationId: dm.id,
        senderId: peerId,
        role: 'user',
        parts: [{ text: 'new counterpart message' }],
      });
      summary = (await adapter.getConversationsForUser(viewerId)).find((conversation) => conversation.id === dm.id);
      expect(summary?.unreadCount).toBe(1);
    }, 20000);

  });

  describe('hideConversation', () => {
    it('sets hiddenAt on participant', async () => {
      await adapter.hideConversation('test-user-1', createdIds[0]);
      const conv = await adapter.getConversation(createdIds[0]);
      const p = conv!.participants.find(p => p.participantId === 'test-user-1');
      expect(p!.hiddenAt).not.toBeNull();
    }, 10000);
  });

  describe('metadata', () => {
    it('upserts and retrieves metadata', async () => {
      await adapter.upsertMetadata(createdIds[0], { title: 'Test Chat', shareToken: 'abc' });
      const meta = await adapter.getMetadata(createdIds[0]);
      expect(meta).toEqual({ title: 'Test Chat', shareToken: 'abc' });
    }, 10000);

    it('appends match provenance in latest-first order and deduplicates re-entry', async () => {
      const first = { opportunityId: 'opp-first', intents: [{ userId: 'viewer', intentId: 'intent-first' }], recordedAt: '2026-01-01T00:00:00.000Z' };
      const second = { opportunityId: 'opp-second', intents: [{ userId: 'viewer', intentId: 'intent-second' }], recordedAt: '2026-01-02T00:00:00.000Z' };
      await adapter.appendMatchProvenance(createdIds[0], first);
      await adapter.appendMatchProvenance(createdIds[0], second);
      await adapter.appendMatchProvenance(createdIds[0], { ...first, recordedAt: '2026-01-03T00:00:00.000Z' });

      const meta = await adapter.getMetadata(createdIds[0]);
      expect(meta?.matchProvenance).toEqual([second, { ...first, recordedAt: '2026-01-03T00:00:00.000Z' }]);
    }, 10000);

    it('exposes only the viewer intent title as via on conversation summaries', async () => {
      const run = crypto.randomUUID();
      const viewerId = `provenance-viewer-${run}`;
      const counterpartId = `provenance-counterpart-${run}`;
      const viewerIntentId = `provenance-viewer-intent-${run}`;
      const counterpartIntentId = `provenance-counterpart-intent-${run}`;
      createdUserIds.push(viewerId, counterpartId);
      createdIntentIds.push(viewerIntentId, counterpartIntentId);

      await db.insert(schema.users).values([
        { id: viewerId, email: `${viewerId}@test.com`, name: 'Provenance Viewer' },
        { id: counterpartId, email: `${counterpartId}@test.com`, name: 'Provenance Counterpart' },
      ]);
      await db.insert(schema.intents).values([
        { id: viewerIntentId, userId: viewerId, payload: 'Viewer private framing', summary: 'Viewer signal' },
        { id: counterpartIntentId, userId: counterpartId, payload: 'Counterpart private framing', summary: 'Counterpart signal' },
      ]);
      const dm = await adapter.getOrCreateDM(viewerId, counterpartId);
      createdIds.push(dm.id);
      await adapter.appendMatchProvenance(dm.id, {
        opportunityId: 'opp-private-signal',
        intents: [
          { userId: viewerId, intentId: viewerIntentId },
          { userId: counterpartId, intentId: counterpartIntentId },
        ],
        recordedAt: new Date().toISOString(),
      });

      const summary = (await adapter.getConversationsForUser(viewerId)).find((conversation) => conversation.id === dm.id);
      expect(summary?.via).toEqual([{ intentId: viewerIntentId, opportunityId: 'opp-private-signal', title: 'Viewer signal' }]);
      expect(summary?.metadata).not.toHaveProperty('matchProvenance');
    }, 20000);

    it('projects owner intent provenance when listing an agent negotiation', async () => {
      const run = crypto.randomUUID();
      const viewerId = `agent-provenance-viewer-${run}`;
      const counterpartId = `agent-provenance-counterpart-${run}`;
      const viewerIntentId = `agent-provenance-viewer-intent-${run}`;
      const counterpartIntentId = `agent-provenance-counterpart-intent-${run}`;
      createdUserIds.push(viewerId, counterpartId);
      createdIntentIds.push(viewerIntentId, counterpartIntentId);

      await db.insert(schema.users).values([
        { id: viewerId, email: `${viewerId}@test.com`, name: 'Agent Provenance Viewer' },
        { id: counterpartId, email: `${counterpartId}@test.com`, name: 'Agent Provenance Counterpart' },
      ]);
      await db.insert(schema.intents).values([
        { id: viewerIntentId, userId: viewerId, payload: 'Viewer private framing', summary: 'Viewer signal' },
        { id: counterpartIntentId, userId: counterpartId, payload: 'Counterpart private framing', summary: 'Counterpart signal' },
      ]);
      const negotiation = await adapter.createConversation([
        { participantId: `agent:${viewerId}`, participantType: 'agent' },
        { participantId: `agent:${counterpartId}`, participantType: 'agent' },
      ]);
      createdIds.push(negotiation.id);
      await adapter.appendMatchProvenance(negotiation.id, {
        opportunityId: 'opp-agent-private-signal',
        intents: [
          { userId: viewerId, intentId: viewerIntentId },
          { userId: counterpartId, intentId: counterpartIntentId },
        ],
        recordedAt: new Date().toISOString(),
      });

      const summary = (await adapter.getConversationsForUser(`agent:${viewerId}`, viewerId))
        .find((conversation) => conversation.id === negotiation.id);

      expect(summary?.via).toEqual([
        { intentId: viewerIntentId, opportunityId: 'opp-agent-private-signal', title: 'Viewer signal' },
      ]);
      expect(summary?.metadata).not.toHaveProperty('matchProvenance');
    }, 20000);
  });
});
