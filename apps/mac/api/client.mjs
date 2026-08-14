/**
 * Standalone Index API client for the macOS prototype.
 *
 * Assembled into the mac app as `window.IndexApi`. Gives the mac subtree a
 * dedicated place to evolve API consumption without coupling live transport
 * to browser-preview fake-data screens.
 */

const DEFAULT_API_BASE_URL = 'http://localhost:3001/api';

/**
 * @typedef {Object} IndexApiClientOptions
 * @property {string} [apiBaseUrl] Absolute API base URL, including `/api`.
 * @property {() => (string | Promise<string | null | undefined>)} [getToken]
 *   Optional bearer-token provider for non-native clients.
 * @property {(operation: Record<string, unknown>, options?: {signal?: AbortSignal, onEvent?: (event: unknown) => void}) => Promise<{status: number, body: unknown, headers?: Record<string, string>}>} [nativeRequest]
 *   Credential-free native structured transport. Swift supplies authentication.
 * @property {typeof fetch} [fetchImpl] Optional fetch implementation for tests.
 */

/**
 * @typedef {Object} RequestOptions
 * @property {string} [method]
 * @property {unknown} [body]
 * @property {boolean} [auth]
 * @property {AbortSignal} [signal]
 * @property {number} [timeoutMs]
 */

/** Error thrown for non-2xx API responses. */
export class IndexApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {unknown} [response]
   */
  constructor(message, status, response) {
    super(message);
    this.name = 'IndexApiError';
    this.status = status;
    this.response = response;
  }
}

/**
 * Prefer API body.error / body.detail over opaque native errorCode (e.g. http_error).
 * @param {{ status?: unknown, body?: unknown, errorCode?: unknown }} result
 * @returns {string}
 */
export function messageFromNativeFailure(result) {
  const body = result && result.body;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const error = 'error' in body && body.error != null && String(body.error).trim()
      ? String(body.error).trim()
      : '';
    const detail = 'detail' in body && body.detail != null && String(body.detail).trim()
      ? String(body.detail).trim()
      : '';
    if (error && detail) return `${error}: ${detail}`;
    if (error) return error;
    if (detail) return detail;
  }
  const status = Number(result && result.status) || 0;
  if (status > 0) return `HTTP ${status}`;
  return String((result && result.errorCode) || 'native_request_failed');
}

/**
 * Normalize an API base URL so endpoint construction is stable.
 * @param {string | undefined} value
 * @returns {string}
 */
export function normalizeApiBaseUrl(value) {
  const raw = value || DEFAULT_API_BASE_URL;
  return raw.replace(/\/+$/, '');
}

/**
 * Create a resource-oriented client for services/api.
 * @param {IndexApiClientOptions} [options]
 */
