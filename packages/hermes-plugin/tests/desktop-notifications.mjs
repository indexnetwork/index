import assert from 'node:assert/strict'

import {
  MAX_NOTIFIED_ENTITIES,
  NOTIFIED_ENTITIES_KEY,
  composeNotification,
  isOwnMessage,
  notificationEntityKey,
  reconcileDesktopNotificationState,
  reconcileNotificationSnapshot,
  refreshNotificationIdentity,
  rememberNotificationEntity,
  snapshotNotificationEvents,
} from '../desktop/notifications.mjs'

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
  }
}

// Realtime and catch-up variants share one durable entity key.
assert.equal(notificationEntityKey({ type: 'question.attention', questionId: 'q1' }), 'question:q1')
assert.equal(notificationEntityKey({ type: 'question.new', id: 'q1' }), 'question:q1')
assert.equal(notificationEntityKey({ type: 'question.new', questionId: 'q1' }), 'question:q1')
assert.equal(notificationEntityKey({ type: 'opportunity.actionable', opportunityId: 'o1' }), 'opportunity:o1')
assert.equal(notificationEntityKey({ type: 'opportunity.new', id: 'o1' }), 'opportunity:o1')
assert.equal(notificationEntityKey(messageFrom('user-2')), 'message:message-1')
assert.equal(notificationEntityKey({ type: 'connected' }), null)

// Unknown identity fails closed; both of the current user's sender forms are own.
assert.equal(isOwnMessage(messageFrom('user-1'), 'user-1'), true)
assert.equal(isOwnMessage(messageFrom('agent:user-1'), 'user-1'), true)
assert.equal(isOwnMessage(messageFrom('user-2'), 'user-1'), false)
assert.equal(isOwnMessage(messageFrom('user-2'), ''), true)
assert.equal(isOwnMessage(messageFrom('user-2'), null), true)
assert.equal(isOwnMessage({ type: 'message' }, 'user-1'), true)

// A failed or invalid refresh must replace a previously valid identity with
// unknown, keeping every message suppressed until identity resolves again.
let refreshedUserId = await refreshNotificationIdentity(async () => ({
  success: true,
  authenticated: true,
  user: { id: 'user-1' },
}))
assert.equal(refreshedUserId, 'user-1')
assert.equal(isOwnMessage(messageFrom('user-1'), refreshedUserId), true)

refreshedUserId = await refreshNotificationIdentity(async () => {
  throw new Error('auth unavailable')
})
assert.equal(refreshedUserId, null)
assert.equal(isOwnMessage(messageFrom('user-1'), refreshedUserId), true)
assert.equal(isOwnMessage(messageFrom('user-2'), refreshedUserId), true)

refreshedUserId = await refreshNotificationIdentity(async () => ({
  success: true,
  authenticated: true,
  user: { id: 'user-1' },
}))
assert.equal(refreshedUserId, 'user-1')
refreshedUserId = await refreshNotificationIdentity(async () => ({
  authenticated: true,
  user: { id: 'user-1' },
}))
assert.equal(refreshedUserId, null)
assert.equal(isOwnMessage(messageFrom('user-2'), refreshedUserId), true)

// Server-projected notification copy is retained; message copy has safe fallbacks.
assert.deepEqual(
  composeNotification({ type: 'question.new', id: 'q1', title: 'A question', body: 'Can you clarify?' }),
  { title: 'A question', body: 'Can you clarify?' },
)
assert.deepEqual(
  composeNotification(messageFrom('user-2')),
  { title: 'New message from Casey', body: 'Hello from Index.' },
)
assert.deepEqual(
  composeNotification(messageFrom('user-2', { senderName: '', parts: [] })),
  { title: 'New message from user-2', body: 'Open Index to read the message.' },
)
assert.equal(composeNotification({ type: 'question.new', id: 'q1', title: '' }), null)
assert.equal(composeNotification({ type: 'connected' }), null)

