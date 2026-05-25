import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, afterAll } from 'bun:test';
import { ConversationDatabaseAdapter } from '../database.adapter';

describe('ConversationDatabaseAdapter', () => {
  const adapter = new ConversationDatabaseAdapter();
  const createdIds: string[] = [];

  afterAll(async () => {
    for (const id of createdIds) {
      try { await adapter.deleteConversation(id); } catch {}
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
  });
});
