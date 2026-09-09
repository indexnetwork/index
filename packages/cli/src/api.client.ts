/**
 * HTTP client for the Index Network protocol API.
 *
 * All methods attach the selected session or API-key credential and handle
 * common error patterns (401, network errors).
 */

import type { UserProfile, UserData, Intent, ListIntentsOptions, IntentListResult, OpportunityListOptions, Opportunity, OpportunityDetail, Network, NetworkMember, NetworkRequest, NetworkCreateResult, NetworkInvitationResult, Conversation, ConversationMessage, Negotiation, NegotiationDetail, NegotiationTurnAction, NegotiationListOptions, EnrichmentResult } from "./types";

// Re-export all types for backward compatibility
export type { UserProfile, UserData, Intent, ListIntentsOptions, IntentListResult, OpportunityListOptions, Opportunity, OpportunityActor, OpportunityInterpretation, OpportunityDetection, OpportunityDetail, OpportunityParty, Network, NetworkMember, NetworkRequest, NetworkCreateResult, NetworkInvitationResult, ConversationParticipant, Conversation, MessagePart, ConversationMessage, Negotiation, NegotiationListOptions, NegotiationTurn, NegotiationOutcome, EnrichedProfile, EnrichmentResult } from "./types";

/** HTTP error retaining a parsed structured response for JSON/advisory clients. */
export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly response?: unknown) {
    super(message);
    this.name = "ApiError";
  }
}

