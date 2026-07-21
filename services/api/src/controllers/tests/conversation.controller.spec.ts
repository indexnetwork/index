import { describe, expect, test } from 'bun:test';

import type { AuthenticatedUser } from '../../guards/auth.guard';
import { ConversationController } from '../conversation.controller';
import { ConversationService } from '../../services/conversation.service';
import { TaskService } from '../../services/task.service';

describe('ConversationController mark-read endpoint', () => {
  const user = { id: 'viewer-1' } as AuthenticatedUser;
  const request = new Request('http://localhost/api/conversations/conv-1/read', { method: 'POST' });

  test('marks the resolved conversation read for the caller', async () => {
    let marked: { userId: string; conversationId: string } | undefined;
    const service = {
      resolveId: async () => ({ id: 'conv-1' }),
      markConversationRead: async (userId: string, conversationId: string) => {
        marked = { userId, conversationId };
      },
    } as unknown as ConversationService;
    const controller = new ConversationController(service, {} as TaskService);

    const response = await controller.markConversationRead(request, user, { id: 'conv-1' });

    expect(response.status).toBe(200);
    expect(marked).toEqual({ userId: 'viewer-1', conversationId: 'conv-1' });
  });

  test('returns 404 when the conversation cannot be resolved', async () => {
    const service = {
      resolveId: async () => ({ error: 'Conversation not found', status: 404 }),
    } as unknown as ConversationService;
    const controller = new ConversationController(service, {} as TaskService);

    const response = await controller.markConversationRead(request, user, { id: 'missing' });

    expect(response.status).toBe(404);
  });

  test('returns 403 when the caller is not a participant', async () => {
    const service = {
      resolveId: async () => ({ id: 'conv-1' }),
      markConversationRead: async () => {
        throw new Error('Forbidden: not a participant in this conversation');
      },
    } as unknown as ConversationService;
    const controller = new ConversationController(service, {} as TaskService);

    const response = await controller.markConversationRead(request, user, { id: 'conv-1' });

    expect(response.status).toBe(403);
  });
});
