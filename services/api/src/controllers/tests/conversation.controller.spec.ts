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

describe('ConversationController session-history reads', () => {
  const user = { id: 'viewer-1' } as AuthenticatedUser;
  const latestMessage = {
    id: 'latest-message',
    conversationId: 'conv-1',
    sessionId: 'session-latest',
    senderId: 'viewer-1',
    role: 'user' as const,
    parts: [{ text: 'latest' }],
    createdAt: new Date('2026-07-22T12:00:00.000Z'),
  };
  const previousMessage = {
    id: 'previous-message',
    conversationId: 'conv-1',
    sessionId: 'session-previous',
    senderId: 'viewer-1',
    role: 'user' as const,
    parts: [{ text: 'previous' }],
    createdAt: new Date('2026-07-21T12:00:00.000Z'),
  };
  const latestMessageJson = { ...latestMessage, createdAt: latestMessage.createdAt.toISOString() };
  const previousMessageJson = { ...previousMessage, createdAt: previousMessage.createdAt.toISOString() };

  test('returns only the latest H2H session with a previous-session signal', async () => {
    let received: unknown;
    const service = {
      resolveId: async () => ({ id: 'conv-1' }),
      getSessionHistory: async (_conversationId: string, opts: unknown) => {
        received = opts;
        return {
          session: { id: 'session-latest' },
          messages: [latestMessage],
          hasPreviousSession: true,
        };
      },
    } as unknown as ConversationService;
    const controller = new ConversationController(service, {} as TaskService);

    const response = await controller.getMessages(
      new Request('http://localhost/api/conversations/conv-1/messages?sessionHistory=true'),
      user,
      { id: 'conv-1' },
    );

    expect(response.status).toBe(200);
    expect(received).toEqual({ userId: 'viewer-1', taskId: undefined, beforeSessionId: undefined });
    expect(await response.json()).toEqual({
      messages: [latestMessageJson],
      sessionId: 'session-latest',
      hasPreviousSession: true,
      previousSessionCursor: 'session-latest',
    });
  });

  test('returns exactly one previous session and fails closed for a forged cursor', async () => {
    const received: Array<{ userId: string; taskId?: string; beforeSessionId?: string }> = [];
    const service = {
      resolveId: async () => ({ id: 'conv-1' }),
      getSessionHistory: async (_conversationId: string, opts: { userId: string; taskId?: string; beforeSessionId?: string }) => {
        received.push(opts);
        if (opts.beforeSessionId === 'foreign-session') {
          return { session: null, messages: [], hasPreviousSession: false };
        }
        return {
          session: { id: 'session-previous' },
          messages: [previousMessage],
          hasPreviousSession: false,
        };
      },
    } as unknown as ConversationService;
    const controller = new ConversationController(service, {} as TaskService);

    const previous = await controller.getMessages(
      new Request('http://localhost/api/conversations/conv-1/messages?sessionHistory=true&beforeSessionId=session-latest'),
      user,
      { id: 'conv-1' },
    );
    const forged = await controller.getMessages(
      new Request('http://localhost/api/conversations/conv-1/messages?sessionHistory=true&beforeSessionId=foreign-session'),
      user,
      { id: 'conv-1' },
    );

    expect(received).toEqual([
      { userId: 'viewer-1', taskId: undefined, beforeSessionId: 'session-latest' },
      { userId: 'viewer-1', taskId: undefined, beforeSessionId: 'foreign-session' },
    ]);
    expect(await previous.json()).toMatchObject({
      messages: [previousMessageJson],
      sessionId: 'session-previous',
      hasPreviousSession: false,
    });
    expect(await forged.json()).toEqual({
      messages: [],
      sessionId: null,
      hasPreviousSession: false,
      previousSessionCursor: null,
    });
  });

  test('passes taskId through to the A2A task-session read', async () => {
    let received: unknown;
    const service = {
      resolveId: async () => ({ id: 'conv-1' }),
      getSessionHistory: async (_conversationId: string, opts: unknown) => {
        received = opts;
        return {
          session: { id: 'task-session', taskId: 'task-1' },
          messages: [latestMessage],
          hasPreviousSession: false,
        };
      },
    } as unknown as ConversationService;
    const controller = new ConversationController(service, {} as TaskService);

    const response = await controller.getMessages(
      new Request('http://localhost/api/conversations/conv-1/messages?sessionHistory=true&taskId=task-1'),
      user,
      { id: 'conv-1' },
    );

    expect(response.status).toBe(200);
    expect(received).toEqual({ userId: 'viewer-1', taskId: 'task-1', beforeSessionId: undefined });
    expect(await response.json()).toMatchObject({ sessionId: 'task-session', messages: [latestMessageJson] });
  });

  test('rejects non-participants for session-history reads', async () => {
    const service = {
      resolveId: async () => ({ id: 'conv-1' }),
      getSessionHistory: async () => {
        throw new Error('Forbidden: not a participant in this conversation');
      },
    } as unknown as ConversationService;
    const controller = new ConversationController(service, {} as TaskService);

    const response = await controller.getMessages(
      new Request('http://localhost/api/conversations/conv-1/messages?sessionHistory=true'),
      user,
      { id: 'conv-1' },
    );

    expect(response.status).toBe(403);
  });
});