function isEarlyAccessNetworkCreationError(error: unknown): error is ApiError {
  if (!(error instanceof ApiError) || error.status !== 403) return false;
  const response = error.response;
  return typeof response === "object"
    && response !== null
    && "error" in response
    && typeof response.error === "string"
    && response.error.startsWith("Network creation is in early access.");
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly token: string;

  /**
   * @param baseUrl - Protocol server base URL (e.g. `http://localhost:3001`).
   * @param token - Device session token.
   */
  constructor(baseUrl: string, token: string, private readonly credentialKind: "session" | "apiKey" = "session") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  private authHeaders(): Record<string, string> {
    return this.credentialKind === "apiKey"
      ? { "x-api-key": this.token }
      : { Authorization: `Bearer ${this.token}` };
  }

  /**
   * Get the currently authenticated user's profile.
   *
   * @returns The user object.
   * @throws Error on auth failure or network error.
   */
  async getMe(): Promise<UserProfile> {
    const res = await this.get("/api/auth/me");
    const body = (await res.json()) as { user: UserProfile };
    return body.user;
  }

  /**
   * Get a user by ID.
   *
   * @param userId - The user ID to look up.
   * @returns The user profile data.
   * @throws Error on auth failure or network error.
   */
  async getUser(userId: string): Promise<UserData> {
    const res = await this.get(`/api/users/${userId}`);
    const body = (await res.json()) as { user: UserData };
    return body.user;
  }

  /**
   * List opportunities for the authenticated user.
   *
   * @param opts - Optional filters (status, limit).
   * @returns Array of opportunity objects.
   * @throws Error on auth failure or network error.
   */
  async listOpportunities(opts?: OpportunityListOptions): Promise<Opportunity[]> {
    const params = new URLSearchParams();
    if (opts?.status) params.set("status", opts.status);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    const path = qs ? `/api/opportunities?${qs}` : "/api/opportunities";
    const res = await this.get(path);
    const body = (await res.json()) as { opportunities: Opportunity[] };
    return body.opportunities;
  }

  /**
   * Get a single opportunity with presentation details.
   *
   * @param id - Opportunity ID.
   * @returns Opportunity object with presentation.
   * @throws Error on auth failure, not found, or network error.
   */
  async getOpportunity(id: string): Promise<OpportunityDetail> {
    const res = await this.get(`/api/opportunities/${id}`);
    return (await res.json()) as OpportunityDetail;
  }

  /** Update an opportunity status over REST. */
  async updateOpportunityStatus(
    id: string,
    status: "accepted" | "rejected",
  ): Promise<Record<string, unknown>> {
    const res = await this.patch(`/api/opportunities/${id}/status`, { status });
    return await res.json() as Record<string, unknown>;
  }

  /**
   * List intents with optional pagination and filters.
   *
   * @param options - Optional filters: limit, archived, sourceType.
   * @returns Object with intents array and pagination metadata.
   * @throws Error on auth failure or network error.
   */
  async listIntents(options: ListIntentsOptions = {}): Promise<IntentListResult> {
    const body: Record<string, unknown> = {};
    if (options.limit !== undefined) body.limit = options.limit;
    if (options.archived !== undefined) body.archived = options.archived;
    if (options.sourceType !== undefined) body.sourceType = options.sourceType;
    if (options.page !== undefined) body.page = options.page;
    if (options.query !== undefined) body.q = options.query;

    const res = await this.post("/api/intents/list", body);
    return (await res.json()) as IntentListResult;
  }

  /**
   * Get a single intent by ID.
   *
   * @param id - The intent ID.
   * @returns The intent object.
   * @throws Error on auth failure, not found, or network error.
   */
  async getIntent(id: string): Promise<Intent> {
    const res = await this.get(`/api/intents/${id}`);
    const body = (await res.json()) as { intent: Intent };
    return body.intent;
  }

  /**
   * Create one signal. With no network ids it is shared in every network the
   * caller belongs to.
   *
   * @param description - The signal text.
   * @param networkIds - Networks to share it in; omit for all memberships.
   * @returns The created signal id and the networks it was linked to.
   * @throws Error on auth failure, a refused description, or network error.
   */
  async createIntent(description: string, networkIds?: string[]): Promise<{ intentId: string; networkIds: string[] }> {
    const res = await this.post("/api/intents", {
      description,
      ...(networkIds?.length ? { networkIds } : {}),
    });
    return (await res.json()) as { intentId: string; networkIds: string[] };
  }

  /**
   * Rewrite a signal's description.
   *
   * @param intentId - Full UUID or short prefix.
   * @param description - The rewritten text.
   * @throws Error on auth failure, a refused description, or network error.
   */
  async updateIntent(intentId: string, description: string): Promise<{ intentId: string; description: string }> {
    const res = await this.patch(`/api/intents/${encodeURIComponent(intentId)}`, { description });
    return (await res.json()) as { intentId: string; description: string };
  }

  /**
   * Archive a signal, removing it from discovery.
   *
   * @param intentId - Full UUID or short prefix.
   * @throws Error on auth failure, not found, or network error.
   */
  async archiveIntent(intentId: string): Promise<void> {
    await this.patch(`/api/intents/${encodeURIComponent(intentId)}/archive`);
  }

  /**
   * List the networks a signal is shared in.
   *
   * @param intentId - Full UUID or short prefix.
   * @returns The linked network UUIDs.
   * @throws Error on auth failure, not found, or network error.
   */
  async listIntentNetworks(intentId: string): Promise<string[]> {
    const res = await this.get(`/api/intents/${encodeURIComponent(intentId)}/networks`);
    const body = (await res.json()) as { networkIds: string[] };
    return body.networkIds;
  }

  /**
   * Share a signal in one network.
   *
   * @param intentId - Full UUID or short prefix.
   * @param networkId - The network UUID.
   * @throws Error on auth failure, refused membership, or network error.
   */
  async addIntentToNetwork(intentId: string, networkId: string): Promise<void> {
    await this.post(`/api/intents/${encodeURIComponent(intentId)}/networks`, { networkId });
  }

  /**
   * Withdraw a signal from one network, leaving the signal itself intact.
   *
   * @param intentId - Full UUID or short prefix.
   * @param networkId - The network UUID.
   * @throws Error on auth failure, refused membership, or network error.
   */
  async removeIntentFromNetwork(intentId: string, networkId: string): Promise<void> {
    await this.del(`/api/intents/${encodeURIComponent(intentId)}/networks/${encodeURIComponent(networkId)}`);
  }

  // ── Network methods ─────────────────────────────────────────────

  /**
   * List networks the authenticated user is a member of.
   *
   * @returns Array of network objects.
   * @throws Error on auth failure or network error.
   */
  async listNetworks(): Promise<Network[]> {
    const res = await this.get("/api/networks");
    const body = (await res.json()) as { networks: Array<Network & { permissions?: { joinPolicy?: string } }> };
    return body.networks.map((n) => ({
      ...n,
      joinPolicy: n.joinPolicy ?? n.permissions?.joinPolicy,
    }));
  }

  /**
   * Create a new network or submit an early-access creation request.
   *
   * @param title - The network title.
   * @param prompt - Optional description/prompt for the network.
   * @returns A tagged created-network or submitted-request result.
   * @throws Error on auth failure, unrelated authorization errors, or network error.
   */
  async createNetworkOrRequest(title: string, prompt?: string): Promise<NetworkCreateResult> {
    try {
      const res = await this.post("/api/networks", {
        title,
        ...(prompt ? { prompt } : {}),
      });
      const body = await res.json() as { network: Network };
      return { kind: "created", network: body.network };
    } catch (error) {
      if (!isEarlyAccessNetworkCreationError(error)) throw error;
    }

    const res = await this.post("/api/network-requests", {
      name: title,
      ...(prompt ? { purpose: prompt } : {}),
    });
    const body = await res.json() as { request: NetworkRequest };
    return { kind: "requested", request: body.request };
  }

  /**
   * Get a single network by ID with owner info and member count.
   *
   * @param id - The network ID.
   * @returns The network object.
   * @throws Error on auth failure or network error.
   */
  async getNetwork(id: string): Promise<Network> {
    const res = await this.get(`/api/networks/${id}`);
    const body = (await res.json()) as { network: Network & { permissions?: { joinPolicy?: string } } };
    const n = body.network;
    return { ...n, joinPolicy: n.joinPolicy ?? n.permissions?.joinPolicy };
  }

  /**
   * Get members of a network.
   *
   * @param id - The network ID.
   * @returns Array of member objects.
   * @throws Error on auth failure or network error.
   */
  async getNetworkMembers(id: string): Promise<NetworkMember[]> {
    const res = await this.get(`/api/networks/${id}/members`);
    const body = (await res.json()) as { members: NetworkMember[] };
    return body.members;
  }

  /**
   * Join a public network.
   *
   * @param id - The network ID.
   * @returns The joined network object.
   * @throws Error on auth failure, forbidden, or network error.
   */
  async joinNetwork(id: string): Promise<Network> {
    const res = await this.post(`/api/networks/${id}/join`, {});
    const body = (await res.json()) as { network: Network };
    return body.network;
  }

  /**
   * Leave a network.
   *
   * @param id - The network ID.
   * @throws Error on auth failure, forbidden (owner), or network error.
   */
  async leaveNetwork(id: string): Promise<void> {
    await this.post(`/api/networks/${id}/leave`, {});
  }

  /**
   * Update a network's settings. Owner-only.
   *
   * @param id - The network ID.
   * @param settings - The fields to change (title, prompt).
   * @returns The updated network object.
   * @throws Error on auth failure, forbidden, or network error.
   */
  async updateNetwork(id: string, settings: { title?: string; prompt?: string }): Promise<Network> {
    const res = await this.put(`/api/networks/${id}`, settings);
    const body = (await res.json()) as { network: Network };
    return body.network;
  }

  /**
   * Delete a network. Owner-only.
   *
   * @param id - The network ID.
   * @throws Error on auth failure, forbidden, or network error.
   */
  async deleteNetwork(id: string): Promise<void> {
    await this.del(`/api/networks/${id}`);
  }

  /** Invite a network member directly by email. */
  async inviteNetworkMember(
    networkId: string,
    email: string,
    name?: string,
  ): Promise<NetworkInvitationResult> {
    const res = await this.post(`/api/networks/${networkId}/members/invite`, {
      email,
      ...(name ? { name } : {}),
    });
    return await res.json() as NetworkInvitationResult;
  }

  // ── Conversation methods ─────────────────────────────────────────

  /**
   * List all conversations for the authenticated user.
   *
   * @returns Array of conversation objects.
   * @throws Error on auth failure or network error.
   */
  async listConversations(): Promise<Conversation[]> {
    const res = await this.get("/api/conversations");
    const body = (await res.json()) as { conversations: Conversation[] };
    return body.conversations;
  }

  /**
   * Get or create a DM conversation with a peer user.
   *
   * @param peerUserId - The peer user's ID.
   * @returns The conversation object (existing or newly created).
   * @throws Error on auth failure or network error.
   */
  async getOrCreateDM(peerUserId: string): Promise<Conversation> {
    const res = await this.post("/api/conversations/dm", { peerUserId });
    const body = (await res.json()) as { conversation: Conversation };
    return body.conversation;
  }

  /**
   * Get messages for a conversation.
   *
   * @param conversationId - The conversation ID.
   * @param opts - Optional filters (limit, before cursor).
   * @returns Array of message objects.
   * @throws Error on auth failure or network error.
   */
  async getMessages(conversationId: string, opts?: { limit?: number; before?: string }): Promise<ConversationMessage[]> {
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.before) params.set("before", opts.before);
    const qs = params.toString();
    const path = qs
      ? `/api/conversations/${conversationId}/messages?${qs}`
      : `/api/conversations/${conversationId}/messages`;
    const res = await this.get(path);
    const body = (await res.json()) as { messages: ConversationMessage[] };
    return body.messages;
  }

  /**
   * Send a text message in a conversation.
   *
   * @param conversationId - The conversation ID.
   * @param text - The message text.
   * @returns The created message object.
   * @throws Error on auth failure or network error.
   */
  async sendMessage(conversationId: string, text: string, intentId?: string, questionId?: string): Promise<ConversationMessage> {
    const res = await this.post(`/api/conversations/${conversationId}/messages`, {
      parts: [{ kind: "text", text }],
      ...(intentId ? { metadata: { intentId } } : {}),
      ...(questionId ? { questionId } : {}),
    });
    const body = (await res.json()) as { message: ConversationMessage };
    return body.message;
  }

  /**
   * Hide a conversation (soft-hide via hiddenAt).
   *
   * @param conversationId - The conversation ID.
   * @throws Error on auth failure or network error.
   */
  async hideConversation(conversationId: string): Promise<void> {
    await this.del(`/api/conversations/${conversationId}`);
  }

  /**
   * Open the user's SSE channel — conversation messages and notification
   * frames on one stream.
   *
   * Returns the raw Response so the caller can read the body
   * as a stream and parse SSE events incrementally.
   *
   * @returns The raw fetch Response with SSE body.
   * @throws Error on auth failure or network error.
   */
  async streamEvents(): Promise<Response> {
    const res = await fetch(`${this.baseUrl}/api/events`, {
      headers: {
        ...this.authHeaders(),
        Accept: "text/event-stream",
      },
    });

    if (!res.ok) {
      await this.handleError(res);
    }

    return res;
  }

  // ── Negotiation methods ─────────────────────────────────────────

  /**
   * List negotiations for the authenticated user.
   *
   * @param opts - Optional intentId and open/settled state filters.
   * @returns Array of negotiation objects.
   * @throws Error on auth failure or network error.
   */
  async listNegotiations(opts?: NegotiationListOptions): Promise<Negotiation[]> {
    const params = new URLSearchParams();
    if (opts?.intentId) params.set("intentId", opts.intentId);
    if (opts?.state) params.set("state", opts.state);
    const qs = params.toString();
    const path = `/api/negotiations${qs ? `?${qs}` : ""}`;
    const res = await this.get(path);
    const body = (await res.json()) as { negotiations: Negotiation[] };
    return body.negotiations;
  }

  // ── Profile, scrape, and docs methods ───────────────────────────

  async enrichProfile(): Promise<EnrichmentResult> {
    const res = await this.post("/api/enrichment/enrich", {});
    return await res.json() as EnrichmentResult;
  }

  /**
   * Read the text of one public web page.
   *
   * @param url - The page to read; a bare domain is read as https.
   * @param objective - Why it is being read; steers extraction.
   * @returns The normalized url and its text.
   * @throws Error on auth failure, unreadable page, or network error.
   */
  async scrapeUrl(url: string, objective?: string): Promise<{ url: string; contentLength: number; content: string }> {
    const res = await this.post("/api/scrape", { url, ...(objective ? { objective } : {}) });
    return (await res.json()) as { url: string; contentLength: number; content: string };
  }

  /**
   * Read the protocol's canonical guidance.
   *
   * @param topic - A canonical topic; omit for the summary and topic list.
   * @returns The markdown content.
   * @throws Error on auth failure, unknown topic, or network error.
   */
  async readDocs(topic?: string): Promise<{ topic?: string; topics?: string[]; content: string }> {
    const path = topic ? `/api/docs?${new URLSearchParams({ topic })}` : "/api/docs";
    return (await this.get(path)).json() as Promise<{ topic?: string; topics?: string[]; content: string }>;
  }

  /** Read the current agent selection. */
  async getAgent(): Promise<unknown> {
    return (await this.get("/api/agents/me")).json();
  }

  /** Read a negotiation directly by opportunity ID, including protocol guidance. */
  async getNegotiation(opportunityId: string): Promise<NegotiationDetail> {
    const body = await (await this.get(`/api/negotiations/${encodeURIComponent(opportunityId)}`)).json() as { negotiation: NegotiationDetail };
    return body.negotiation;
  }

  /** Submit one observed turn; rejected or uncertain writes are never replayed. */
  async submitNegotiationTurn(opportunityId: string, turn: { action: NegotiationTurnAction; message: string; expectedTurnCount: number }): Promise<NegotiationDetail> {
    const body = await (await this.post(`/api/negotiations/${encodeURIComponent(opportunityId)}/turns`, turn)).json() as { negotiation: NegotiationDetail };
    return body.negotiation;
  }

  /** Read the scoped personal-agent conversation and availability. */
  async getAgentConversation(intentId: string): Promise<unknown> {
    return (await this.get(`/api/conversations/agent/messages?${new URLSearchParams({ intentId })}`)).json();
  }

  /** Explicitly confirm the owner's profile. */
  async confirmProfile(): Promise<unknown> {
    return (await this.post("/api/auth/onboarding/confirm-profile", {})).json();
  }

  /** Complete onboarding, subject to server prerequisites. */
  async completeOnboarding(intentId?: string): Promise<unknown> {
    return (await this.post("/api/auth/onboarding/complete", { intentId })).json();
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async get(path: string): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: this.authHeaders(),
    });

    if (!res.ok) {
      await this.handleError(res);
    }

    return res;
  }

  private async post(path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders(),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
      await this.handleError(res);
    }

    return res;
  }

  private async put(path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders(),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) await this.handleError(res);
    return res;
  }

  private async patch(path: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...this.authHeaders(),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) await this.handleError(res);
    return res;
  }

  private async del(path: string): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: this.authHeaders(),
    });

    if (!res.ok) {
      await this.handleError(res);
    }

    return res;
  }

  /**
   * Handle non-2xx responses with meaningful error messages.
   *
   * @throws Error with a descriptive message.
   */
  private async handleError(res: Response): Promise<never> {
    let message = `HTTP ${res.status}`;
    let response: unknown;
    try {
      response = await res.json();
      if (typeof response === "object" && response !== null && "error" in response) {
        const error = (response as { error?: unknown }).error;
        if (typeof error === "string") message = error;
      }
    } catch {
      // Response body was not JSON — use status text.
    }

    throw new ApiError(message, res.status, response);
  }
}

