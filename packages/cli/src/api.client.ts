/**
 * HTTP client for the Index Network protocol API.
 *
 * All methods attach the stored Bearer token and handle
 * common error patterns (401, network errors).
 */

import type {
  ChatSession,
  UserProfile,
  StreamChatParams,
  UserData,
  Intent,
  ListIntentsOptions,
  IntentListResult,
  OpportunityListOptions,
  Opportunity,
  Network,
  NetworkMember,
  SearchedUser,
  AddMemberResult,
  Conversation,
  ConversationMessage,
  ToolResult,
} from "./types";

// Re-export all types for backward compatibility
export type {
  ChatSession,
  UserProfile,
  StreamChatParams,
  UserData,
  Intent,
  ListIntentsOptions,
  IntentListResult,
  OpportunityListOptions,
  Opportunity,
  OpportunityActor,
  OpportunityInterpretation,
  OpportunityDetection,
  Network,
  NetworkMember,
  SearchedUser,
  AddMemberResult,
  ConversationParticipant,
  Conversation,
  MessagePart,
  ConversationMessage,
  ToolResult,
} from "./types";

export class ApiClient {
  private readonly baseUrl: string;
  private readonly token: string;

  /**
   * @param baseUrl - Protocol server base URL (e.g. `http://localhost:3001`).
   * @param token - Bearer JWT token for authentication.
   */
  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  /**
   * List all chat sessions for the authenticated user.
   *
   * @returns Array of session objects.
   * @throws Error on auth failure or network error.
   */
  async listSessions(): Promise<ChatSession[]> {
    const res = await this.get("/api/chat/sessions");
    const body = (await res.json()) as { sessions: ChatSession[] };
    return body.sessions;
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
  async getOpportunity(id: string): Promise<Opportunity> {
    const res = await this.get(`/api/opportunities/${id}`);
    return (await res.json()) as Opportunity;
  }

  /**
   * Open an SSE stream to the chat endpoint.
   *
   * Returns the raw Response so the caller can read the body
   * as a stream and parse SSE events incrementally.
   *
   * @param params - Stream parameters (message, optional sessionId).
   * @returns The raw fetch Response with SSE body.
   * @throws Error on auth failure or network error.
   */
  async streamChat(params: StreamChatParams): Promise<Response> {
    const res = await fetch(`${this.baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        message: params.message,
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
      }),
    });

    if (!res.ok) {
      await this.handleError(res);
    }

    return res;
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
   * Create a new network.
   *
   * @param title - The network title.
   * @param prompt - Optional description/prompt for the network.
   * @returns The created network object.
   * @throws Error on auth failure or network error.
   */
  async createNetwork(title: string, prompt?: string): Promise<Network> {
    const res = await this.post("/api/networks", {
      title,
      ...(prompt ? { prompt } : {}),
    });
    const body = (await res.json()) as { network: Network };
    return body.network;
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
   * Search users by query string, optionally filtering by network membership.
   *
   * @param query - Search query (email or name).
   * @param networkId - Optional network ID to exclude existing members.
   * @returns Array of matching user objects.
   * @throws Error on auth failure or network error.
   */
  async searchUsers(query: string, networkId?: string): Promise<SearchedUser[]> {
    const params = new URLSearchParams({ q: query });
    if (networkId) params.set("networkId", networkId);
    const res = await this.get(`/api/networks/search-users?${params.toString()}`);
    const body = (await res.json()) as { users: SearchedUser[] };
    return body.users;
  }

  /**
   * Add a member to a network.
   *
   * @param networkId - The network ID.
   * @param userId - The user ID to add.
   * @returns Object with member info and message.
   * @throws Error on auth failure, forbidden, or network error.
   */
  async addNetworkMember(networkId: string, userId: string): Promise<AddMemberResult> {
    const res = await this.post(`/api/networks/${networkId}/members`, { userId });
    const body = (await res.json()) as AddMemberResult;
    return body;
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
        Authorization: `Bearer ${this.token}`,
        Accept: "text/event-stream",
      },
    });

    if (!res.ok) {
      await this.handleError(res);
    }

    return res;
  }

  // ── Tool methods ────────────────────────────────────────────────

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
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
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
        Authorization: `Bearer ${this.token}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!res.ok) {
      await this.handleError(res);
    }

    return res;
  }

  private async del(path: string): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${this.token}`,
      },
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
      throw new Error(
        "Session expired or invalid. Run `index login` to re-authenticate.",
      );
    }

    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Response body was not JSON — use status text.
    }

    throw new Error(message);
  }
}