export function createNativeAPIRequestBridge(options) {
  if (!options || typeof options.postMessage !== 'function' || typeof options.createRequestId !== 'function') {
    throw new Error('native bridge requires postMessage and createRequestId');
  }
  const waiters = new Map();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maximumPending = 32;
  const maximumEvents = 256;

  function request(operation, requestOptions = {}) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
      return Promise.reject(new Error('invalid native operation'));
    }
    if (waiters.size >= maximumPending) return Promise.reject(new Error('native bridge busy'));
    const requestId = options.createRequestId();
    if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 128) {
      return Promise.reject(new Error('invalid native request id'));
    }
    return new Promise((resolve, reject) => {
      const requestedTimeout = Number(requestOptions.timeoutMs ?? timeoutMs);
      const boundedTimeout = Number.isFinite(requestedTimeout)
        ? Math.min(300_000, Math.max(1_000, requestedTimeout))
        : timeoutMs;
      const timer = setTimeout(() => {
        if (!waiters.delete(requestId)) return;
        options.postMessage({
          requestId: options.createRequestId(),
          operation: { kind: 'cancel', targetRequestId: requestId },
        });
        reject(new Error('native request timed out'));
      }, boundedTimeout);
      const waiter = { resolve, reject, timer, onEvent: requestOptions.onEvent, sequence: 0, dataEvents: 0, abort: null, signal: requestOptions.signal, started: false };
      waiters.set(requestId, waiter);
      if (requestOptions.signal) {
        waiter.abort = () => {
          if (!waiters.delete(requestId)) return;
          clearTimeout(timer);
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          reject(error);
          if (waiter.started) options.postMessage({
            requestId: options.createRequestId(),
            operation: { kind: 'cancel', targetRequestId: requestId },
          });
        };
        if (requestOptions.signal.aborted) { waiter.abort(); return; }
        requestOptions.signal.addEventListener('abort', waiter.abort, { once: true });
      }
      waiter.started = true;
      try {
        options.postMessage({ requestId, operation });
      } catch (error) {
        waiters.delete(requestId);
        clearTimeout(timer);
        requestOptions.signal?.removeEventListener('abort', waiter.abort);
        reject(error);
      }
    });
  }

  function receive(result) {
    if (!result || typeof result.requestId !== 'string') return false;
    const waiter = waiters.get(result.requestId);
    if (!waiter) return false;
    waiters.delete(result.requestId);
    clearTimeout(waiter.timer);
    if (waiter.abort) waiter.signal?.removeEventListener('abort', waiter.abort);
    if (result.ok) waiter.resolve({
      status: Number(result.status) || 200,
      body: result.body ?? {},
      headers: result.headers && typeof result.headers === 'object' ? result.headers : {},
    });
    else {
      const error = new IndexApiError(
        messageFromNativeFailure(result),
        Number(result.status) || 0,
        result.body ?? null,
      );
      waiter.reject(error);
    }
    return true;
  }

  function receiveEvent(event) {
    if (!event || typeof event.requestId !== 'string') return false;
    const waiter = waiters.get(event.requestId);
    if (!waiter || typeof waiter.onEvent !== 'function' || event.sequence !== waiter.sequence) return false;
    const isHeaders = event.event && event.event.type === 'native_headers';
    if (!isHeaders && waiter.dataEvents >= maximumEvents) return false;
    waiter.sequence += 1;
    if (!isHeaders) waiter.dataEvents += 1;
    waiter.onEvent(event.event);
    return true;
  }

  return { request, receive, receiveEvent };
}

