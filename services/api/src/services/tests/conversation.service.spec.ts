import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, afterAll } from 'bun:test';

import db from '../../lib/drizzle/drizzle';
import { artifacts, tasks } from '../../schemas/database.schema';

import { ConversationService } from '../conversation.service';
import { TaskService } from '../task.service';

const conversationService = new ConversationService();
const taskService = new TaskService();
const cleanupIds: string[] = [];

afterAll(async () => {
  for (const id of cleanupIds) {
    try {
      const { conversationDatabaseAdapter } = await import('../../adapters/database.adapter');
      await conversationDatabaseAdapter.deleteConversation(id);
    } catch {
      // Best-effort cleanup; test assertions have already completed.
    }
  }
});

describe('ConversationService', () => {
  it('creates conversation and sends message', async () => {
    const conv = await conversationService.createConversation([
      { participantId: 'svc-user-1', participantType: 'user' as const },
      { participantId: 'system-agent', participantType: 'agent' as const },
    ]);
    expect(conv.id).toBeDefined();
    cleanupIds.push(conv.id);

    const msg = await conversationService.sendMessage(conv.id, 'svc-user-1', 'user', [{ text: 'test message' }]);
    expect(msg.id).toBeDefined();
    expect(msg.parts).toEqual([{ text: 'test message' }]);
  }, 15000);

  it('getOrCreateDM deduplicates', async () => {
    const a = 'svc-dm-a-' + Date.now();
    const b = 'svc-dm-b-' + Date.now();
    const dm1 = await conversationService.getOrCreateDM(a, b);
    cleanupIds.push(dm1.id);
    const dm2 = await conversationService.getOrCreateDM(a, b);
    expect(dm1.id).toBe(dm2.id);
  }, 15000);

  it('lists conversations for user', async () => {
    const convs = await conversationService.getConversations('svc-user-1');
    expect(Array.isArray(convs)).toBe(true);
  }, 15000);

  it('hides conversation', async () => {
    const conv = await conversationService.createConversation([
      { participantId: 'svc-hide-user', participantType: 'user' as const },
      { participantId: 'system-agent', participantType: 'agent' as const },
    ]);
    cleanupIds.push(conv.id);
    await conversationService.hideConversation('svc-hide-user', conv.id);
    // No error thrown = success
  }, 15000);

  describe('authorization', () => {
    it('should reject getMessages for non-participant', async () => {
      const conv = await conversationService.createConversation([
        { participantId: 'auth-user-a', participantType: 'user' },
      ]);
      cleanupIds.push(conv.id);

      await expect(
        conversationService.getMessages(conv.id, { userId: 'non-participant-user' }),
      ).rejects.toThrow(/not a participant/i);
    }, 15000);

    it('should reject sendMessage for non-participant', async () => {
      const conv = await conversationService.createConversation([
        { participantId: 'auth-user-a', participantType: 'user' },
      ]);
      cleanupIds.push(conv.id);

      await expect(
        conversationService.sendMessage(conv.id, 'non-participant-user', 'user', [{ type: 'text', text: 'hello' }]),
      ).rejects.toThrow(/not a participant/i);
    }, 15000);

    it('should reject hideConversation for non-participant', async () => {
      const conv = await conversationService.createConversation([
        { participantId: 'auth-user-a', participantType: 'user' },
      ]);
      cleanupIds.push(conv.id);

      await expect(
        conversationService.hideConversation('non-participant-user', conv.id),
      ).rejects.toThrow(/not a participant/i);
    }, 15000);

    it('should allow getMessages for valid participant', async () => {
      const conv = await conversationService.createConversation([
        { participantId: 'auth-user-a', participantType: 'user' },
      ]);
      cleanupIds.push(conv.id);

      const messages = await conversationService.getMessages(conv.id, { userId: 'auth-user-a' });
      expect(messages).toEqual([]);
    }, 15000);

    it('should allow getMessages without userId (internal call)', async () => {
      const conv = await conversationService.createConversation([
        { participantId: 'auth-user-a', participantType: 'user' },
      ]);
      cleanupIds.push(conv.id);

      const messages = await conversationService.getMessages(conv.id);
      expect(messages).toEqual([]);
    }, 15000);
  });
});

