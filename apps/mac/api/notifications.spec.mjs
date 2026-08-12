import { describe, expect, it } from 'bun:test';

import {
  MAX_NOTIFIED_ENTITIES,
  composeNotification,
  isOwnMessage,
  notificationEntityKey,
  notificationEventAllowed,
  reconcileNotificationSnapshot,
  rememberNotificationEntity,
  snapshotNotificationEvents,
} from './notifications.mjs';

function messageFrom(senderId, overrides = {}) {
  return {
    type: 'message',
    conversationId: 'conversation-1',
    message: {
      id: 'message-1',
      senderId,
      senderName: 'Casey',
      parts: [{ type: 'text', text: 'Hello from Index.' }],
      ...overrides,
    },
  };
}

describe('mac desktop notification helpers', () => {
  it('shares one durable entity key across realtime and snapshot variants', () => {
    expect(notificationEntityKey({ type: 'question.attention', questionId: 'q1' })).toBe('question:q1');
    expect(notificationEntityKey({ type: 'question.new', id: 'q1' })).toBe('question:q1');
    expect(notificationEntityKey({ type: 'opportunity.new', id: 'o1' })).toBe('opportunity:o1');
    expect(notificationEntityKey({ type: 'opportunity.actionable', opportunityId: 'o1' })).toBe('opportunity:o1');
    expect(notificationEntityKey(messageFrom('user-2'))).toBe('message:message-1');
    expect(notificationEntityKey({ type: 'connected' })).toBeNull();
  });

  it('fails closed on own-message detection until identity is known', () => {
    expect(isOwnMessage(messageFrom('user-1'), 'user-1')).toBe(true);
    expect(isOwnMessage(messageFrom('agent:user-1'), 'user-1')).toBe(true);
    expect(isOwnMessage(messageFrom('user-2'), 'user-1')).toBe(false);
    expect(isOwnMessage(messageFrom('user-2'), '')).toBe(true);
    expect(isOwnMessage(messageFrom('user-2'), null)).toBe(true);
    expect(isOwnMessage({ type: 'message' }, 'user-1')).toBe(true);
  });

  it('gates events on the settings-pane preferences and fails open without them', () => {
    expect(notificationEventAllowed({ type: 'question.new' }, null)).toBe(true);
    expect(notificationEventAllowed({ type: 'question.new' }, { question: false })).toBe(false);
    expect(notificationEventAllowed({ type: 'opportunity.new' }, { alignment: false })).toBe(false);
    expect(notificationEventAllowed({ type: 'opportunity.new' }, { question: false })).toBe(true);
    expect(notificationEventAllowed(messageFrom('user-2'), { messages: false })).toBe(false);
    expect(notificationEventAllowed(messageFrom('user-2'), { alignment: false })).toBe(true);
    // Non-notification frames fail open here; compose is what filters them out.
    expect(notificationEventAllowed({ type: 'connected' }, {})).toBe(true);
    expect(notificationEventAllowed(null, {})).toBe(false);
  });

  it('composes question and opportunity copy with index:// activate links', () => {
    expect(composeNotification({ type: 'question.new', id: 'q1', title: 'A question', body: 'Can you clarify?' }))
      .toEqual({ title: 'A question', body: 'Can you clarify?', url: 'index://q/q1' });
    expect(composeNotification({ type: 'opportunity.new', id: 'o1', title: 'An alignment', body: 'Meet Casey.' }))
      .toEqual({ title: 'An alignment', body: 'Meet Casey.', url: 'index://o/o1' });
    expect(composeNotification({ type: 'question.new', id: 'q1', title: '' })).toBeNull();
    expect(composeNotification({ type: 'connected' })).toBeNull();
  });

  it('composes message copy with a chat activate link and safe fallbacks', () => {
    expect(composeNotification(messageFrom('user-2'))).toEqual({
      title: 'New message from Casey',
      body: 'Hello from Index.',
      url: 'index://chat/conversation-1',
    });
    // Protocol often persists typeless `{ text }` parts; accept those for OS copy.
    expect(composeNotification(messageFrom('user-2', { parts: [{ text: 'Haha' }] })).body).toBe('Haha');
    expect(composeNotification(messageFrom('user-2', { senderName: '', parts: [] }))).toEqual({
      title: 'New message from user-2',
      body: 'Open Index to read the message.',
      url: 'index://chat/conversation-1',
    });
  });

  it('resolves the sender avatar into imageUrl through the provided resolver', () => {
    const resolver = (avatar) => `https://api.example/storage/${avatar}`;
    expect(composeNotification(
      messageFrom('user-2', { senderAvatar: 'avatars/u2/a.jpg' }),
      { avatarUrl: resolver },
    ).imageUrl).toBe('https://api.example/storage/avatars/u2/a.jpg');
    // Without a resolver only absolute URLs pass through; bare keys are dropped.
    expect(composeNotification(messageFrom('user-2', { senderAvatar: 'https://pic.example/a.jpg' })).imageUrl)
      .toBe('https://pic.example/a.jpg');
    expect(composeNotification(messageFrom('user-2', { senderAvatar: 'avatars/u2/a.jpg' })).imageUrl)
      .toBeUndefined();
    expect(composeNotification(messageFrom('user-2')).imageUrl).toBeUndefined();
  });

  it('remembers entities with a bounded window', () => {
    const first = rememberNotificationEntity([], 'question:q1');
    expect(first).toEqual({ notifiedEntities: ['question:q1'], isNew: true });
    expect(rememberNotificationEntity(first.notifiedEntities, 'question:q1').isNew).toBe(false);
    expect(rememberNotificationEntity(first.notifiedEntities, null).isNew).toBe(false);
    const overflow = Array.from({ length: MAX_NOTIFIED_ENTITIES }, (_, i) => `question:q${i}`);
    const bounded = rememberNotificationEntity(overflow, 'question:new');
    expect(bounded.notifiedEntities.length).toBe(MAX_NOTIFIED_ENTITIES);
    expect(bounded.notifiedEntities[bounded.notifiedEntities.length - 1]).toBe('question:new');
  });

  it('keeps snapshots to persisted question/opportunity events only', () => {
    const events = [
      { type: 'question.new', id: 'q1', title: 'Question 1', body: 'Body 1' },
      { type: 'opportunity.new', id: 'o1', title: 'Opportunity 1', body: 'Body 2' },
      messageFrom('user-2'),
      { type: 'question.new', id: 'q2', title: '' },
      { type: 'connected' },
    ];
    expect(snapshotNotificationEvents({ events }).map((e) => e.type))
      .toEqual(['question.new', 'opportunity.new']);
    expect(snapshotNotificationEvents({})).toBeNull();
    expect(snapshotNotificationEvents(null)).toBeNull();
  });

  it('primes the first snapshot silently and toasts only later arrivals', () => {
    const q1 = { type: 'question.new', id: 'q1', title: 'Question 1', body: 'Body 1' };
    const q2 = { type: 'question.new', id: 'q2', title: 'Question 2', body: 'Body 2' };
    const first = reconcileNotificationSnapshot({ events: [q1] }, null);
    expect(first.state.hasSnapshot).toBe(true);
    expect(first.notifications).toEqual([]);
    const second = reconcileNotificationSnapshot({ events: [q1, q2] }, first.state);
    expect(second.notifications).toEqual([q2]);
    // An invalid payload leaves the state untouched.
    const third = reconcileNotificationSnapshot(null, second.state);
    expect(third.state).toBe(second.state);
    expect(third.notifications).toEqual([]);
  });
});
