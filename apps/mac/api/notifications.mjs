/**
 * Pure desktop-notification helpers for the macOS shell.
 *
 * Adapted from packages/hermes-plugin/desktop/notifications.mjs so both
 * desktop surfaces share one event vocabulary (opportunity.* persisted events
 * plus realtime conversation `message` events) and the same dedupe/snapshot
 * semantics. The Mac compose additionally returns an activate
 * `url` (an index:// deep link the Swift tap handler feeds back through the
 * normal deep-link pipeline) and, for messages, an `imageUrl` used as the
 * notification's sender-avatar attachment.
 *
 * Dependency-free ESM like the rest of api/; assemble.py strips `export` when
 * it inlines this file into the single-file bundle as window.IndexApi.
 */

export const NOTIFIED_ENTITIES_KEY = 'notifiedEntitiesV2';
export const MAX_NOTIFIED_ENTITIES = 200;

/**
 * @param {Object} event
 * @param {string} preferredField
 * @returns {string}
 */
function notificationId(event, preferredField) {
  if (!event || typeof event !== 'object') return '';
  const value = event[preferredField] || event.id || '';
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Durable dedupe key shared by realtime and snapshot variants of one entity.
 * @param {Object} event
 * @returns {string | null}
 */
export function notificationEntityKey(event) {
  if (!event || typeof event.type !== 'string') return null;
  if (event.type.indexOf('opportunity.') === 0) {
    const id = notificationId(event, 'opportunityId');
    return id ? `opportunity:${id}` : null;
  }
  if (event.type === 'message' || event.type.indexOf('message.') === 0) {
    const id = event.message && typeof event.message.id === 'string'
      ? event.message.id.trim()
      : notificationId(event, 'messageId');
    return id ? `message:${id}` : null;
  }
  return null;
}

/**
 * Fail closed: an unknown identity suppresses every message so a stale
 * auth state can never toast the user's own sends back at them.
 * @param {Object} event
 * @param {string | null} currentUserId
 * @returns {boolean}
 */
export function isOwnMessage(event, currentUserId) {
  if (!currentUserId || !event || !event.message) return true;
  const senderId = typeof event.message.senderId === 'string' ? event.message.senderId : '';
  return !senderId || senderId === currentUserId || senderId === `agent:${currentUserId}`;
}

/**
 * Gate an event on the user's notification preferences (settings pane).
 * `alignment` gates opportunity.*, `messages` gates conversation messages.
 * Absent prefs (or unknown types) fail open.
 * @param {Object} event
 * @param {{ alignment?: boolean, messages?: boolean } | null} prefs
 * @returns {boolean}
 */
export function notificationEventAllowed(event, prefs) {
  if (!event || typeof event.type !== 'string') return false;
  if (!prefs || typeof prefs !== 'object') return true;
  if (event.type.indexOf('opportunity.') === 0) return prefs.alignment !== false;
  if (event.type === 'message' || event.type.indexOf('message.') === 0) {
    return prefs.messages !== false;
  }
  return true;
}

/**
 * Compose the OS notification payload for a wire event, or null when the
 * event carries nothing worth toasting.
 *
 * @param {Object} event
 * @param {{ avatarUrl?: (avatar: string) => string | null }} [options]
 *   avatarUrl resolves a users.avatar value (S3 key or absolute URL) into a
 *   fetchable URL; without it the raw absolute value passes through and keys
 *   are dropped.
 * @returns {{ title: string, body: string, url?: string, imageUrl?: string } | null}
 */
export function composeNotification(event, options) {
  const opts = options || {};
  if (!event || typeof event.type !== 'string') return null;
  if (event.type.indexOf('opportunity.') === 0) {
    if (typeof event.title !== 'string' || !event.title.trim()) return null;
    const id = notificationId(event, 'opportunityId');
    return {
      title: event.title,
      body: typeof event.body === 'string' ? event.body : '',
      ...(id ? { url: `index://o/${encodeURIComponent(id)}` } : {}),
    };
  }
  if (event.type === 'message' || event.type.indexOf('message.') === 0) {
    const message = event.message;
    if (!message || typeof message !== 'object') return null;
    const sender = String(message.senderName || message.senderId || 'Someone');
    let text = '';
    if (Array.isArray(message.parts)) {
      for (let index = 0; index < message.parts.length; index += 1) {
        const part = message.parts[index];
        if (!part || typeof part.text !== 'string' || !part.text) continue;
        // Prefer typed text parts; fall back to typeless `{ text }` (common on the wire).
        if (part.type === 'text' || part.type == null || part.type === '') {
          text = part.text;
          break;
        }
      }
    }
    const conversationId = typeof event.conversationId === 'string' ? event.conversationId.trim() : '';
    const avatar = typeof message.senderAvatar === 'string' ? message.senderAvatar.trim() : '';
    const imageUrl = avatar
      ? (typeof opts.avatarUrl === 'function'
        ? opts.avatarUrl(avatar)
        : (/^https?:/i.test(avatar) ? avatar : null))
      : null;
    return {
      title: `New message from ${sender}`,
      body: text || 'Open Index to read the message.',
      ...(conversationId ? { url: `index://chat/${encodeURIComponent(conversationId)}` } : {}),
      ...(imageUrl ? { imageUrl } : {}),
    };
  }
  return null;
}

/**
 * @param {unknown} value
 * @returns {Array<string>}
 */
function normalizedNotifiedEntities(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === 'string' && entry)
    .slice(-MAX_NOTIFIED_ENTITIES);
}

