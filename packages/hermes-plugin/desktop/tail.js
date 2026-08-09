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

// Native OS alerts for newly actionable opportunities, via the ctx.os door
// (hermes-agent#78685). Fires only while the user is away from Hermes and is
// gated by Settings ▸ Notifications ▸ "Plugin notifications"; on older desktop
// shells without ctx.os it silently no-ops.
const SEEN_OPPORTUNITIES_KEY = 'notifiedOpportunityIds'
const OPPORTUNITY_POLL_MS = 30 * 1000

function collectPendingOpportunities(data) {
  const lists = [(data.general && data.general.opportunities) || []]
  ;(data.intents || []).forEach(function (intent) { lists.push(intent.opportunities || []) })
  const pending = []
  lists.forEach(function (list) {
    list.forEach(function (item) {
      if (item.opportunityId && (item.status === 'pending' || item.status === 'latent')) pending.push(item)
    })
  })
  return pending
}

function checkOpportunities(ctx) {
  restCall('/summary', { method: 'GET' })
    .then(function (data) {
      if (!data || data.success === false) return
      const pending = collectPendingOpportunities(data)
      const seen = ctx.storage.get(SEEN_OPPORTUNITIES_KEY, null)
      const ids = pending.map(function (item) { return item.opportunityId })
      if (seen === null) {
        ctx.storage.set(SEEN_OPPORTUNITIES_KEY, ids) // first run — baseline silently
        return
      }
      const fresh = pending.filter(function (item) { return seen.indexOf(item.opportunityId) === -1 })
      if (!fresh.length) return
      ctx.storage.set(SEEN_OPPORTUNITIES_KEY, seen.concat(ids).filter(function (id, i, all) {
        return all.indexOf(id) === i
      }).slice(-200))
      if (!ctx.os || !ctx.os.notify) return
      ctx.os.notify({
        title: 'Index Network',
        body: fresh.length === 1
          ? 'New opportunity: ' + fresh[0].name
          : fresh.length + ' new opportunities are waiting'
      })
    })
    .catch(function () { /* backend not reachable — the next poll retries */ })
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

    const opportunityTimer = window.setInterval(function () { checkOpportunities(ctx) }, OPPORTUNITY_POLL_MS)
    checkOpportunities(ctx)
    ctx.onDispose(function () { window.clearInterval(opportunityTimer) })

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
