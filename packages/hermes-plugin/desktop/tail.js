/**
 * Desktop plugin TAIL fragment — concatenated by build.mjs after the shared
 * dashboard bundle. Registers the page route, sidebar nav, and palette
 * command, injects the shared stylesheet, and lazily fetches the decorative
 * image assets through the plugin backend as data URLs, since the
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
  return "data:" + (mime || "application/octet-stream") + ";base64," + b64
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

// Native OS alerts use only the authenticated Hermes SDK doors. One socket
// carries the user's whole event stream: every frame is realtime-only, deduped
// by entity key, and messages fail closed until the identity is known.
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
  // `activate` makes a click open the Index page instead of only focusing the
  // Hermes window; hosts without activate support ignore the extra field.
  const payload = {
    title: copy.title,
    body: copy.body,
    ...(copy.url ? { activate: copy.url } : {})
  }
  try {
    Promise.resolve(ctx.os.notify(payload)).catch(function () { /* notification rendering is fail-open */ })
  } catch (e) { /* synchronous host errors are fail-open too */ }
}

function notifyRealtimeEvent(ctx, state, rawEvent) {
  if (state.stopped) return
  const event = socketEventPayload(rawEvent)
  if (!event || event.type === 'connected') return
  // Own-send suppression is a message question: notification frames have no
  // sender, and isOwnMessage fails closed on anything without `message`.
  if (event.message && isOwnMessage(event, state.currentUserId)) return
  if (!composeNotification(event)) return
  const remembered = rememberNotificationEntity(state.notifiedEntities, notificationEntityKey(event))
  if (!remembered.isNew) return
  state.notifiedEntities = remembered.notifiedEntities
  persistNotifiedEntities(ctx, state)
  sendOsNotification(ctx, event)
}

// Own-send suppression fails closed until the identity is known, and the user
// can sign in after the plugin registers, so keep re-reading it.
function refreshDesktopIdentity(ctx, state) {
  refreshNotificationIdentity(function () {
    return ctx.rest('/auth/status', { method: 'GET' })
  }).then(function (userId) {
    if (!state.stopped) state.currentUserId = userId
  })
}

function startDesktopNotifications(ctx) {
  const stored = ctx.storage.get(NOTIFIED_ENTITIES_KEY, [])
  const state = {
    currentUserId: null,
    notifiedEntities: Array.isArray(stored) ? stored.slice(-MAX_NOTIFIED_ENTITIES) : [],
    stopped: false,
  }
  let eventSocket = null

  if (typeof ctx.socket === 'function') {
    try {
      eventSocket = ctx.socket('/conversations/socket', function (event) {
        notifyRealtimeEvent(ctx, state, event)
      })
    } catch (e) { /* hosts without socket support get no OS alerts */ }
  }

  refreshDesktopIdentity(ctx, state)
  const identityTimer = window.setInterval(function () {
    refreshDesktopIdentity(ctx, state)
  }, 60000)

  return function dispose() {
    state.stopped = true
    window.clearInterval(identityTimer)
    disposeDesktopSocket(eventSocket)
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

const DISCOVER_PATH = '/index-network'
// Host stamps this on the contributed sidebar row (`sidebar-nav-${contribution.id}`).
const DISCOVER_NAV_TOUR = 'sidebar-nav-index-network:nav'

function discoverHash() {
  const path = ((window.location.hash || '').replace(/^#/, '')).split('?')[0]
  return path === DISCOVER_PATH || path.startsWith(DISCOVER_PATH + '/')
}

function workspaceIsShowing() {
  if (typeof host.paneVisibility !== 'function') return false
  try {
    const vis = host.paneVisibility('workspace')
    return Boolean(vis && vis.get && vis.get())
  } catch (e) {
    return false
  }
}

// Discover is a workspace-pane route. A focused session tile keeps that pane
// behind the tile, so hash navigation looks dead until restart. Front a
// dedicated tab only while workspace is covered; skip when it is already up.
function showDiscover(to) {
  if (to) host.navigate(to)
  else if (!discoverHash()) host.navigate(DISCOVER_PATH)
  if (workspaceIsShowing()) return
  if (typeof host.openWorkspace !== 'function') return
  try {
    host.openWorkspace('index-network', {
      title: 'Discover',
      render: function () { return React.createElement(DesktopPage) }
    })
  } catch (e) { /* older hosts without the door */ }
}

function onDiscoverHash() {
  if (discoverHash()) showDiscover()
}

function onDiscoverNavClick(event) {
  const node = event.target && event.target.closest && event.target.closest('[data-tour="' + DISCOVER_NAV_TOUR + '"]')
  if (node) showDiscover(DISCOVER_PATH)
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

    window.addEventListener('hashchange', onDiscoverHash)
    document.addEventListener('click', onDiscoverNavClick)
    ctx.onDispose(function () {
      window.removeEventListener('hashchange', onDiscoverHash)
      document.removeEventListener('click', onDiscoverNavClick)
    })
    onDiscoverHash()

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        title: 'Discover',
        data: { path: DISCOVER_PATH },
        render: function () { return React.createElement(DesktopPage) }
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        data: { path: DISCOVER_PATH, label: 'Discover', codicon: 'sparkle' }
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'index-network.open',
          label: 'Open Index Network',
          keywords: ['index', 'network', 'intents', 'opportunities', 'onboarding', 'getting started', 'profile'],
          run: function () { showDiscover(DISCOVER_PATH) }
        }
      }
    ])
  }
}
