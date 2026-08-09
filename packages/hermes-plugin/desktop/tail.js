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

export default {
  id: 'index-network',
  name: 'Index Network',
  register: function (ctx) {
    console.info('[index-network] desktop plugin registered (dashboard component: ' + (DashboardComponent ? 'ok' : 'MISSING') + ')')
    restCall = function (path, opts) { return ctx.rest(path, opts) }

    const style = document.createElement('style')
    style.dataset.plugin = 'index-network'
    style.textContent = PLUGIN_CSS
    document.head.appendChild(style)
    ctx.onDispose(function () { style.remove() })

    // hermes://l/<code> and hermes://index/<id> — core Hermes only handles
    // kind=blueprint; we claim network joins, open this page, and show Join.
    if (window.hermesDesktop && typeof window.hermesDesktop.onDeepLink === 'function') {
      const offDeepLink = window.hermesDesktop.onDeepLink(function (payload) {
        if (!payload || !payload.name) return
        if (payload.kind === 'l') stashDesktopInvite(payload.name)
        else if (payload.kind === 'index') stashDesktopPublicJoin(payload.name)
        else return
        try { host.navigate('/index-network') } catch (e) { /* route not ready yet */ }
      })
      if (typeof offDeepLink === 'function') ctx.onDispose(offDeepLink)
    }

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