/**
 * @param {Array<string>} notifiedEntities
 * @param {string | null} key
 * @returns {{ notifiedEntities: Array<string>, isNew: boolean }}
 */
export function rememberNotificationEntity(notifiedEntities, key) {
  const current = normalizedNotifiedEntities(notifiedEntities);
  if (!key || current.indexOf(key) !== -1) {
    return { notifiedEntities: current, isNew: false };
  }
  return {
    notifiedEntities: current.concat(key).slice(-MAX_NOTIFIED_ENTITIES),
    isNew: true,
  };
}

/**
 * Snapshot catch-up accepts only the persisted opportunity envelope; messages
 * are realtime-only and never replay from a snapshot.
 * @param {Object} payload
 * @returns {Array<Object> | null}
 */
export function snapshotNotificationEvents(payload) {
  if (!payload || !Array.isArray(payload.events)) return null;
  return payload.events.filter((event) => {
    if (!event || typeof event.type !== 'string') return false;
    return event.type.indexOf('opportunity.') === 0
      && notificationEntityKey(event)
      && composeNotification(event);
  });
}

/**
 * Fold a snapshot into the dedupe state. The first snapshot after launch
 * primes the seen-set without toasting (hasSnapshot=false), so a relaunch
 * never replays everything already pending; later snapshots toast only what
 * is genuinely new.
 * @param {Object} payload
 * @param {{ hasSnapshot: boolean, notifiedEntities: Array<string> } | null} previousState
 * @returns {{ state: { hasSnapshot: boolean, notifiedEntities: Array<string> }, notifications: Array<Object> }}
 */
export function reconcileNotificationSnapshot(payload, previousState) {
  const events = snapshotNotificationEvents(payload);
  const state = previousState || { hasSnapshot: false, notifiedEntities: [] };
  if (events === null) return { state, notifications: [] };

  let notifiedEntities = normalizedNotifiedEntities(state.notifiedEntities);
  const notifications = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const remembered = rememberNotificationEntity(notifiedEntities, notificationEntityKey(event));
    notifiedEntities = remembered.notifiedEntities;
    if (state.hasSnapshot && remembered.isNew) notifications.push(event);
  }

  return {
    state: { hasSnapshot: true, notifiedEntities },
    notifications,
  };
}
