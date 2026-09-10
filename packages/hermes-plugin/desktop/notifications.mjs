/** Pure notification helpers imported by Node tests and inlined into Desktop. */
export const NOTIFIED_ENTITIES_KEY = 'notifiedEntitiesV2'
export const MAX_NOTIFIED_ENTITIES = 200

/** Sender id the API writes agent-DM messages under (services/api database.shared). */
const AGENT_SENDER_ID = 'system-agent'

function notificationId(event, preferredField) {
  if (!event || typeof event !== 'object') return ''
  const value = event[preferredField] || event.id || ''
  return typeof value === 'string' ? value.trim() : ''
}

export function notificationEntityKey(event) {
  if (!event || typeof event.type !== 'string') return null
  if (event.type.indexOf('opportunity.') === 0) {
    const id = notificationId(event, 'opportunityId')
    return id ? `opportunity:${id}` : null
  }
  if (event.type === 'question.pending') {
    const id = notificationId(event, 'questionId')
    return id ? `question:${id}` : null
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

export async function refreshNotificationIdentity(loadAuthStatus) {
  try {
    const payload = await loadAuthStatus()
    const user = payload && payload.success === true && payload.authenticated === true && payload.user
    const userId = user && typeof user.id === 'string' ? user.id.trim() : ''
    return userId || null
  } catch (error) {
    return null
  }
}

// Every Index event lands on the plugin's dashboard page; the host turns this
// into the notification's activate target so a click opens Index instead of
// just focusing the Hermes window. The query names what to focus once there —
// the dashboard reads it and opens that overlay over whatever was on screen.
const PLUGIN_ACTIVATE_URL = '/index-network'

function activateUrl(param, id) {
  return id
    ? `${PLUGIN_ACTIVATE_URL}?${param}=${encodeURIComponent(id)}`
    : PLUGIN_ACTIVATE_URL
}

export function composeNotification(event) {
  if (!event || typeof event.type !== 'string') return null
  if (event.type.indexOf('opportunity.') === 0) {
    if (typeof event.title !== 'string' || !event.title.trim()) return null
    return {
      title: event.title,
      body: typeof event.body === 'string' ? event.body : '',
      url: activateUrl('o', notificationId(event, 'opportunityId')),
    }
  }
  if (event.type === 'question.pending') {
    if (typeof event.title !== 'string' || !event.title.trim()) return null
    const intentId = event.data && typeof event.data.intentId === 'string'
      ? event.data.intentId.trim()
      : ''
    return {
      title: event.title,
      body: typeof event.body === 'string' ? event.body : '',
      url: activateUrl('intent', intentId),
    }
  }
  if (event.type === 'message' || event.type.indexOf('message.') === 0) {
    const message = event.message
    if (!message || typeof message !== 'object') return null
    // The owner's own agent speaks in the agent DM, and `question.pending`
    // already announces the only thing it says that needs answering.
    if (message.senderId === AGENT_SENDER_ID) return null
    const sender = String(message.senderName || message.senderId || 'Someone')
    let text = ''
    if (Array.isArray(message.parts)) {
      for (let index = 0; index < message.parts.length; index += 1) {
        const part = message.parts[index]
        if (!part || typeof part.text !== 'string' || !part.text) continue
        // Prefer typed text parts; fall back to typeless `{ text }` (common on the wire).
        if (part.type === 'text' || part.type == null || part.type === '') {
          text = part.text
          break
        }
      }
    }
    // Shape parity with the Mac shell's compose: expose the sender avatar when
    // it is already a fetchable URL. (Electron's `icon` wants a filesystem
    // path, so the Hermes host does not consume this today.)
    const avatar = typeof message.senderAvatar === 'string' ? message.senderAvatar.trim() : ''
    const conversationId = typeof event.conversationId === 'string' ? event.conversationId.trim() : ''
    return {
      title: sender,
      body: text || 'Open Index to read the message.',
      url: activateUrl('chat', conversationId),
      ...(/^https?:/i.test(avatar) ? { imageUrl: avatar } : {}),
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