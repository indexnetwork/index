/** Pure notification helpers imported by Node tests and inlined into Desktop. */
export const NOTIFIED_ENTITIES_KEY = 'notifiedEntitiesV2'
export const MAX_NOTIFIED_ENTITIES = 200

function notificationId(event, preferredField) {
  if (!event || typeof event !== 'object') return ''
  const value = event[preferredField] || event.id || ''
  return typeof value === 'string' ? value.trim() : ''
}

export function notificationEntityKey(event) {
  if (!event || typeof event.type !== 'string') return null
  if (event.type.indexOf('question.') === 0) {
    const id = notificationId(event, 'questionId')
    return id ? `question:${id}` : null
  }
  if (event.type.indexOf('opportunity.') === 0) {
    const id = notificationId(event, 'opportunityId')
    return id ? `opportunity:${id}` : null
  }
  if (event.type === 'message' || event.type.indexOf('message.') === 0) {
    const id = event.message && typeof event.message.id === 'string'
      ? event.message.id.trim()
      : notificationId(event, 'messageId')
    return id ? `message:${id}` : null
  }
  return null
}

export function isOwnMessage(event, currentUserId) {
  if (!currentUserId || !event || !event.message) return true
  const senderId = typeof event.message.senderId === 'string' ? event.message.senderId : ''
  return !senderId || senderId === currentUserId || senderId === `agent:${currentUserId}`
}

export function composeNotification(event) {
  if (!event || typeof event.type !== 'string') return null
  if (event.type.indexOf('question.') === 0 || event.type.indexOf('opportunity.') === 0) {
    if (typeof event.title !== 'string' || !event.title.trim()) return null
    return {
      title: event.title,
      body: typeof event.body === 'string' ? event.body : '',
    }
  }
  if (event.type === 'message' || event.type.indexOf('message.') === 0) {
    const message = event.message
    if (!message || typeof message !== 'object') return null
    const sender = String(message.senderName || message.senderId || 'Someone')
    let text = ''
    if (Array.isArray(message.parts)) {
      for (let index = 0; index < message.parts.length; index += 1) {
        const part = message.parts[index]
        if (part && part.type === 'text' && typeof part.text === 'string' && part.text) {
          text = part.text
          break
        }
      }
    }
    return {
      title: `New message from ${sender}`,
      body: text || 'Open Index to read the message.',
    }
  }
  return null
}

function normalizedNotifiedEntities(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry) => typeof entry === 'string' && entry)
    .slice(-MAX_NOTIFIED_ENTITIES)
}

export function rememberNotificationEntity(notifiedEntities, key) {
  const current = normalizedNotifiedEntities(notifiedEntities)
  if (!key || current.indexOf(key) !== -1) {
    return { notifiedEntities: current, isNew: false }
  }
  return {
    notifiedEntities: current.concat(key).slice(-MAX_NOTIFIED_ENTITIES),
    isNew: true,
  }
}

export function snapshotNotificationEvents(payload) {
  if (!payload || !Array.isArray(payload.events)) return null
  return payload.events.filter((event) => {
    if (!event || typeof event.type !== 'string') return false
    const persistedType = event.type.indexOf('question.') === 0 || event.type.indexOf('opportunity.') === 0
    return persistedType && notificationEntityKey(event) && composeNotification(event)
  })
}

export function reconcileNotificationSnapshot(payload, previousState) {
  const events = snapshotNotificationEvents(payload)
  const state = previousState || { hasSnapshot: false, notifiedEntities: [] }
  if (events === null) return { state, notifications: [] }

  let notifiedEntities = normalizedNotifiedEntities(state.notifiedEntities)
  const notifications = []
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]
    const remembered = rememberNotificationEntity(notifiedEntities, notificationEntityKey(event))
    notifiedEntities = remembered.notifiedEntities
    if (state.hasSnapshot && remembered.isNew) notifications.push(event)
  }

  return {
    state: { hasSnapshot: true, notifiedEntities },
    notifications,
  }
}
