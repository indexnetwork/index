import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, afterAll } from 'bun:test';
import { inArray } from 'drizzle-orm';
import db from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { ConversationDatabaseAdapter } from '../database.adapter';

describe('ConversationDatabaseAdapter', () => {
  const adapter = new ConversationDatabaseAdapter();
  const createdIds: string[] = [];
  const createdIntentIds: string[] = [];
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdIds) {
      try { await adapter.deleteConversation(id); } catch {}
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
  });
});
