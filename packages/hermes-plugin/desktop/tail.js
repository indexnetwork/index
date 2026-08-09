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

function stashDesktopInvite(code) {
  const c = String(code || '').trim()
  if (!c) return
  try { window.sessionStorage.removeItem('index-public-join') } catch (e) { /* noop */ }
  try { window.sessionStorage.setItem('index-invite', c) } catch (e) { /* private mode */ }
  try {
    window.dispatchEvent(new CustomEvent('index-network-invite', { detail: { code: c } }))
  } catch (e) { /* noop */ }
}

function stashDesktopPublicJoin(networkId) {
  const id = String(networkId || '').trim()
  if (!id) return
  try { window.sessionStorage.removeItem('index-invite') } catch (e) { /* noop */ }
  try { window.sessionStorage.setItem('index-public-join', id) } catch (e) { /* private mode */ }
  try {
    window.dispatchEvent(new CustomEvent('index-network-public-join', { detail: { networkId: id } }))
  } catch (e) { /* noop */ }
}

function readJoinQueryFromHash() {
  const hash = String(window.location.hash || '')
  const q = hash.indexOf('?')
  if (q < 0) return { invite: null, join: null }
  let params
  try { params = new URLSearchParams(hash.slice(q + 1)) } catch (e) { return { invite: null, join: null } }
  return {
    invite: String(params.get('invite') || '').trim() || null,
    join: String(params.get('join') || '').trim() || null,
  }
}

function applyJoinQueryFromHash() {
  const q = readJoinQueryFromHash()
  if (q.invite) stashDesktopInvite(q.invite)
  if (q.join) stashDesktopPublicJoin(q.join)
}

function openIndexNetwork(query) {
  const q = query && (query.invite || query.join)
    ? ('?' + new URLSearchParams(
      query.invite ? { invite: query.invite } : { join: query.join }
    ).toString())
    : ''
  try { host.navigate('/index-network' + q) } catch (e) { /* route not ready yet */ }
}

function handleIndexDeepLink(payload) {
  if (!payload || !payload.name) return false
  const kind = String(payload.kind || '').toLowerCase()
  if (kind === 'l') {
    stashDesktopInvite(payload.name)
    openIndexNetwork({ invite: payload.name })
    return true
  }
  if (kind === 'index' || kind === 'index-network') {
    stashDesktopPublicJoin(payload.name)
    openIndexNetwork({ join: payload.name })
    return true
  }
  return false
}

let deepLinkOff = null
function attachDeepLinkListener() {
  if (deepLinkOff) return deepLinkOff
  if (!window.hermesDesktop || typeof window.hermesDesktop.onDeepLink !== 'function') return null
  const off = window.hermesDesktop.onDeepLink(function (payload) {
    handleIndexDeepLink(payload)
  })
  deepLinkOff = typeof off === 'function' ? off : function () { /* noop */ }
  try { void window.hermesDesktop.signalDeepLinkReady?.() } catch (e) { /* older shells */ }
  return deepLinkOff
}

function detachDeepLinkListener() {
  if (typeof deepLinkOff === 'function') {
    try { deepLinkOff() } catch (e) { /* noop */ }
  }
  deepLinkOff = null
}

attachDeepLinkListener()

function DesktopPage() {
  const tick = React.useState(0)
  React.useEffect(function () {
    let alive = true
    ensureAssets().then(function () {
      if (alive) tick[1](function (n) { return n + 1 })
    })
    return function () { alive = false }
  }, [])
  React.useEffect(function () {
    applyJoinQueryFromHash()
    function onHash() { applyJoinQueryFromHash() }
    window.addEventListener('hashchange', onHash)
    return function () { window.removeEventListener('hashchange', onHash) }
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

    attachDeepLinkListener()
    ctx.onDispose(detachDeepLinkListener)

    try {
      const join = window.sessionStorage.getItem('index-public-join')
      const invite = window.sessionStorage.getItem('index-invite')
      if (join || invite) openIndexNetwork(join ? { join: join } : { invite: invite })
    } catch (e) { /* private mode */ }

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
