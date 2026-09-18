// bridge.web.mjs — the /web route's backend bridge for the Workbench UI.
//
// apps/mac/src/ui/bridge.jsx is the same façade spoken to Swift: the page states
// a route and WKWebView attaches the Keychain credential. On the web there is no
// Swift, so the same window.IndexApp surface is built over fetch and the site's
// own JWT (lib/auth-client), and SSE runs on EventSource instead of the native
// stream. The screens are unchanged and cannot tell the difference — they only
// ever call window.IndexApp / window.IndexApi.
//
// Native-only entries are deliberately absent rather than stubbed: settings
// renders its harness, protocol-server and open-at-login sections only when the
// bridge offers them, so leaving them off is what hides them here.
//
// Installed at module evaluation because the screens read these globals as they
// mount; page.tsx imports this before the generated bundle.

import { marked } from "marked";

import { getJwtToken } from "@/lib/auth-client";

import loading2 from "./assets/img/loading2.gif?url";

import * as socials from "./api/socials.mjs";
import * as client from "./api/client.mjs";
import * as mappers from "./api/mappers.mjs";
import * as deeplink from "./api/deeplink.mjs";
import * as notifications from "./api/notifications.mjs";
import * as radarState from "./api/radar-state.mjs";
import * as markdown from "./api/markdown.mjs";

// assemble.py flattens these modules into one window.IndexApi for the mac
// bundle; here they stay real modules and the same object is composed from
// their exports.
window.IndexApi = {
  ...socials, ...client, ...mappers, ...deeplink,
  ...notifications, ...radarState, ...markdown,
};

// marked is a CDN global in the mac bundle (src/index.html), a dependency here.
window.marked = marked;

// match-feed draws the loader art; assemble.py inlines it as a data URI, Vite
// fingerprints it.
window.IndexAssets = { loading2 };

// Stands in for the values Swift injects at document start. `authenticated` is
// kept in step with the site session by setAuthenticated() below — the page
// never holds credential material either way, it asks auth-client for a token
// per request.
window.INDEX_NATIVE = window.INDEX_NATIVE || {
  apiBaseUrl: `${import.meta.env.VITE_PROTOCOL_URL || ""}/api`,
  appUrl: window.location.origin,
  authenticated: false,
  notifyPrefs: null,
};