// Snapshot accepts only the persisted question/opportunity envelope; messages are realtime-only.
const snapshotEvents = [
  { type: 'question.new', id: 'q1', title: 'Question 1', body: 'Body 1' },
  { type: 'opportunity.new', id: 'o1', title: 'Opportunity 1', body: 'Body 1' },
  messageFrom('user-2'),
]
assert.deepEqual(snapshotNotificationEvents({ events: snapshotEvents }), snapshotEvents.slice(0, 2))
assert.equal(snapshotNotificationEvents({ success: false, error: 'offline' }), null)
assert.equal(snapshotNotificationEvents({ events: 'not-an-array' }), null)

const firstSnapshot = reconcileNotificationSnapshot(
  { events: snapshotEvents },
  { hasSnapshot: false, notifiedEntities: [] },
)
assert.deepEqual(firstSnapshot.notifications, [])
assert.equal(firstSnapshot.state.hasSnapshot, true)
assert.deepEqual(firstSnapshot.state.notifiedEntities, ['question:q1', 'opportunity:o1'])

const nextSnapshot = reconcileNotificationSnapshot(
  {
    events: [
      { type: 'question.attention', questionId: 'q1', title: 'Same question', body: 'Same entity' },
      { type: 'question.new', id: 'q2', title: 'Question 2', body: 'Body 2' },
      { type: 'opportunity.new', id: 'o2', title: 'Opportunity 2', body: 'Body 2' },
    ],
  },
  firstSnapshot.state,
)
assert.deepEqual(nextSnapshot.notifications.map(notificationEntityKey), ['question:q2', 'opportunity:o2'])
assert.deepEqual(
  reconcileNotificationSnapshot({ success: false }, nextSnapshot.state),
  { state: nextSnapshot.state, notifications: [] },
)
assert.deepEqual(
  reconcileNotificationSnapshot({ events: [] }, nextSnapshot.state).notifications,
  [],
)

// Dedupe storage is explicitly versioned, bounded, ordered, and duplicate-safe.
assert.equal(NOTIFIED_ENTITIES_KEY, 'notifiedEntitiesV2')
assert.equal(MAX_NOTIFIED_ENTITIES, 200)
const full = Array.from({ length: MAX_NOTIFIED_ENTITIES }, (_, index) => `question:q${index}`)
assert.deepEqual(rememberNotificationEntity(full, 'question:q100'), {
  notifiedEntities: full,
  isNew: false,
})
const appended = rememberNotificationEntity(full, 'opportunity:new')
assert.equal(appended.isNew, true)
assert.equal(appended.notifiedEntities.length, MAX_NOTIFIED_ENTITIES)
assert.equal(appended.notifiedEntities[0], 'question:q1')
assert.equal(appended.notifiedEntities.at(-1), 'opportunity:new')
assert.deepEqual(rememberNotificationEntity(null, null), {
  notifiedEntities: [],
  isNew: false,
})

// Disposal owns in-flight reconciliation: a snapshot that resolves afterward
// cannot persist dedupe state or emit a native notification.
let resolveSnapshot
let snapshotRequested
const snapshotRequestedPromise = new Promise((resolve) => { snapshotRequested = resolve })
const deferredSnapshot = new Promise((resolve) => { resolveSnapshot = resolve })
const storageWrites = []
const nativeNotifications = []
const disposedState = {
  currentUserId: null,
  hasSnapshot: true,
  notifiedEntities: [],
  reconciling: false,
  stopped: false,
}
const reconciliation = reconcileDesktopNotificationState({
  rest(path) {
    if (path === '/auth/status') {
      return Promise.resolve({ success: true, authenticated: true, user: { id: 'user-1' } })
    }
    assert.equal(path, '/notifications/snapshot')
    snapshotRequested()
    return deferredSnapshot
  },
  storage: {
    set(key, value) { storageWrites.push([key, value]) },
  },
}, disposedState, (event) => { nativeNotifications.push(event) })
await snapshotRequestedPromise
disposedState.stopped = true
resolveSnapshot({
  events: [{ type: 'question.new', id: 'q-after-dispose', title: 'Too late', body: 'Ignore me' }],
})
await reconciliation
assert.deepEqual(storageWrites, [])
assert.deepEqual(nativeNotifications, [])
assert.deepEqual(disposedState.notifiedEntities, [])

console.log('desktop notification helper tests passed')
