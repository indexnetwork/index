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

// Native OS alerts via Hermes ctx.os door (hermes-agent#78685). Events arrive on
// plugin SSE relays (notifications + conversations). Gated by Settings ▸ Plugin
// notifications; no-op without ctx.os.
const PLUGIN_STREAM_PREFIX = '/api/plugins/index-network'
const NOTIFIED_IDS_KEY = 'notifiedStreamIds'
const MAX_NOTIFIED_IDS = 200

function rememberNotified(ctx, key) {
  const seen = ctx.storage.get(NOTIFIED_IDS_KEY, []) || []
  if (seen.indexOf(key) !== -1) return false
  ctx.storage.set(NOTIFIED_IDS_KEY, seen.concat(key).slice(-MAX_NOTIFIED_IDS))
  return true
}

function composeNotification(event) {
  if (!event || !event.type) return null
  if (event.type === 'question.new' || event.type === 'opportunity.new') {
    if (!event.title) return null
    return { title: event.title, body: event.body || '' }
  }
  if (event.type === 'message') {
    const msg = event.message || {}
    const sender = (msg.senderName || 'Someone').toString()
    let text = ''
    if (Array.isArray(msg.parts)) {
      for (let i = 0; i < msg.parts.length; i++) {
        const part = msg.parts[i]
        // Accept typed text parts and bare { text } payloads from mobile/web.
        if (part && typeof part.text === 'string' && part.text.trim()) {
          text = part.text.trim()
          break
        }
      }
    }
    return { title: `New message from ${sender}`, body: text || 'Open Index to read the message.' }
  }
  return null
}

function notifyFromEvent(ctx, event) {
  if (!ctx.os || !ctx.os.notify) return
  const copy = composeNotification(event)
  if (!copy) return
  const entityId = event.id || (event.message && event.message.id) || ''
  if (entityId) {
    const dedupeKey = event.type + ':' + entityId
    if (!rememberNotified(ctx, dedupeKey)) return
  }
  ctx.os.notify(copy)
}

function authedPluginStreamFetch(path) {
  const rel = PLUGIN_STREAM_PREFIX + path
  const bridge = typeof window !== 'undefined' ? window.hermesDesktop : null
  if (bridge && bridge.getConnection) {
    return bridge.getConnection().then(function (conn) {
      if (!conn || !conn.baseUrl) throw new Error('gateway unavailable')
      const headers = { Accept: 'text/event-stream' }
      if (conn.authMode !== 'oauth' && conn.token) {
        headers['X-Hermes-Session-Token'] = conn.token
      }
      return window.fetch(conn.baseUrl.replace(/\/$/, '') + rel, {
        headers: headers,
        credentials: 'include',
      })
    })
  }
  return window.fetch(rel, { headers: { Accept: 'text/event-stream' }, credentials: 'include' })
}

function connectPluginStream(path, onEvent) {
  let stopped = false
  let reader = null
  let retryTimer = null
  let retries = 0

  function scheduleRetry() {
    if (stopped) return
    retries += 1
    if (retries > 10) return
    const delay = Math.min(5000 * Math.pow(2, retries - 1), 60000)
    retryTimer = window.setTimeout(connect, delay)
  }

  function connect() {
    authedPluginStreamFetch(path)
      .then(function (response) {
        if (!response || !response.ok || !response.body || !response.body.getReader) throw new Error('stream unavailable')
        retries = 0
        reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        function pump() {
          return reader.read().then(function (result) {
            if (stopped) { try { reader.cancel() } catch (e) { /* noop */ } return }
            if (result.done) { scheduleRetry(); return }
            buffer += decoder.decode(result.value, { stream: true })
            let sep
            while ((sep = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, sep)
              buffer = buffer.slice(sep + 2)
              const lines = frame.split('\n')
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].indexOf('data:') !== 0) continue
                const dataStr = lines[i].slice(5).trim()
                if (!dataStr) continue
                let data
                try { data = JSON.parse(dataStr) } catch (e) { continue }
                if (data && data.type !== 'connected') onEvent(data)
              }
            }
            return pump()
          })
        }
        return pump()
      })
      .catch(function () { if (!stopped) scheduleRetry() })
  }

  connect()
  return function dispose() {
    stopped = true
    if (retryTimer) window.clearTimeout(retryTimer)
    if (reader) { try { reader.cancel() } catch (e) { /* noop */ } }
  }
}

function startDesktopNotifications(ctx) {
  const stopNotifications = connectPluginStream('/notifications/stream', function (event) {
    notifyFromEvent(ctx, event)
  })
  const stopMessages = connectPluginStream('/conversations/stream', function (event) {
    notifyFromEvent(ctx, event)
  })
  return function dispose() {
    stopNotifications()
    stopMessages()
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