describe('TaskService', () => {
  it('creates task and transitions states', async () => {
    const conv = await conversationService.createConversation([
      { participantId: 'task-svc-user', participantType: 'user' as const },
      { participantId: 'system-agent', participantType: 'agent' as const },
    ]);
    cleanupIds.push(conv.id);

    const task = await taskService.createTask(conv.id);
    expect(task.state).toBe('submitted');

    const working = await taskService.updateState(task.id, 'working');
    expect(working.state).toBe('working');

    const completed = await taskService.updateState(task.id, 'completed');
    expect(completed.state).toBe('completed');
  }, 15000);

  it('creates and retrieves artifacts', async () => {
    const conv = await conversationService.createConversation([
      { participantId: 'art-svc-user', participantType: 'user' as const },
      { participantId: 'system-agent', participantType: 'agent' as const },
    ]);
    cleanupIds.push(conv.id);
    const task = await taskService.createTask(conv.id);

    const artifact = await taskService.createArtifact(task.id, {
      name: 'opportunity-card',
      parts: [{ data: { opportunityId: 'opp-1', score: 0.85 }, media_type: 'application/json' }],
    });
    expect(artifact.name).toBe('opportunity-card');

    const artifacts = await taskService.getArtifacts(task.id, conv.id);
    expect(artifacts).toHaveLength(1);
  }, 15000);

  it('groups and filters negotiation threads by their newest segment', async () => {
    const run = crypto.randomUUID();
    const userId = `thread-owner-${run}`;
    const counterpartyId = `thread-counterparty-${run}`;
    const conv = await conversationService.createConversation([
      { participantId: `agent:${userId}`, participantType: 'agent' },
      { participantId: `agent:${counterpartyId}`, participantType: 'agent' },
    ]);
    cleanupIds.push(conv.id);

    const opportunityId = crypto.randomUUID();
    const originalTaskId = crypto.randomUUID();
    const currentTaskId = crypto.randomUUID();
    const fallbackTaskId = opportunityId;
    const metadata = {
      type: 'negotiation',
      sourceUserId: userId,
      candidateUserId: counterpartyId,
    };

    await db.insert(tasks).values([
      {
        id: originalTaskId,
        conversationId: conv.id,
        state: 'completed',
        metadata: { ...metadata, opportunityId },
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T01:00:00.000Z'),
      },
      {
        id: currentTaskId,
        conversationId: conv.id,
        state: 'completed',
        metadata: { ...metadata, opportunityId, isContinuation: true },
        createdAt: new Date('2026-01-03T00:00:00.000Z'),
        updatedAt: new Date('2026-01-03T01:00:00.000Z'),
      },
      {
        id: fallbackTaskId,
        conversationId: conv.id,
        state: 'working',
        metadata,
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T01:00:00.000Z'),
      },
    ]);
    await db.insert(artifacts).values([
      {
        taskId: originalTaskId,
        name: 'negotiation-outcome',
        parts: [{ kind: 'data', data: { hasOpportunity: false } }],
      },
      {
        taskId: currentTaskId,
        name: 'negotiation-outcome',
        parts: [{ kind: 'data', data: { hasOpportunity: true } }],
      },
    ]);

    const threads = await taskService.getNegotiationThreadsByUser(userId, { limit: 10 });
    expect(threads).toHaveLength(2);
    expect(threads[0].current.id).toBe(currentTaskId);
    expect(threads[0].segmentRows.map((row) => row.id)).toEqual([currentTaskId, originalTaskId]);
    expect(threads[1].current.id).toBe(fallbackTaskId);
    expect(threads[1].segmentRows).toHaveLength(1);

    const successful = await taskService.getNegotiationThreadsByUser(userId, {
      result: 'has_opportunity',
    });
    expect(successful.map((thread) => thread.current.id)).toEqual([currentTaskId]);

    const inProgress = await taskService.getNegotiationThreadsByUser(userId, {
      result: 'in_progress',
    });
    expect(inProgress.map((thread) => thread.current.id)).toEqual([fallbackTaskId]);
  }, 15000);
});

describe('task authorization', () => {
  it('should reject getTask when task does not belong to conversation', async () => {
    const conv1 = await conversationService.createConversation([
      { participantId: 'task-auth-user', participantType: 'user' },
    ]);
    cleanupIds.push(conv1.id);
    const task = await taskService.createTask(conv1.id);

    await expect(
      taskService.getTask(task.id, 'wrong-conversation-id')
    ).rejects.toThrow(/does not belong/i);
  }, 15000);

  it('should return task when it belongs to conversation', async () => {
    const conv = await conversationService.createConversation([
      { participantId: 'task-auth-user', participantType: 'user' },
    ]);
    cleanupIds.push(conv.id);
    const task = await taskService.createTask(conv.id);

    const fetched = await taskService.getTask(task.id, conv.id);
    expect(fetched?.id).toBe(task.id);
  }, 15000);

  it('should reject getArtifacts when task does not belong to conversation', async () => {
    const conv = await conversationService.createConversation([
      { participantId: 'task-auth-user', participantType: 'user' },
    ]);
    cleanupIds.push(conv.id);
    const task = await taskService.createTask(conv.id);

    await expect(
      taskService.getArtifacts(task.id, 'wrong-conversation-id')
    ).rejects.toThrow(/does not belong/i);
  }, 15000);
});
