// api.jsx, live backend bridge for the mac app.
//
// Defines the single window.IndexApp façade the screens talk to. It builds an
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
    const [meR, netR, intentR, questionR, radarR] = await Promise.all([
      settle(c.auth.me()),
      settle(c.networks.list()),
      settle(c.intents.list({})),
      settle(c.questions.pending()),
      settle(c.opportunities.radar()),
    ]);

    const user = meR.ok ? (meR.value.user || meR.value) : null;
    const features = meR.ok ? (meR.value.features || {}) : {};
    const networks = netR.ok ? normalizeList(netR.value, "networks") : [];
    const intents = intentR.ok ? normalizeList(intentR.value, "intents") : [];
    const questions = questionR.ok ? normalizeList(questionR.value, "questions") : [];
    const radarItems = radarR.ok ? normalizeList(radarR.value, "items") : [];

    const snapshot = window.IndexApi.mapIndexSnapshot({ user, networks, intents, questions, radarItems });
    return {
      snapshot,
      me: mapMe(user),
      networks: mapNetworks(networks),
      features,
      raw: { user, features, networks, intents, questions, radarItems },
    };
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

  function mapNetworks(networks) {
    return networks.map((n) => ({
      id: n.id,
      name: n.title || n.name || "untitled",
      members: (n._count && n._count.members) || n.memberCount || 0,
      role: n.isPersonal ? "personal" : (n.role || "member"),
      joined: true,
      isPersonal: n.isPersonal === true,
      privacy: n.joinPolicy === "anyone" ? "public" : "private",
      // Same key resolution as user avatars: S3 keys need the storage base.
      photo: avatarUrl(n.imageUrl || n.photo || null),
      signals: [],
      source: n,
    }));
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
    getClient,
    // `client` kept as an alias for callers that prefer the shorter name.
    client: getClient,
    normalizeList,
    loadSnapshot,
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
    mcpCall,
    invokeTool,
    triggerEnrichment,
  };
})();

// Back-compat alias, some early screens referenced window.Api.
window.Api = window.IndexApp;