window.IndexApp = (function () {
  function native() { return window.INDEX_NATIVE || {}; }
  function isAuthed() { return native().authenticated === true; }

  function apiBaseUrl() {
    return window.IndexApi.normalizeApiBaseUrl(native().apiBaseUrl || "/api");
  }

  // users.avatar is either a full URL (legacy Google/OAuth photos) or an S3
  // object key like "avatars/<userId>/<uuid>.jpg", served by the API at
  // {base}/storage/<key>.
  function avatarUrl(avatar) {
    if (!avatar) return null;
    if (/^(https?:|data:)/i.test(avatar)) return avatar;
    return `${apiBaseUrl()}/storage/${String(avatar).replace(/^\/+/, "")}`;
  }

  // Bearer token per request, cached and refreshed by auth-client. A signed-out
  // session throws there; the screens gate on isAuthed() before they get here,
  // so an unauthenticated straggler is answered with no header (and a 401)
  // rather than an unhandled rejection.
  async function getToken() {
    try { return await getJwtToken(); } catch (e) { return null; }
  }

  function getClient() {
    return window.IndexApi.createIndexApiClient({ apiBaseUrl: apiBaseUrl(), getToken });
  }

  // ---- auth ---------------------------------------------------------------

  // Sign-in is the site's own modal, not a browser handshake: page.tsx hands
  // the AuthContext callbacks down here, and mirrors the resulting session
  // state onto INDEX_NATIVE.authenticated.
  let handlers = { login: null, logout: null };
  function setAuthHandlers(next) { handlers = { ...handlers, ...(next || {}) }; }
  function login() {
    if (!handlers.login) return false;
    handlers.login();
    return true;
  }
  function logout() {
    if (!handlers.logout) return false;
    handlers.logout();
    return true;
  }

  const authSubscribers = new Set();
  function onAuthChanged(cb) {
    authSubscribers.add(cb);
    return () => authSubscribers.delete(cb);
  }
  // The single writer for the session flag the screens read. Same contract as
  // Swift's __indexAuthChanged: a boolean, never credential material.
  function setAuthenticated(authenticated) {
    const next = authenticated === true;
    if (native().authenticated === next) return;
    window.INDEX_NATIVE.authenticated = next;
    authSubscribers.forEach((cb) => { try { cb(next); } catch (e) { /* ignore */ } });
  }

  // ---- deep links ---------------------------------------------------------

  // Swift dispatches `index-deeplink` for an index:// open or a verified
  // universal link. Nothing dispatches it on the web except our own
  // notification clicks, but the listener is registered the same way — before
  // React's first effects — so a link that arrives early waits here.
  const deepLinkBuffer = [];
  let deepLinkSubscriber = null;
  window.addEventListener("index-deeplink", (event) => {
    const url = event && event.detail && event.detail.url;
    if (!url) return;
    if (deepLinkSubscriber) deepLinkSubscriber(url);
    else deepLinkBuffer.push(url);
  });
  function onDeepLink(cb) {
    deepLinkSubscriber = cb;
    while (deepLinkBuffer.length) cb(deepLinkBuffer.shift());
    return () => { if (deepLinkSubscriber === cb) deepLinkSubscriber = null; };
  }

  // ---- snapshot -----------------------------------------------------------

  // Resolve a promise into a {ok,value} pair so one failing endpoint (e.g. a
  // brand-new user with no opportunities) never blanks the whole snapshot.
  function settle(promise) {
    return promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
  }

  // Accept either a bare array or an envelope { <key>: [...] }.
  function normalizeList(value, key) {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value[key])) return value[key];
    return [];
  }

  async function loadSnapshot() {
    const c = getClient();
    if (!c) return null;
    const [meR, intentR] = await Promise.all([
      settle(c.auth.me()),
      settle(c.intents.list({ page: 1, limit: 100 })),
    ]);

    const user = meR.ok ? (meR.value.user || meR.value) : null;
    const features = meR.ok ? (meR.value.features || {}) : {};
    const intents = intentR.ok ? normalizeList(intentR.value, "intents") : [];

    const snapshot = window.IndexApi.mapIndexSnapshot({ user, networks: [], intents, radarItems: [] });
    return {
      snapshot,
      me: mapMe(user),
      networks: [],
      features,
      raw: { user, features, networks: [], intents, radarItems: [] },
    };
  }

  async function loadNetworks() {
    const c = getClient();
    if (!c) return null;
    const [netR, meR] = await Promise.all([
      settle(c.networks.list()),
      settle(c.auth.me()),
    ]);
    const user = meR.ok ? (meR.value.user || meR.value) : null;
    const networks = netR.ok ? normalizeList(netR.value, "networks") : [];
    return { networks: mapNetworks(networks, user) };
  }

  // Share / invitation links. The mac has to derive this from the API host; the
  // web app is already serving from it.
  function webBaseUrl() {
    return window.location.origin;
  }

  // Map an API user onto the shape the UI's ME expects. Live-only: there is no
  // demo fallback, so missing fields become empty rather than borrowing another
  // identity's values.
  function mapMe(user) {
    if (!user) return {};
    const userSocials = Array.isArray(user.socials)
      ? user.socials.map((s) => ({ id: s.label || s.id || "", prefix: "", handle: s.value || s.handle || "" }))
      : [];
    return {
      id: user.id || "",
      name: user.name || "",
      handle: user.username ? `@${user.username}` : "",
      email: user.email || "",
      location: user.location || "",
      intro: user.intro || user.bio || "",
      photo: avatarUrl(user.avatar),
      socials: userSocials,
      websites: [],
      source: user,
    };
  }

  function mapNetworkEntry(n, user, joined) {
    const meId = user && user.id;
    const joinPolicy = (n.permissions && n.permissions.joinPolicy) || n.joinPolicy || "invite_only";
    const invite = (n.permissions && n.permissions.invitationLink) || n.invitationLink || null;
    // Prefer API `role` (viewer membership). Falling back to user.id ===
    // network.user.id is wrong for multi-owner networks.
    const apiRole = n.role === "owner" || n.role === "member" ? n.role : null;
    const ownerId = n.user && n.user.id;
    const inferredOwner = !!(meId && ownerId && meId === ownerId);
    const role = apiRole || (inferredOwner ? "owner" : "member");
    return {
      id: n.id,
      name: n.title || n.name || "untitled",
      blurb: n.prompt || n.description || "",
      members: (n._count && n._count.members) || n.memberCount || 0,
      role,
      joined,
      hidden: n.hidden === true,
      privacy: joinPolicy === "anyone" ? "public" : "private",
      joinPolicy,
      requireAdminApproval: !!(n.permissions && n.permissions.requireAdminApproval),
      // Owners only: the API sends 0 to everyone else.
      pendingJoinCount: Number(n.pendingJoinCount) || 0,
      invitationCode: invite && invite.code ? invite.code : null,
      // Same key resolution as user avatars: S3 keys need the storage base.
      photo: avatarUrl(n.imageUrl || n.photo || null),
      signals: [],
      source: n,
    };
  }

  function mapNetworks(networks, user) {
    return networks.map((n) => mapNetworkEntry(n, user, true));
  }

  // Public discovery rows — not joined unless the API marks isMember.
  function mapDiscoverNetworks(networks, user) {
    return networks.map((n) => mapNetworkEntry(n, user, n.isMember === true));
  }

  // ---- enrichment + onboarding REST ---------------------------------------

  function confirmOnboardingProfile() {
    const c = getClient();
    return c ? c.auth.confirmOnboardingProfile() : Promise.reject(new Error("no api client"));
  }
  function completeOnboarding(intentId) {
    const c = getClient();
    const body = intentId ? { intentId } : {};
    return c ? c.auth.completeOnboarding(body) : Promise.reject(new Error("no api client"));
  }

  // Run public profile prefill (POST /enrichment/enrich) for the authenticated user.
  function triggerEnrichment(hints) {
    const c = getClient();
    if (!c) return Promise.reject(new Error("no api client"));
    return c.enrichment.trigger(hints || {});
  }

  // ---- access settings ----------------------------------------------------

  // Keys and devices are plain authenticated routes the client has no named
  // method for. Devices come from our own /auth/devices, not Better Auth's
  // list-sessions, because that one returns every session's token.
  function accessRequest(method, path, body) {
    const c = getClient();
    return c.request(path, body === undefined ? { method } : { method, body });
  }

  function listApiKeys() { return accessRequest("GET", "/auth/api-key/list"); }
  function createApiKey(name) { return accessRequest("POST", "/auth/api-key/create", { name }); }
  function revokeApiKey(keyId) { return accessRequest("POST", "/auth/api-key/delete", { keyId }); }
  function listDevices() { return accessRequest("GET", "/auth/devices"); }
  function revokeDevice(sessionId) { return accessRequest("POST", "/auth/devices/revoke", { sessionId }); }

  // ---- local runtimes -----------------------------------------------------

  // The agents screen asks the shell to scan the login PATH for agent CLIs. A
  // browser cannot, and answering `null` (what the mac bridge returns with no
  // Swift behind it) would leave its demo rows standing on a signed-in page, so
  // this answers with a real, empty inventory instead. Wiring is refused in the
  // same terms — the screen renders the reason on the row.
  function detectHarnesses() { return Promise.resolve([]); }
  const NO_LOCAL_WIRING = { ok: false, error: "wiring a local runtime needs the index desktop app." };
  function setupHermes() { return Promise.resolve(NO_LOCAL_WIRING); }
  function teardownHermes() { return Promise.resolve(NO_LOCAL_WIRING); }

  // ---- realtime -----------------------------------------------------------

  // Views share the app's single /events connection.
  const inboxHandlers = new Set();
  function streamInbox(onEvent) {
    inboxHandlers.add(onEvent);
    return { close: () => inboxHandlers.delete(onEvent) };
  }

  // ---- notifications ------------------------------------------------------

  // The mac posts an OS toast through Swift. The browser equivalent is the
  // Notifications API, and only when the user has already granted it: asking
  // for permission is a decision for the settings pane, not for whatever
  // arrives on the stream first. Clicking one re-enters the same deep-link
  // pipeline the Swift toasts use.
  function notify(payload) {
    if (!payload || typeof Notification === "undefined") return false;
    if (Notification.permission !== "granted") return false;
    try {
      const toast = new Notification(payload.title, { body: payload.body || "", icon: payload.icon });
      if (payload.url) {
        toast.onclick = () => {
          window.focus();
          window.dispatchEvent(new CustomEvent("index-deeplink", { detail: { url: payload.url } }));
        };
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // Swift persists these in UserDefaults because file:// localStorage does not
  // survive a relaunch; a real origin has no such problem.
  const NOTIFY_PREFS_KEY = "index:web:notify-prefs";
  function setNotifyPrefs(prefs) {
    if (window.INDEX_NATIVE) window.INDEX_NATIVE.notifyPrefs = prefs || null;
    try {
      if (prefs) localStorage.setItem(NOTIFY_PREFS_KEY, JSON.stringify(prefs));
      else localStorage.removeItem(NOTIFY_PREFS_KEY);
    } catch (e) { /* best-effort */ }
    // A toggle turned on is the moment the user asked for toasts, so it is also
    // the moment to ask the browser for them.
    if (prefs && typeof Notification !== "undefined" && Notification.permission === "default") {
      try { Notification.requestPermission(); } catch (e) { /* ignore */ }
    }
    return true;
  }

  // Current preferences: the in-session edit (mirrored onto ME by the settings
  // save) wins over the stored ones; null means default (everything on) and is
  // how notificationEventAllowed fails open.
  function notifyPrefs() {
    const me = window.INDEX_DATA && window.INDEX_DATA.ME;
    if (me && me.notify) return me.notify;
    if (native().notifyPrefs) return native().notifyPrefs;
    try {
      const stored = JSON.parse(localStorage.getItem(NOTIFY_PREFS_KEY) || "null");
      if (stored) window.INDEX_NATIVE.notifyPrefs = stored;
      return stored;
    } catch (e) { return null; }
  }

  // App-wide notification pipeline, same shape as the mac bridge and the Hermes
  // Desktop plugin: one realtime stream carrying opportunity/question frames and
  // messages alike, realtime-only, own sends suppressed, fail-closed until the
  // signed-in identity is known. What differs is the transport — EventSource
  // cannot carry an Authorization header, so the token rides the query string
  // exactly as ConversationContext does.
  function startDesktopNotifications({ getUserId, getPrefs = notifyPrefs } = {}) {
    const N = window.IndexApi || {};
    if (!N.composeNotification) return () => {};
    let stopped = false;
    const state = { notifiedEntities: readNotified() };

    function readNotified() {
      try {
        const list = JSON.parse(localStorage.getItem(N.NOTIFIED_ENTITIES_KEY) || "[]");
        return Array.isArray(list) ? list.slice(-N.MAX_NOTIFIED_ENTITIES) : [];
      } catch (e) { return []; }
    }
    function persistNotified() {
      try { localStorage.setItem(N.NOTIFIED_ENTITIES_KEY, JSON.stringify(state.notifiedEntities)); }
      catch (e) { /* best-effort */ }
    }
    function send(event) {
      const copy = N.composeNotification(event, { avatarUrl });
      if (copy) notify(copy);
    }
    function onRealtime(event) {
      if (stopped || !event) return;
      inboxHandlers.forEach((handler) => handler(event));
      if (event.type === "connected") return;
      // Own-send suppression is a message question: notification frames have no
      // sender, and isOwnMessage fails closed on anything without `message`.
      if (event.message && N.isOwnMessage(event, getUserId ? getUserId() : null)) return;
      if (!N.notificationEventAllowed(event, getPrefs ? getPrefs() : null)) return;
      if (!N.composeNotification(event)) return;
      const remembered = N.rememberNotificationEntity(state.notifiedEntities, N.notificationEntityKey(event));
      if (!remembered.isNew) return;
      state.notifiedEntities = remembered.notifiedEntities;
      persistNotified();
      send(event);
    }

    // Keep one stream alive for the pipeline's lifetime. EventSource retries on
    // its own, but a token that expires mid-session makes the server refuse the
    // reconnect, so each drop is answered with a fresh token and a fresh
    // connection after a pause.
    let source = null;
    let retry = null;
    let lastEventId = null;

    async function connect() {
      if (stopped) return;
      const token = await getToken();
      if (stopped) return;
      if (!token) { schedule(); return; }
      const resume = lastEventId ? `&after=${encodeURIComponent(lastEventId)}` : "";
      source = new EventSource(`${apiBaseUrl()}/events?token=${encodeURIComponent(token)}${resume}`);
      source.onmessage = (message) => {
        if (message.lastEventId) lastEventId = message.lastEventId;
        let parsed = null;
        try { parsed = JSON.parse(message.data); } catch (e) { return; }
        onRealtime(parsed);
      };
      source.onerror = () => {
        if (source) { source.close(); source = null; }
        schedule();
      };
    }
    function schedule() {
      if (stopped || retry) return;
      retry = setTimeout(() => { retry = null; connect(); }, 15000);
    }

    connect();

    return function dispose() {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (source) { source.close(); source = null; }
    };
  }

  return {
    native,
    isAuthed,
    apiBaseUrl,
    avatarUrl,
    webBaseUrl,
    getClient,
    // `client` kept as an alias for callers that prefer the shorter name.
    client: getClient,
    normalizeList,
    loadSnapshot,
    loadNetworks,
    mapDiscoverNetworks,
    login,
    logout,
    detectHarnesses,
    setupHermes,
    teardownHermes,
    onAuthChanged,
    onDeepLink,
    streamInbox,
    notify,
    setNotifyPrefs,
    notifyPrefs,
    startDesktopNotifications,
    confirmOnboardingProfile,
    completeOnboarding,
    triggerEnrichment,
    listApiKeys,
    createApiKey,
    revokeApiKey,
    listDevices,
    revokeDevice,
    // Host-side entry points, not part of the screens' vocabulary.
    setAuthHandlers,
    setAuthenticated,
  };
})();

// Back-compat alias, some early screens referenced window.Api.
window.Api = window.IndexApp;

/** Wire the site's session and login modal into the bridge (see page.tsx). */
export function setAuthHandlers(next) { window.IndexApp.setAuthHandlers(next); }

/** Mirror the site's session state onto the flag the screens read. */
export function setAuthenticated(authenticated) { window.IndexApp.setAuthenticated(authenticated); }
