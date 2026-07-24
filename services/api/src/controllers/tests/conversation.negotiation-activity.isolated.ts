import { describe, expect, it, mock } from 'bun:test';

import type { ConversationService } from '../../services/conversation.service';
import type { TaskService } from '../../services/task.service';

mock.module('../../guards/limiter.guard', () => ({ RateLimit: () => () => undefined }));
mock.module('../../guards/auth.guard', () => ({ AuthGuard: () => undefined }));
mock.module('../../services/conversation.service', () => ({ ConversationService: class {} }));
mock.module('../../services/task.service', () => ({ TaskService: class {} }));

const { ConversationController } = await import('../conversation.controller');

const INTENT_ID = '11111111-1111-4111-8111-111111111111';

describe('ConversationController negotiation activity', () => {
  it('returns 400 for an invalid UUID without calling the service', async () => {
    const read = mock(async () => []);
    const controller = new ConversationController(
      { getNegotiationActivityForIntent: read } as unknown as ConversationService,
      {} as TaskService,
    );
    const response = await controller.getNegotiationActivity(
      new Request('http://localhost/conversations/negotiations/activity?intentId=not-a-uuid'),
      { id: 'owner', email: null, name: 'Owner' },
    );
    expect(response.status).toBe(400);
    expect(read).not.toHaveBeenCalled();
  });

  it('returns 404 for a non-owned intent without exposing groups', async () => {
    const controller = new ConversationController(
      { getNegotiationActivityForIntent: mock(async () => null) } as unknown as ConversationService,
      {} as TaskService,
    );
    const response = await controller.getNegotiationActivity(
      new Request(`http://localhost/conversations/negotiations/activity?intentId=${INTENT_ID}`),
      { id: 'other', email: null, name: 'Other' },
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Intent not found' });
  });

  it('returns the exact owned groups response', async () => {
    const groups = [{ correspondentUserId: 'ada', correspondentLabel: "Ada's agent", correspondentAvatar: null, messages: [] }];
    const read = mock(async () => groups);
    const controller = new ConversationController(
      { getNegotiationActivityForIntent: read } as unknown as ConversationService,
      {} as TaskService,
    );
    const response = await controller.getNegotiationActivity(
      new Request(`http://localhost/conversations/negotiations/activity?intentId=${INTENT_ID}`),
      { id: 'owner', email: null, name: 'Owner' },
    );
    expect(response.status).toBe(200);
    expect(read).toHaveBeenCalledWith('owner', INTENT_ID);
    expect(await response.json()).toEqual({ groups });
  });
});