export function createIndexApiClient(options = {}) {
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!options.nativeRequest && typeof fetchImpl !== 'function') {
    throw new Error('createIndexApiClient requires a fetch or native implementation');
  }

  /**
   * @template T
   * @param {string} endpoint
   * @param {RequestOptions} [requestOptions]
   * @returns {Promise<T>}
   */
  async function request(endpoint, requestOptions = {}) {
    const { method = 'GET', body, auth = true, signal } = requestOptions;
    if (options.nativeRequest) {
      const operation = { kind: 'http', method, path: endpoint };
      if (body !== undefined) operation.body = body;
      const native = await options.nativeRequest(operation, { signal });
      if (native.status < 200 || native.status >= 300) {
        const message = native.body && typeof native.body === 'object' && 'error' in native.body
          ? String(native.body.error) : `HTTP ${native.status}`;
        throw new IndexApiError(message, native.status, native.body);
      }
      return /** @type {T} */ (native.body || {});
    }

    const headers = { 'Content-Type': 'application/json' };
    if (auth && options.getToken) {
      const token = await options.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetchImpl(`${apiBaseUrl}${endpoint}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });

    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => ({}))
      : await response.text().catch(() => '');

    if (!response.ok) {
      const message = payload && typeof payload === 'object' && 'error' in payload
        ? String(payload.error)
        : `HTTP ${response.status}: ${response.statusText}`;
      throw new IndexApiError(message, response.status, payload);
    }

    return /** @type {T} */ (payload || {});
  }

  /**
   * Multipart upload. PicturePicker hands us a data URL; turn it into a File
   * and POST without forcing Content-Type so the runtime sets the boundary.
   * @param {string} endpoint
   * @param {string} dataUrl
   * @param {string} fieldName
   * @param {string} basename
   * @param {RequestOptions} [requestOptions]
   */
  async function uploadDataUrl(endpoint, dataUrl, fieldName, basename, requestOptions = {}) {
    const { auth = true, signal } = requestOptions;
    if (options.nativeRequest) {
      const native = await options.nativeRequest({
        kind: 'upload', path: endpoint, fieldName, basename, dataUrl,
      }, { signal });
      if (native.status < 200 || native.status >= 300) {
        const message = native.body && typeof native.body === 'object' && 'error' in native.body
          ? String(native.body.error) : `HTTP ${native.status}`;
        throw new IndexApiError(message, native.status, native.body);
      }
      return /** @type {Record<string, unknown>} */ (native.body || {});
    }

    const blob = await (await fetchImpl(dataUrl)).blob();
    const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const file = new File([blob], `${basename}.${ext}`, { type: blob.type || 'image/jpeg' });
    const form = new FormData();
    form.append(fieldName, file);

    /** @type {Record<string, string>} */
    const headers = {};
    if (auth && options.getToken) {
      const token = await options.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetchImpl(`${apiBaseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: form,
      signal,
    });
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => ({}))
      : await response.text().catch(() => '');
    if (!response.ok) {
      const message = payload && typeof payload === 'object' && 'error' in payload
        ? String(payload.error)
        : `HTTP ${response.status}: ${response.statusText}`;
      throw new IndexApiError(message, response.status, payload);
    }
    return /** @type {Record<string, unknown>} */ (payload || {});
  }

  return {
    request,

    // Owner-control runtime binding. These methods deliberately use the Mac's
    // unbound owner credential; agent-bound Hermes credentials are rejected by
    // the server guard and never flow back through this client after prepare.
    getRuntimeBinding: (installationId, options = {}) => request(
      `/agent-runtime${toQueryString({ installationId })}`,
      options,
    ),
    prepareHermesRuntime: (installationId, setupAttemptId, options = {}) => request(
      '/agent-runtime/hermes/prepare',
      { ...options, method: 'POST', body: { installationId, setupAttemptId } },
    ),
    setRuntimeBinding: (body, options = {}) => request(
      '/agent-runtime',
      { ...options, method: 'PUT', body },
    ),
    compareAndSelectIndex: (expected, options = {}) => request(
      '/agent-runtime/reconcile-index',
      { ...options, method: 'POST', body: expected },
    ),
    rollbackHermesRuntime: (setupAttemptId, options = {}) => request(
      '/agent-runtime/rollback',
      { ...options, method: 'POST', body: { setupAttemptId } },
    ),
    disconnectHermesRuntime: (installationId, options = {}) => request(
      `/agent-runtime/hermes/${encodeURIComponent(installationId)}`,
      { ...options, method: 'DELETE' },
    ),
    auth: {
      me: (options = {}) => request('/auth/me', options),
      updateProfile: (body, options = {}) => request('/auth/profile/update', { ...options, method: 'PATCH', body }),
    },

    storage: {
      /** @param {string} dataUrl data:image/... from PicturePicker */
      uploadAvatar: async (dataUrl, options = {}) => {
        const r = await uploadDataUrl('/storage/avatars', dataUrl, 'avatar', 'avatar', options);
        return /** @type {string} */ (r.avatarUrl);
      },
      /** @param {string} dataUrl data:image/... from PicturePicker */
      uploadIndexImage: async (dataUrl, options = {}) => {
        const r = await uploadDataUrl('/storage/index-images', dataUrl, 'image', 'network', options);
        return /** @type {string} */ (r.imageUrl);
      },
    },

    networks: {
      list: (options = {}) => request('/networks', options),
      discoverPublic: (page = 1, limit = 50, options = {}) => request(
        `/networks/discovery/public${toQueryString({ page, limit })}`,
        options,
      ),
      overview: (networkId, options = {}) => request(`/networks/${encodeURIComponent(networkId)}/overview`, options),
      myIntents: (networkId, options = {}) => request(`/networks/${encodeURIComponent(networkId)}/my-intents`, options),
      create: (body, options = {}) => request('/networks', { ...options, method: 'POST', body }),
      update: (networkId, body, options = {}) => request(
        `/networks/${encodeURIComponent(networkId)}`,
        { ...options, method: 'PUT', body },
      ),
      delete: (networkId, options = {}) => request(
        `/networks/${encodeURIComponent(networkId)}`,
        { ...options, method: 'DELETE' },
      ),
      // Owner Access-tab visibility toggle (public / invite-only).
      updatePermissions: (networkId, body, options = {}) => request(
        `/networks/${encodeURIComponent(networkId)}/permissions`,
        { ...options, method: 'PATCH', body },
      ),
      regenerateInvitationLink: (networkId, options = {}) => request(
        `/networks/${encodeURIComponent(networkId)}/regenerate-invitation`,
        { ...options, method: 'PATCH', body: {} },
      ),
      getMembers: (networkId, options = {}) => request(
        `/networks/${encodeURIComponent(networkId)}/members`,
        options,
      ),
      addMember: (networkId, userId, permissions = ['member'], options = {}) => request(
        `/networks/${encodeURIComponent(networkId)}/members`,
        { ...options, method: 'POST', body: { userId, permissions } },
      ),
      removeMember: (networkId, userId, options = {}) => request(
        `/networks/${encodeURIComponent(networkId)}/members/${encodeURIComponent(userId)}`,
        { ...options, method: 'DELETE' },
      ),
      updateMemberPermissions: (networkId, userId, permissions, options = {}) => request(
        `/networks/${encodeURIComponent(networkId)}/members/${encodeURIComponent(userId)}`,
        { ...options, method: 'PATCH', body: { permissions } },
      ),
      inviteMember: (networkId, body, options = {}) => request(
        `/networks/${encodeURIComponent(networkId)}/members/invite`,
        { ...options, method: 'POST', body },
      ),
      searchUsers: (query, networkId, options = {}) => request(
        `/networks/search-users${toQueryString({ q: query, networkId })}`,
        options,
      ),
      join: (networkId, options = {}) => request(`/networks/${encodeURIComponent(networkId)}/join`, { ...options, method: 'POST', body: {} }),
      leave: (networkId, options = {}) => request(`/networks/${encodeURIComponent(networkId)}/leave`, { ...options, method: 'POST', body: {} }),
    },

    // Early-access "request a network" flow. Direct create (`networks.create`)
    // is staff-only on the server; everyone else submits a reviewed request.
    networkRequests: {
      // Resolves { requests, canReview } — canReview gates the direct-create UI.
      listMine: (options = {}) => request('/network-requests', options),
      create: (body, options = {}) => request('/network-requests', { ...options, method: 'POST', body }),
      update: (id, body, options = {}) => request(`/network-requests/${encodeURIComponent(id)}`, { ...options, method: 'PATCH', body }),
      dismiss: (id, options = {}) => request(`/network-requests/${encodeURIComponent(id)}`, { ...options, method: 'DELETE' }),
    },

    agents: {
      list: (options = {}) => request('/agents', options),
      update: (agentId, body, options = {}) => request(
        `/agents/${encodeURIComponent(agentId)}`,
        { ...options, method: 'PATCH', body },
      ),
      createToken: (agentId, name, options = {}) => request(
        `/agents/${encodeURIComponent(agentId)}/tokens`,
        { ...options, method: 'POST', body: name ? { name } : {} },
      ),
      remove: (agentId, options = {}) => request(
        `/agents/${encodeURIComponent(agentId)}`,
        { ...options, method: 'DELETE' },
      ),
    },

    users: {
      // Public profile: name, intro (the bio), avatar, location, socials.
      // Opportunity cards carry none of that, so the profile window fetches it
      // for the counterpart it is showing.
      get: (userId, options = {}) => request(
        `/users/${encodeURIComponent(userId)}`,
        options,
      ),
      // Same fields for several users at once, for list views.
      batch: (ids = [], options = {}) => request(
        `/users/batch${toQueryString({ ids: ids.join(',') })}`,
        options,
      ),
      // Full negotiation threads (counterparty, outcome, agent-to-agent turns).
      negotiations: (userId, query = {}, options = {}) => request(
        `/users/${encodeURIComponent(userId)}/negotiations${toQueryString(query)}`,
        options,
      ),
    },

    intents: {
      list: (body = {}, options = {}) => request('/intents/list', { ...options, method: 'POST', body }),
      // Turns a chat `intent_proposal` (proposalId + description) into a
      // persisted intent; resolves { intentId }.
      confirm: (body, options = {}) => request('/intents/confirm', { ...options, method: 'POST', body }),
      // Dismisses a pending proposal row instead of orphaning it.
      reject: (body, options = {}) => request('/intents/reject', { ...options, method: 'POST', body }),
      // Fast-intake funnel (FAST_SIGNAL_INTAKE flag): the server is stateless,
      // so every call resends the answered rounds. Ends in /intents/confirm.
      intake: {
        start: (options = {}) => request('/intents/intake/start', { ...options, method: 'POST', body: {} }),
        question: (body, options = {}) => request('/intents/intake/question', { ...options, method: 'POST', body }),
        prepare: (body, options = {}) => request('/intents/intake/prepare', { ...options, method: 'POST', body }),
        proposal: (body, options = {}) => request('/intents/intake/proposal', { ...options, method: 'POST', body }),
        revise: (body, options = {}) => request('/intents/intake/revise', { ...options, method: 'POST', body }),
      },
      get: (intentId, options = {}) => request(`/intents/${encodeURIComponent(intentId)}`, options),
      archive: (intentId, options = {}) => request(`/intents/${encodeURIComponent(intentId)}/archive`, { ...options, method: 'PATCH' }),
      updateStatus: (intentId, status, options = {}) => request(
        `/intents/${encodeURIComponent(intentId)}/status`,
        { ...options, method: 'PATCH', body: { status } },
      ),
    },

    opportunities: {
      list: (query = {}, options = {}) => request(`/opportunities${toQueryString(query)}`, options),
      listForIntent: (intentId, query = {}, options = {}) => request(
        `/opportunities${toQueryString({ ...query, scopeType: 'intent', scopeId: intentId })}`,
        options,
      ),
      radar: (query = {}, options = {}) => request(`/opportunities/radar${toQueryString(query)}`, options),
      radarForIntent: (intentId, query = {}, options = {}) => request(
        `/opportunities/radar${toQueryString({ ...query, scopeType: 'intent', scopeId: intentId })}`,
        options,
      ),
      chatContext: (peerUserId, options = {}) => request(
        `/opportunities/chat-context${toQueryString({ peerUserId })}`,
        options,
      ),
      get: (opportunityId, options = {}) => request(`/opportunities/${encodeURIComponent(opportunityId)}`, options),
      inviteMessage: (opportunityId, options = {}) => request(
        `/opportunities/${encodeURIComponent(opportunityId)}/invite-message`,
        options,
      ),
      updateStatus: (opportunityId, status, options = {}) => request(
        `/opportunities/${encodeURIComponent(opportunityId)}/status`,
        { ...options, method: 'PATCH', body: { status } },
      ),
      updateStatusForIntent: (opportunityId, status, intentId, options = {}) => request(
        `/opportunities/${encodeURIComponent(opportunityId)}/status`,
        { ...options, method: 'PATCH', body: { status, scopeType: 'intent', scopeId: intentId } },
      ),
      startChat: (opportunityId, options = {}) => request(
        `/opportunities/${encodeURIComponent(opportunityId)}/start-chat`,
        { ...options, method: 'POST', body: {} },
      ),
      startChatForIntent: (opportunityId, intentId, options = {}) => request(
        `/opportunities/${encodeURIComponent(opportunityId)}/start-chat`,
        { ...options, method: 'POST', body: { scopeType: 'intent', scopeId: intentId } },
      ),
    },

    questions: {
      pending: (filters = {}, options = {}) => request(
        `/questions${toQueryString({ status: 'pending', ...filters })}`,
        options,
      ),
      pendingForIntent: (intentId, filters = {}, options = {}) => request(
        `/questions${toQueryString({ status: 'pending', ...filters, scopeType: 'intent', scopeId: intentId })}`,
        options,
      ),
      answered: (filters = {}, options = {}) => request(
        `/questions${toQueryString({ status: 'answered', ...filters })}`,
        options,
      ),
      answeredForIntent: (intentId, filters = {}, options = {}) => request(
        `/questions${toQueryString({ status: 'answered', ...filters, scopeType: 'intent', scopeId: intentId })}`,
        options,
      ),
      answer: (questionId, body, options = {}) => request(
        `/questions/${encodeURIComponent(questionId)}/answer`,
        { ...options, method: 'POST', body },
      ),
      dismiss: (questionId, options = {}) => request(
        `/questions/${encodeURIComponent(questionId)}/dismiss`,
        { ...options, method: 'POST', body: {} },
      ),
    },

    tools: {
      readUserContexts: (options = {}) => request(
        '/tools/read_user_contexts', { ...options, method: 'POST', body: { query: {} } },
      ),
      previewUserContext: (query, options = {}) => request(
        '/tools/preview_user_context', { ...options, method: 'POST', body: { query } },
      ),
      confirmUserContext: (draft, options = {}) => request(
        '/tools/confirm_user_context', { ...options, method: 'POST', body: { query: { draft } } },
      ),
    },

    enrichment: {
      // Run the full public-research enrichment inline for the authenticated
      // user and resolve { enriched: true, profile: { name, intro, location,
      // socials } } so the caller can show discovered socials immediately.
      // Every other enrichment path is automatic (profile save, signup, imports).
      trigger: (options = {}) => request('/enrichment/enrich', { ...options, method: 'POST', body: {} }),
    },

    conversations: {
      list: (options = {}) => request('/conversations', options),
      negotiations: (options = {}) => request('/conversations/negotiations', options),
      messages: (conversationId, query = {}, options = {}) => request(
        `/conversations/${encodeURIComponent(conversationId)}/messages${toQueryString(query)}`,
        options,
      ),
      sendMessage: (conversationId, body, options = {}) => request(
        `/conversations/${encodeURIComponent(conversationId)}/messages`,
        { ...options, method: 'POST', body },
      ),
      getOrCreateDm: (peerUserId, options = {}) => request(
        '/conversations/dm',
        { ...options, method: 'POST', body: { peerUserId } },
      ),
      updateMetadata: (conversationId, metadata, options = {}) => request(
        `/conversations/${encodeURIComponent(conversationId)}/metadata`,
        { ...options, method: 'PATCH', body: { metadata } },
      ),
      delete: (conversationId, options = {}) => request(
        `/conversations/${encodeURIComponent(conversationId)}`,
        { ...options, method: 'DELETE' },
      ),
    },
  };
}

/**
 * Convert an object of query params into a stable query string.
 * @param {Record<string, unknown>} query
 * @returns {string}
 */
export function toQueryString(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const raw = params.toString();
  return raw ? `?${raw}` : '';
}
