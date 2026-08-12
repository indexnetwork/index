// bridge.jsx — live backend bridge for the mac app.
//
// Native bridge: defines the single window.IndexApp façade the screens talk to.
// IndexApi client from window.INDEX_NATIVE (injected by the Swift shell:
// { apiBaseUrl, apiKey }), exposes a parallel snapshot load, native
// login/logout + an auth-changed subscription, fetch-based SSE for chat and the
// conversation inbox (EventSource can't set the x-api-key header), and a single
// MCP tools/call for intent creation (which has no plain REST POST).
//
// window.IndexApi is the inlined client+mappers bundle (assemble.py);
// window.INDEX_DATA is the offline demo fallback. window.Api is kept as an alias
// so either name resolves to the same object.


window.IndexApp = (function () {
  function native() { return window.INDEX_NATIVE || {}; }
  function apiKey() { return native().apiKey || null; }
  function isAuthed() { return !!apiKey(); }

  function apiBaseUrl() {
    const raw = native().apiBaseUrl || "http://localhost:3001/api";
    return window.IndexApi && window.IndexApi.normalizeApiBaseUrl
      ? window.IndexApi.normalizeApiBaseUrl(raw)
      : raw.replace(/\/+$/, "");
  }

  // users.avatar is either a full URL (legacy Google/OAuth photos) or an S3
  // object key like "avatars/<userId>/<uuid>.jpg". Keys are served by the API at
  // {base}/storage/<key>; in the WebView a bare key would resolve against the app
  // origin and 404, so absolutize it. Absolute (http/https/data) values pass
  // through untouched.
  function avatarUrl(avatar) {
    if (!avatar) return null;
    if (/^(https?:|data:)/i.test(avatar)) return avatar;
    return `${apiBaseUrl()}/storage/${String(avatar).replace(/^\/+/, "")}`;
  }

  function getClient() {
    if (!window.IndexApi || !window.IndexApi.createIndexApiClient) return null;
    return window.IndexApi.createIndexApiClient({
      apiBaseUrl: native().apiBaseUrl,
      // Read the key lazily so a mid-session login/logout is picked up without
      // rebuilding the client.
      getApiKey: () => native().apiKey,
    });
  }

  // ---- native auth bridge --------------------------------------------------

  function hasBridge() {
    return !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.indexAuth);
  }
  function post(action) {
    if (!hasBridge()) return false;
    window.webkit.messageHandlers.indexAuth.postMessage({ action });
    return true;
  }
  function login() { return post("login"); }
  function logout() { return post("logout"); }

  // Swift answers a detectHarnesses post via window.__indexHarnessesDetected.
  // Resolves with [{id,label,command,path}], or null when there is no native
  // bridge (browser preview) so callers keep their demo data.
  const harnessWaiters = [];
  window.__indexHarnessesDetected = function (list) {
    while (harnessWaiters.length) harnessWaiters.shift()(list || []);
  };
  function detectHarnesses() {
    if (!hasBridge()) return Promise.resolve(null);
    return new Promise((resolve) => {
      harnessWaiters.push(resolve);
      post("detectHarnesses");
    });
  }

  // Swift answers a setupHermes post (writes ~/.hermes/.env, installs the
  // indexnetwork/hermes-plugin) via window.__indexHermesSetup.
  const hermesWaiters = [];
  window.__indexHermesSetup = function (result) {
    while (hermesWaiters.length) hermesWaiters.shift()(result || {});
  };
  function setupHermes(apiKey) {
    if (!hasBridge()) return Promise.resolve({ ok: false, error: "no native bridge" });
    return new Promise((resolve) => {
      hermesWaiters.push(resolve);
      window.webkit.messageHandlers.indexAuth.postMessage({ action: "setupHermes", value: apiKey });
    });
  }
  // Undo: uninstall the plugin and scrub Index credentials from ~/.hermes/.env.
  function teardownHermes() {
    if (!hasBridge()) return Promise.resolve({ ok: false, error: "no native bridge" });
    return new Promise((resolve) => {
      hermesWaiters.push(resolve);
      post("teardownHermes");
    });
  }

  // Swift calls window.__indexAuthChanged(apiKeyOrNull) after it updates
  // window.INDEX_NATIVE. Fan that out to any React subscribers.
  const authSubscribers = new Set();
  window.__indexAuthChanged = function (key) {
    authSubscribers.forEach((cb) => { try { cb(key); } catch (e) { /* ignore */ } });
  };
  function onAuthChanged(cb) {
    authSubscribers.add(cb);
    return () => authSubscribers.delete(cb);
  }

  // ---- deep links ---------------------------------------------------------

  // Swift hands over a URL (an index:// open or a verified universal link) by
  // dispatching an `index-deeplink` CustomEvent carrying the raw string; it
  // makes no routing decision, window.IndexApi.parseDeepLink does that.
  //
  // This listener is registered while the bundle evaluates, before React's
  // first effects run, because on a cold launch the queued link is dispatched
  // as soon as the page finishes loading. Anything that arrives before the app
  // subscribes waits here instead of being dropped on the floor.
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

    const snapshot = window.IndexApi.mapIndexSnapshot({ user, networks: [], intents, questions: [], radarItems: [] });
    return {
      snapshot,
      me: mapMe(user),
      networks: [],
      features,
      raw: { user, features, networks: [], intents, questions: [], radarItems: [] },
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

  // Web origin for share / invitation links. Always pair with the active API
  // host (drop leading `protocol.`) — never deepLinkHosts[0] (prod AASA host).
  // Remote APP_URL wins when set; localhost APP_URL is ignored for remote APIs.
  function webBaseUrl() {
    try {
      const u = new URL(apiBaseUrl());
      let host = u.hostname;
      if (host === "localhost" || host === "127.0.0.1") {
        const appUrl = native().appUrl;
        if (appUrl) return String(appUrl).replace(/\/+$/, "");
        return `${u.protocol}//${host}:3000`;
      }
      if (host.startsWith("protocol.")) host = host.slice("protocol.".length);
      const appUrl = native().appUrl;
      if (appUrl) {
        try {
          const a = new URL(appUrl);
          if (a.hostname && a.hostname !== "localhost" && a.hostname !== "127.0.0.1") {
            return String(appUrl).replace(/\/+$/, "");
          }
        } catch (e) { /* ignore bad APP_URL */ }
      }
      return `https://${host}`;
    } catch (e) { /* fall through */ }

    const appUrl = native().appUrl;
    if (appUrl) return String(appUrl).replace(/\/+$/, "");
    const hosts = native().deepLinkHosts;
    const host = Array.isArray(hosts) && hosts.length ? String(hosts[0]) : "index.network";
    return `https://${host.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  }

  // Map an API user onto the shape the UI's ME expects. Live-only: there is no
  // demo fallback, so missing fields become empty rather than borrowing another
  // identity's values.
  function mapMe(user) {
    if (!user) return {};
    const socials = Array.isArray(user.socials)
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
      socials,
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
    const role = n.isPersonal
      ? "personal"
      : (apiRole || (inferredOwner ? "owner" : "member"));
    return {
      id: n.id,
      name: n.title || n.name || "untitled",
      blurb: n.prompt || n.description || "",
      members: (n._count && n._count.members) || n.memberCount || 0,
      role,
      joined,
      isPersonal: n.isPersonal === true,
      hasMasterKey: n.hasMasterKey === true,
      hidden: n.hidden === true,
      privacy: joinPolicy === "anyone" ? "public" : "private",
      joinPolicy,
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

  // ---- tools + enrichment -------------------------------------------------

  // Invoke a protocol tool over REST (POST /tools/:name). Onboarding-allowed
  // tools (preview_user_context, confirm_user_context) work with the x-api-key.
  // Resolves the parsed tool result envelope ({ success, data } | { success:false, ... }).
  function invokeTool(toolName, query) {
    const c = getClient();
    if (!c) return Promise.reject(new Error("no api client"));
    return c.tools.invoke(toolName, query || {});
  }

  // Run the full public-research enrichment inline (POST /enrichment/enrich) and
  // resolve { enriched, profile:{ name, intro, location, socials } } so callers
  // can display discovered socials immediately. Other enrichment is automatic.
  function triggerEnrichment() {
    const c = getClient();
    if (!c) return Promise.reject(new Error("no api client"));
    return c.enrichment.trigger();
  }

  // ---- fetch-based SSE ----------------------------------------------------

  // Read an SSE body, invoking onEvent(parsedJson) for every `data:` payload.
  async function readSSE(response, onEvent) {
    if (!response.body || !response.body.getReader) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line.
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (!data) continue;
        try { onEvent(JSON.parse(data)); }
        catch (e) { /* keepalive / non-JSON frame */ }
      }
    }
  }

  // POST /chat/stream. `persona` selects the server persona (e.g. "negotiator");
  // api-key callers fall back to the orchestrator when omitted. Resolves with
  // the session id (from the X-Session-Id response header) once the stream ends.
  // onSession fires as soon as headers arrive, so mid-stream events (e.g.
  // user_question) can be resolved against the conversation right away.
  async function streamChat({ message, sessionId, scopeType, scopeId, persona, onEvent, onSession, signal }) {
    const headers = { "Content-Type": "application/json" };
    const key = apiKey();
    if (key) headers["x-api-key"] = key;
    const body = { message };
    if (sessionId) body.sessionId = sessionId;
    if (scopeType && scopeId) { body.scopeType = scopeType; body.scopeId = scopeId; }
    if (persona) body.persona = persona;

    const response = await fetch(`${apiBaseUrl()}/chat/stream`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    const resolvedSession = response.headers.get("X-Session-Id") || sessionId || null;
    if (resolvedSession && onSession) { try { onSession(resolvedSession); } catch (e) { /* ignore */ } }
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try { const j = await response.json(); if (j && j.error) detail = j.error; } catch (e) { /* ignore */ }
      if (onEvent) onEvent({ type: "error", error: detail });
      return resolvedSession;
    }
    await readSSE(response, (event) => { if (onEvent) onEvent(event); });
    return resolvedSession;
  }

  // GET /conversations/stream, live inbox events. Returns an abort handle.
  function streamInbox(onEvent) {
    const controller = new AbortController();
    const headers = {};
    const key = apiKey();
    if (key) headers["x-api-key"] = key;
    fetch(`${apiBaseUrl()}/conversations/stream`, { headers, signal: controller.signal })
      .then((response) => { if (response.ok) return readSSE(response, onEvent); })
      .catch((e) => { /* aborted or network drop; caller may retry */ });
    return { close: () => controller.abort() };
  }

  // ---- desktop notifications ------------------------------------------------

  // Post one OS toast through the Swift indexNotify bridge. Fire-and-forget;
  // false in browser preview where there is no native side.
  function notify(payload) {
    const handlers = window.webkit && window.webkit.messageHandlers;
    if (!handlers || !handlers.indexNotify) return false;
    handlers.indexNotify.postMessage(payload || {});
    return true;
  }

  // Persist the settings-pane notification toggles in UserDefaults via Swift
  // (file:// localStorage does not survive a relaunch). Mirror onto
  // INDEX_NATIVE so the running page reads its own save back.
  function setNotifyPrefs(prefs) {
    if (window.INDEX_NATIVE) window.INDEX_NATIVE.notifyPrefs = prefs || null;
    if (!hasBridge()) return false;
    window.webkit.messageHandlers.indexAuth.postMessage({ action: "setNotifyPrefs", value: prefs || null });
    return true;
  }

  // Current notification preferences: the in-session edit (mirrored onto ME by
  // the settings save) wins over the durable native store; null means default
  // (everything on) and is how notificationEventAllowed fails open.
  function notifyPrefs() {
    const me = window.INDEX_DATA && window.INDEX_DATA.ME;
    if (me && me.notify) return me.notify;
    return (native().notifyPrefs) || null;
  }

  // App-wide OS notification pipeline, mirroring the Hermes Desktop plugin
  // (packages/hermes-plugin/desktop/tail.js): realtime SSE for question/
  // opportunity events plus a 60s snapshot catch-up, and the conversation
  // stream for messages — realtime-only, own messages suppressed, fail-closed
  // until the signed-in identity is known. Dedupe keys persist to localStorage
  // best-effort; losing them across a relaunch is safe because the first
  // snapshot after boot primes the seen-set without toasting.
  function startDesktopNotifications({ getUserId, getPrefs = notifyPrefs } = {}) {
    const N = window.IndexApi || {};
    if (!N.composeNotification) return () => {};
    let stopped = false;
    const state = { hasSnapshot: false, notifiedEntities: readNotified() };

    function readNotified() {
      try {
        const list = JSON.parse(localStorage.getItem(N.NOTIFIED_ENTITIES_KEY) || "[]");
        return Array.isArray(list) ? list.slice(-N.MAX_NOTIFIED_ENTITIES) : [];
      } catch (e) { return []; }
    }
    function persistNotified() {
      try { localStorage.setItem(N.NOTIFIED_ENTITIES_KEY, JSON.stringify(state.notifiedEntities)); }
      catch (e) { /* best-effort under file:// */ }
    }
    function send(event) {
      const copy = N.composeNotification(event, { avatarUrl });
      if (copy) notify(copy);
    }
    function onRealtime(event, suppressOwnMessage) {
      if (stopped || !event || event.type === "connected") return;
      if (suppressOwnMessage && N.isOwnMessage(event, getUserId ? getUserId() : null)) return;
      if (!N.notificationEventAllowed(event, getPrefs ? getPrefs() : null)) return;
      if (!N.composeNotification(event)) return;
      const remembered = N.rememberNotificationEntity(state.notifiedEntities, N.notificationEntityKey(event));
      if (!remembered.isNew) return;
      state.notifiedEntities = remembered.notifiedEntities;
      persistNotified();
      send(event);
    }

    function authedHeaders() {
      const headers = {};
      const key = apiKey();
      if (key) headers["x-api-key"] = key;
      return headers;
    }

    // Keep an SSE stream alive for the pipeline's lifetime; a dropped or
    // refused stream reconnects after a pause instead of dying silently.
    function keepStream(path, handler) {
      let close = null;
      (async () => {
        while (!stopped) {
          await new Promise((done) => {
            const controller = new AbortController();
            close = () => controller.abort();
            fetch(`${apiBaseUrl()}${path}`, { headers: authedHeaders(), signal: controller.signal })
              .then((response) => (response.ok ? readSSE(response, handler) : null))
              .catch(() => { /* aborted or network drop */ })
              .finally(done);
          });
          if (!stopped) await new Promise((r) => setTimeout(r, 15000));
        }
      })();
      return () => { if (close) close(); };
    }

    const closeNotifications = keepStream("/notifications/stream", (e) => onRealtime(e, false));
    const closeInbox = keepStream("/conversations/stream", (e) => onRealtime(e, true));

    let reconciling = false;
    async function reconcile() {
      if (stopped || reconciling) return;
      reconciling = true;
      try {
        const response = await fetch(`${apiBaseUrl()}/notifications/snapshot`, { headers: authedHeaders() });
        if (!response.ok) return;
        const payload = await response.json();
        if (stopped) return;
        const result = N.reconcileNotificationSnapshot(payload, state);
        state.hasSnapshot = result.state.hasSnapshot;
        state.notifiedEntities = result.state.notifiedEntities;
        persistNotified();
        const prefs = getPrefs ? getPrefs() : null;
        for (const event of result.notifications) {
          if (!stopped && N.notificationEventAllowed(event, prefs)) send(event);
        }
      } catch (e) { /* the next reconciliation retries */ }
      finally { reconciling = false; }
    }
    reconcile();
    const snapshotTimer = setInterval(reconcile, 60000);

    return function dispose() {
      stopped = true;
      clearInterval(snapshotTimer);
      closeNotifications();
      closeInbox();
    };
  }

  // ---- MCP tools/call -----------------------------------------------------

  // Single JSON-RPC tools/call against /mcp (stateless, x-api-key auth). Used
  // for intent creation, which has no plain REST POST. Handles both a direct
  // application/json response and an SSE-framed one.
  async function mcpCall(tool, args) {
    const base = apiBaseUrl().replace(/\/api$/, "");
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const key = apiKey();
    if (key) headers["x-api-key"] = key;

    const response = await fetch(`${base}/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Math.random().toString(36).slice(2),
        method: "tools/call",
        params: { name: tool, arguments: args || {} },
      }),
    });

    const contentType = response.headers.get("content-type") || "";
    let rpc;
    if (contentType.includes("text/event-stream")) {
      let last = null;
      await readSSE(response, (event) => { last = event; });
      rpc = last;
    } else {
      rpc = await response.json().catch(() => null);
    }
    if (!rpc) throw new Error(`MCP ${tool} returned no response (HTTP ${response.status})`);
    if (rpc.error) throw new Error(rpc.error.message || `MCP ${tool} failed`);

    const result = rpc.result || {};
    if (result.isError) {
      const text = extractMcpText(result);
      throw new Error(text || `MCP ${tool} reported an error`);
    }
    return parseMcpResult(result);
  }

  // create_intent has no plain REST POST, go through the MCP tool. autoApprove
  // persists immediately (there is no proposal-card UI here).
  function createIntent(description, extra) {
    return mcpCall("create_intent", { description, autoApprove: true, ...(extra || {}) });
  }

  // Chat turns embed proposals as ```intent_proposal fenced JSON blocks, the
  // same format the web app and CLI confirm through POST /intents/confirm.
  function parseIntentProposals(text) {
    if (!text) return [];
    const out = [];
    const re = /```intent_proposal\s*\n([\s\S]*?)\n```/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      try {
        const p = JSON.parse(m[1]);
        if (p && p.proposalId && p.description) out.push(p);
      } catch (e) { /* skip malformed block */ }
    }
    return out;
  }

  // MCP tool results carry a content[] array; the structured payload lives in
  // structuredContent when present, otherwise as JSON text in the first block.
  function parseMcpResult(result) {
    if (result.structuredContent) return result.structuredContent;
    const text = extractMcpText(result);
    if (!text) return {};
    try { return JSON.parse(text); } catch (e) { return { text }; }
  }

  function extractMcpText(result) {
    const content = Array.isArray(result.content) ? result.content : [];
    const block = content.find((c) => c && c.type === "text" && typeof c.text === "string");
    return block ? block.text : "";
  }

  return {
    native,
    apiKey,
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
    createIntent,
    parseIntentProposals,
    streamChat,
    streamInbox,
    notify,
    setNotifyPrefs,
    notifyPrefs,
    startDesktopNotifications,
    mcpCall,
    invokeTool,
    triggerEnrichment,
  };
})();

// Back-compat alias, some early screens referenced window.Api.
window.Api = window.IndexApp;
