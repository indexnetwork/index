/**
 * Desktop plugin TAIL fragment — concatenated by build.mjs after the shared
 * dashboard bundle. Registers the page route, sidebar nav, and palette
 * command, injects the shared stylesheet, and lazily fetches the decorative
 * image assets through the plugin backend (base64 → blob URLs), since the
 * desktop app cannot address the gateway's static files by URL.
 */
delete window.__INDEX_NETWORK_DESKTOP_ENV__

const PLUGIN_CSS = __PLUGIN_CSS__

// Dark and light file per role — must match ASSET_FILES in dashboard/dist/index.js,
// which resolves these keys, and the allow-list in dashboard/plugin_api.py.
const ASSET_FILES = {
  'pitch-dark': 'loading-white.webp',
  'pitch-light': 'loading-black.webp',
  'radar-dark': 'eye-white.webp',
  'radar-light': 'eye-black.webp',
  'loading-dark': 'loading2-white.webp',
  'loading-light': 'loading2.png'
}

let assetsPromise = null

function blobUrlFromBase64(b64, mime) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }))
}

function ensureAssets() {
  if (!assetsPromise) {
    assetsPromise = Promise.all(Object.keys(ASSET_FILES).map(function (key) {
      return restCall('/assets/' + ASSET_FILES[key], { method: 'GET' })
        .then(function (payload) {
          if (payload && payload.success !== false && payload.data) {
            DESKTOP_ENV.assets[key] = blobUrlFromBase64(payload.data, payload.mime)
          }
        })
        .catch(function () { /* decorative — the UI renders without them */ })
    }))
  }
  return assetsPromise
}

// Native OS alerts use only the authenticated Hermes SDK doors. Question and
// opportunity sockets share canonical persisted dedupe with the 60-second
// snapshot fallback; messages remain realtime-only and fail closed until the
// current user's identity is known.
function socketEventPayload(value) {
  const data = value && Object.prototype.hasOwnProperty.call(value, 'data') ? value.data : value
  if (typeof data !== 'string') return data
  try { return JSON.parse(data) } catch (e) { return null }
}

function disposeDesktopSocket(socket) {
  try {
    if (typeof socket === 'function') socket()
    else if (socket && typeof socket.dispose === 'function') socket.dispose()
    else if (socket && typeof socket.close === 'function') socket.close()
  } catch (e) { /* best-effort plugin disposal */ }
}

function persistNotifiedEntities(ctx, state) {
  ctx.storage.set(NOTIFIED_ENTITIES_KEY, state.notifiedEntities)
}

function sendOsNotification(ctx, event) {
  if (!ctx.os || typeof ctx.os.notify !== 'function') return
  const copy = composeNotification(event)
  if (!copy) return
  try {
    Promise.resolve(ctx.os.notify(copy)).catch(function () { /* notification rendering is fail-open */ })
  } catch (e) { /* synchronous host errors are fail-open too */ }
}

function notifyRealtimeEvent(ctx, state, rawEvent, suppressOwnMessage) {
  const event = socketEventPayload(rawEvent)
  if (!event || event.type === 'connected') return
  if (suppressOwnMessage && isOwnMessage(event, state.currentUserId)) return
  if (!composeNotification(event)) return
  const remembered = rememberNotificationEntity(state.notifiedEntities, notificationEntityKey(event))
  if (!remembered.isNew) return
  state.notifiedEntities = remembered.notifiedEntities
  persistNotifiedEntities(ctx, state)
  sendOsNotification(ctx, event)
}

function refreshDesktopIdentity(ctx, state) {
  return Promise.resolve()
    .then(function () { return ctx.rest('/auth/status', { method: 'GET' }) })
    .then(function (payload) {
      const user = payload && payload.authenticated && payload.user
      state.currentUserId = user && typeof user.id === 'string' && user.id ? user.id : null
    })
    .catch(function () { /* unknown identity intentionally keeps message alerts suppressed */ })
}

function reconcileDesktopSnapshot(ctx, state) {
  if (state.reconciling) return
  state.reconciling = true
  refreshDesktopIdentity(ctx, state)
    .then(function () { return ctx.rest('/notifications/snapshot', { method: 'GET' }) })
    .then(function (payload) {
      const result = reconcileNotificationSnapshot(payload, {
        hasSnapshot: state.hasSnapshot,
        notifiedEntities: state.notifiedEntities,
      })
      state.hasSnapshot = result.state.hasSnapshot
      state.notifiedEntities = result.state.notifiedEntities
      persistNotifiedEntities(ctx, state)
      // reconcileNotificationSnapshot already remembered each delta entity;
      // rendering (including rejection) must not mutate dedupe a second time.
      for (let index = 0; index < result.notifications.length; index += 1) {
        sendOsNotification(ctx, result.notifications[index])
      }
    })
    .catch(function () { /* the next 60-second reconciliation retries */ })
    .then(function () { state.reconciling = false })
}

function startDesktopNotifications(ctx) {
  const stored = ctx.storage.get(NOTIFIED_ENTITIES_KEY, [])
  const state = {
    currentUserId: null,
    hasSnapshot: false,
    notifiedEntities: Array.isArray(stored) ? stored.slice(-MAX_NOTIFIED_ENTITIES) : [],
    reconciling: false,
  }
  let notificationSocket = null
  let conversationSocket = null

  if (typeof ctx.socket === 'function') {
    try {
      notificationSocket = ctx.socket('/notifications/socket', function (event) {
        notifyRealtimeEvent(ctx, state, event, false)
      })
    } catch (e) { /* snapshot reconciliation remains available */ }
    try {
      conversationSocket = ctx.socket('/conversations/socket', function (event) {
        notifyRealtimeEvent(ctx, state, event, true)
      })
    } catch (e) { /* messages intentionally have no catch-up path */ }
  }

  reconcileDesktopSnapshot(ctx, state)
  const snapshotTimer = window.setInterval(function () {
    reconcileDesktopSnapshot(ctx, state)
  }, 60000)

  return function dispose() {
    window.clearInterval(snapshotTimer)
    disposeDesktopSocket(notificationSocket)
    disposeDesktopSocket(conversationSocket)
  }
}

function DesktopPage() {
  const tick = React.useState(0)
  React.useEffect(function () {
    let alive = true
    ensureAssets().then(function () {
      if (alive) tick[1](function (n) { return n + 1 })
    })
    return function () { alive = false }
  }, [])
  if (!DashboardComponent) return null
  return React.createElement('div', { className: 'index-network-desktop-page' },
    React.createElement(DashboardComponent))
}

export default {
  id: 'index-network',
  name: 'Index Network',
  register: function (ctx) {
    restCall = function (path, opts) { return ctx.rest(path, opts) }

    const style = document.createElement('style')
    style.dataset.plugin = 'index-network'
    style.textContent = PLUGIN_CSS
    document.head.appendChild(style)
    ctx.onDispose(function () { style.remove() })

    const stopNotifications = startDesktopNotifications(ctx)
    ctx.onDispose(stopNotifications)

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        title: 'Index',
        data: { path: '/index-network' },
        render: function () { return React.createElement(DesktopPage) }
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        data: { path: '/index-network', label: 'Index', codicon: 'sparkle' }
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'index-network.open',
          label: 'Open Index Network',
          keywords: ['index', 'network', 'intents', 'opportunities', 'onboarding', 'getting started', 'profile'],
          run: function () { host.navigate('/index-network') }
        }
      }
    ])
  }
}
