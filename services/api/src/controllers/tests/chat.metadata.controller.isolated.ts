process.env.OPENROUTER_API_KEY = 'test-key';
process.env.NODE_ENV = 'test';

import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';

// The handler is fully service-spied; keep this narrow contract test hermetic.
mock.module('../../lib/drizzle/drizzle', () => ({ default: {}, db: {} }));

import type { ChatController as ChatControllerType } from '../chat.controller';
import type { AuthenticatedUser } from '../../guards/auth.guard';

const { ChatController } = await import('../chat.controller');
const { chatSessionService } = await import('../../services/chat.service');

const USER: AuthenticatedUser = {
  id: 'metadata-user-1',
  email: 'metadata@example.com',
  name: 'Metadata User',
};

describe('ChatController.updateMessageMetadata', () => {
  let controller: ChatControllerType;
  let saveMessageMetadataSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    controller = new ChatController();
    saveMessageMetadataSpy = spyOn(chatSessionService, 'saveMessageMetadata').mockResolvedValue();
  });

  afterEach(() => mock.restore());
  afterAll(() => mock.restore());

  test('accepts trace events without retired streaming drafts', async () => {
    const req = new Request('http://localhost/chat/message/message-1/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ traceEvents: [{ type: 'llm_start' }] }),
    });

    const response = await controller.updateMessageMetadata(req, USER, { id: 'message-1' });

    expect(response.status).toBe(200);
    expect(saveMessageMetadataSpy).toHaveBeenCalledWith({
      messageId: 'message-1',
      userId: USER.id,
      traceEvents: [{ type: 'llm_start' }],
    });
  });

  test('rejects retired streaming drafts without attempting a metadata write', async () => {
    const req = new Request('http://localhost/chat/message/message-1/metadata', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ streamingDrafts: [{ id: 'legacy-draft' }] }),
    });

    const response = await controller.updateMessageMetadata(req, USER, { id: 'message-1' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'streamingDrafts is no longer accepted' });
    expect(saveMessageMetadataSpy).not.toHaveBeenCalled();
  });
});
