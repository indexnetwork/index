/**
 * Standalone Index API client for the macOS/iOS prototypes.
 *
 * This module is intentionally not imported by IndexApp or IndexApp-iOS yet. It
 * gives the mac subtree a dedicated place to evolve API consumption without
 * coupling live transport to the current fake-data prototype screens.
 */

const DEFAULT_API_BASE_URL = 'http://localhost:3001/api';

/**
 * @typedef {Object} IndexApiClientOptions
 * @property {string} [apiBaseUrl] Absolute API base URL, including `/api`.
 * @property {() => (string | Promise<string | null | undefined>)} [getToken]
 *   Optional bearer-token provider. Native shells can later source this from
 *   Keychain and inject it into the web layer.
 * @property {() => (string | Promise<string | null | undefined>)} [getApiKey]
 *   Optional API-key provider, sent as the `x-api-key` header. Used by the
 *   native macOS/iOS shells whose credential is a CLI API key, not a session.
 * @property {typeof fetch} [fetchImpl] Optional fetch implementation for tests.
 */

/**
 * @typedef {Object} RequestOptions
 * @property {string} [method]
 * @property {unknown} [body]
 * @property {boolean} [auth]
 * @property {AbortSignal} [signal]
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
export function createIndexApiClient(options = {}) {
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('createIndexApiClient requires a fetch implementation');
  }

  /**
   * @template T
   * @param {string} endpoint
   * @param {RequestOptions} [requestOptions]
   * @returns {Promise<T>}
   */
  async function request(endpoint, requestOptions = {}) {
    const { method = 'GET', body, auth = true, signal } = requestOptions;
    const headers = { 'Content-Type': 'application/json' };

    if (auth && options.getApiKey) {
      const apiKey = await options.getApiKey();
      if (apiKey) headers['x-api-key'] = apiKey;
    }
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
    const blob = await (await fetchImpl(dataUrl)).blob();
    const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const file = new File([blob], `${basename}.${ext}`, { type: blob.type || 'image/jpeg' });
    const form = new FormData();
    form.append(fieldName, file);

    /** @type {Record<string, string>} */
    const headers = {};
    if (auth && options.getApiKey) {
      const apiKey = await options.getApiKey();
      if (apiKey) headers['x-api-key'] = apiKey;
    }
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

    auth: {
      me: (options = {}) => request('/auth/me', options),
      updateProfile: (body, options = {}) => request('/auth/profile/update', { ...options, method: 'PATCH', body }),
      revokeCliCredential: (keyId, targetKey, options = {}) => request(
        '/auth/cli-credential/revoke',
        { ...options, method: 'POST', body: { keyId, targetKey } },
      ),
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
      overview: (networkId, options = {}) => request(`/networks/${encodeURIComponent(networkId)}/overview`, options),
      myIntents: (networkId, options = {}) => request(`/networks/${encodeURIComponent(networkId)}/my-intents`, options),
      create: (body, options = {}) => request('/networks', { ...options, method: 'POST', body }),
      // Public preview of an invite-link target: name, owner and member count,
      // no membership required (used by the invite deep-link join screen).
      shareByCode: (code, options = {}) => request(`/networks/share/${encodeURIComponent(code)}`, { ...options, auth: false }),
      // Accept a private-network invitation by its link code. Resolves
      // { index, membership, alreadyMember }.
      acceptInvitation: (code, options = {}) => request(`/networks/invitation/${encodeURIComponent(code)}/accept`, { ...options, method: 'POST', body: {} }),
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
      invoke: (toolName, query = {}, options = {}) => request(
        `/tools/${encodeURIComponent(toolName)}`,
        { ...options, method: 'POST', body: { query } },
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
