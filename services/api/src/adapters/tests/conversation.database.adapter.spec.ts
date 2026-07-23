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
