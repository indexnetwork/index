/**
 * Desktop plugin HEAD fragment — concatenated by build.mjs ahead of the shared
 * dashboard bundle (dashboard/dist/index.js). Sets up the dashboard-SDK-shaped
 * environment the bundle reads from window.__INDEX_NETWORK_DESKTOP_ENV__:
 * the app's React singleton, a fetchJSON that forwards to the plugin's scoped
 * REST door (ctx.rest), and an onComponent sink that captures the dashboard
 * root component for the route registered in tail.js.
 */
import * as React from 'react'
import { host, PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA } from '@hermes/plugin-sdk'

const API_PREFIX = '/api/plugins/index-network'

// Wired to ctx.rest in register(); module-eval code can only queue against it.
let restCall = function () {
  return Promise.reject(new Error('index-network: plugin backend not connected yet'))
}
let DashboardComponent = null

// Dashboard-host fetchJSON shim: the bundle passes absolute API paths and
// fetch()-style options ({ method, headers, body: JSON string }); map them to
// the namespace-relative ctx.rest contract (body as a plain object).
function desktopFetchJSON(path, options) {
  const opts = options || {}
  const rel = path.indexOf(API_PREFIX) === 0 ? (path.slice(API_PREFIX.length) || '/') : path
  let body = opts.body
  if (typeof body === 'string') {
    try { body = JSON.parse(body) } catch (e) { body = undefined }
  }
  return restCall(rel, { method: opts.method || 'GET', body: body })
}

// SDK Button fallback: the desktop host ships no component kit, so without
// this the dashboard's buttons render as bare native <button>s. Map the SDK
// Button props (ghost/outlined/destructive/size/prefix) onto classes that
// theme-map.css styles from the app's --ui-* theme variables.
function DesktopButton(props) {
  const { ghost, outlined, destructive, size, prefix, className, children, ...rest } = props
  rest.className = [
    'idx-btn',
    ghost ? 'idx-btn--ghost' : outlined ? 'idx-btn--outlined' : 'idx-btn--solid',
    size === 'icon' ? 'idx-btn--icon' : '',
    destructive ? 'idx-btn--destructive' : '',
    className || '',
  ].filter(Boolean).join(' ')
  return React.createElement('button', rest, prefix || null, children)
}

const DESKTOP_ENV = {
  sdk: { React: React, components: { Button: DesktopButton }, fetchJSON: desktopFetchJSON },
  assets: {},
  onComponent: function (component) { DashboardComponent = component }
}

window.__INDEX_NETWORK_DESKTOP_ENV__ = DESKTOP_ENV;
