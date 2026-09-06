/**
 * HTTP client for the Index Network protocol API.
 *
 * All methods attach the stored Bearer token and handle
 * common error patterns (401, network errors).
 */

import type { UserProfile, UserData, Intent, ListIntentsOptions, IntentListResult, OpportunityListOptions, Opportunity, OpportunityDetail, Network, NetworkMember, NetworkRequest, NetworkCreateResult, NetworkInvitationResult, Conversation, ConversationMessage, Negotiation, NegotiationListOptions, EnrichmentResult, ToolResult } from "./types";

// Re-export all types for backward compatibility
export type { UserProfile, UserData, Intent, ListIntentsOptions, IntentListResult, OpportunityListOptions, Opportunity, OpportunityActor, OpportunityInterpretation, OpportunityDetection, OpportunityDetail, OpportunityParty, Network, NetworkMember, NetworkRequest, NetworkCreateResult, NetworkInvitationResult, ConversationParticipant, Conversation, MessagePart, ConversationMessage, Negotiation, NegotiationListOptions, NegotiationSpeaker, NegotiationTurn, NegotiationOutcome, EnrichedProfile, EnrichmentResult, ToolResult } from "./types";

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
  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}` };
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


  async updateIntent(intentId: string, description: string): Promise<ToolResult> {
    return this.callTool("update_intent", { intentId, description });
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
  async sendMessage(conversationId: string, text: string): Promise<ConversationMessage> {
    const res = await this.post(`/api/conversations/${conversationId}/messages`, {
      parts: [{ type: "text", text }],
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
   * Open an SSE stream for real-time conversation events.
   *
   * Returns the raw Response so the caller can read the body
   * as a stream and parse SSE events incrementally.
   *
   * @returns The raw fetch Response with SSE body.
   * @throws Error on auth failure or network error.
   */
  async streamConversationEvents(): Promise<Response> {
    const res = await fetch(`${this.baseUrl}/api/conversations/stream`, {
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
   * @param opts - Optional filters (limit, offset).
   * @returns Array of negotiation objects.
   * @throws Error on auth failure or network error.
   */
  async listNegotiations(opts?: NegotiationListOptions): Promise<Negotiation[]> {
    const me = await this.getMe();
    const params = new URLSearchParams();
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    if (opts?.since) params.set("since", opts.since);
    const qs = params.toString();
    const path = qs
      ? `/api/users/${me.id}/negotiations?${qs}`
      : `/api/users/${me.id}/negotiations`;
    const res = await this.get(path);
    const body = (await res.json()) as { negotiations: Negotiation[] };
    return body.negotiations;
  }

  // ── Profile and tool methods ────────────────────────────────────

  async enrichProfile(): Promise<EnrichmentResult> {
    const res = await this.post("/api/enrichment/enrich", {});
    return await res.json() as EnrichmentResult;
  }

  /**
   * Invoke a tool by name via the HTTP tool API.
   *
   * @param toolName - Tool name (e.g. 'read_intents', 'create_intent').
   * @param query - Tool-specific query parameters.
   * @returns Parsed tool result.
   * @throws Error on auth failure or network error.
   */
  async callTool(toolName: string, query: Record<string, unknown> = {}): Promise<ToolResult> {
    const res = await this.post(`/api/tools/${toolName}`, { query });
    return (await res.json()) as ToolResult;
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
    if (res.status === 401) {
      throw new ApiError(
        "Session expired or invalid. Run `index login` to re-authenticate.",
        res.status,
      );
    }

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

