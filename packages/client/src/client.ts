/**
 * Index HTTP as one class: one API key, seven calls, no model or loop.
 */

export class ApiError extends Error {
  /**
   * @param message - Human-readable failure, including a mint hint on 401.
   * @param status - HTTP status.
   * @param error - Body `{ error }` unwrapped.
   */
  constructor(
    message: string,
    readonly status: number,
    readonly error: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type NegotiationAction = "propose" | "counter" | "accept" | "decline";
export type NegotiationOutcome = "agreed" | "declined" | "closed";

export interface Negotiation {
  id: string;
  opportunityId: string;
  intentId: string;
  awaitingUserId: string | null;
  outcome: NegotiationOutcome | null;
  settledAt: string | null;
  turnCount: number;
  createdAt: string;
  updatedAt: string;
  counterparty: {
    intentId: string;
    userId: string;
    name: string | null;
    avatar: string | null;
    statement: string;
  };
}

export interface NegotiationDetail extends Negotiation {
  turns: {
    turnIndex: number;
    seatUserId: string;
    action: NegotiationAction;
    message: string;
    createdAt: string;
  }[];
}

export type IntentStatus = "ACTIVE" | "PAUSED" | "FULFILLED" | "EXPIRED" | "ARCHIVED";

/** One of the owner's signals, as an agent working it needs to see it. */
export interface IntentSummary {
  id: string;
  statement: string;
  status: IntentStatus;
}

/** The authenticated owner, with the profile facts an agent may state as theirs. */
export interface Me {
  id: string;
  name: string | null;
  intro: string | null;
  location: string | null;
  timezone: string | null;
  /** Whether the owner confirmed that profile. Unconfirmed is seed data, not fact. */
  profileConfirmed: boolean;
}

export type QuestionScope = "intent" | "match";

export interface MatchReference {
  opportunityId: string;
  counterparty: { id: string; name: string | null };
}

/** One human-facing entry on the principal conversation. */
export interface PrincipalMessage {
  id: string;
  createdAt: string;
  questionId?: string;
  kind: "question" | "answer" | "user" | "message";
  matches: readonly MatchReference[];
  text: string;
  scope?: QuestionScope;
  options?: string[];
}

export interface PrincipalQuestion {
  id: string;
  question: string;
  options?: string[];
  scope: QuestionScope;
  matches: readonly MatchReference[];
}

export interface PersonalAgentState {
  status: "running" | "starting" | "paused" | "external" | "unavailable";
  /** Every question still waiting on the owner, oldest first. */
  questions: PrincipalQuestion[];
}

export interface ConversationMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName?: string;
  senderAvatar?: string;
  role: "user" | "agent";
  parts: unknown;
  createdAt: string;
}

export type IntentLifecycleWireStatus = "ACTIVE" | "PAUSED" | "ARCHIVED";

export type ConnectedEvent = { type: "connected" };

export type UserEvent =
  | { type: "opportunity.new"; id: string; title: string; body: string; link?: string; data?: { opportunityId: string } }
  | { type: "negotiation.opened"; id: string; title: string; body: string; link?: string; data: { intentId: string; count: number } }
  | { type: "negotiation.turn"; id: string; title: string; body: string; link?: string; data: { opportunityId: string; intentId: string; turnIndex: number } }
  | { type: "negotiation.settled"; id: string; title: string; body: string; link?: string; data: { opportunityId: string; intentId: string; outcome: string } }
  | { type: "negotiation.changed"; id: string; title: string; body: string; data: { intentId: string; opportunityId?: string } }
  | { type: "intent.created"; id: string; title: string; body: string; data: { intentId: string } }
  | { type: "intent.lifecycle"; id: string; title: string; body: string; link?: string; data: { intentId: string; status: IntentLifecycleWireStatus } }
  | { type: "question.pending"; id: string; title: string; body: string; data: { intentId: string; questionId: string; scope: string; opportunityId: string | null } }
  | { type: "principal.input"; id: string; title: string; body: string; data: { intentId: string; questionId: string | null; text: string } }
  | { type: "message"; conversationId: string; message: ConversationMessage };

const WAKE_TYPES = ["negotiation.opened", "negotiation.turn", "principal.input"] as const;

/**
 * @param event - A parsed user-event frame.
 * @returns Whether an agent host should wake for this frame.
 */
export function wakesHost(event: UserEvent): boolean {
  return (WAKE_TYPES as readonly string[]).includes(event.type);
}

function parseUserEvent(raw: unknown): UserEvent | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const type = (raw as { type?: unknown }).type;
  switch (type) {
    case "opportunity.new":
    case "negotiation.opened":
    case "negotiation.turn":
    case "negotiation.settled":
    case "negotiation.changed":
    case "intent.created":
    case "intent.lifecycle":
    case "question.pending":
    case "principal.input":
    case "message":
      return raw as UserEvent;
    default:
      return undefined;
  }
}

/**
 * The Index protocol over REST, as an agent-bound API key.
 */
export class IndexClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly executorId?: string;
  private identity?: Me;

  /**
   * @param options - Origin, key, and optional executor fence. Env fills gaps.
   * @throws When no API key is given and `INDEX_API_KEY` is empty.
   */
  constructor(options?: { baseUrl?: string; apiKey?: string; executorId?: string }) {
    this.baseUrl = (options?.baseUrl ?? process.env.INDEX_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
    const apiKey = options?.apiKey ?? process.env.INDEX_API_KEY ?? "";
    if (!apiKey) throw new Error("INDEX_API_KEY is required");
    this.apiKey = apiKey;
    const executorId = options?.executorId ?? process.env.INDEX_EXECUTOR_ID;
    if (executorId) this.executorId = executorId;
  }

  private headers(json = false): Record<string, string> {
    return {
      Accept: "application/json",
      "x-api-key": this.apiKey,
      ...(json ? { "Content-Type": "application/json" } : {}),
    };
  }

  private fence(path: string): string {
    return this.executorId ? `${path}${path.includes("?") ? "&" : "?"}executorId=${encodeURIComponent(this.executorId)}` : path;
  }

  /**
   * @param method - HTTP method.
   * @param path - Path under `/api`.
   * @param body - JSON body when the method writes.
   * @returns Parsed JSON.
   * @throws ApiError on non-2xx. Distinct Error when the body is not JSON.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api${path}`, {
      method,
      headers: this.headers(body !== undefined),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) {
      let error = text.slice(0, 500);
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (typeof parsed.error === "string") error = parsed.error;
      } catch { /* raw body */ }
      const message = response.status === 401 ? `${error} Mint a new credential.` : error;
      throw new ApiError(message, response.status, error);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error("Response is not JSON");
    }
  }

  /**
   * @returns The authenticated owner. Fetched once per instance.
   */
  async me(): Promise<Me> {
    if (this.identity) return this.identity;
    const { user } = await this.request<{
      user: {
        id: string;
        name: string | null;
        intro: string | null;
        location: string | null;
        timezone: string | null;
        onboarding: { profileConfirmedAt: string | null } | null;
      };
    }>("GET", "/auth/me");
    this.identity = {
      id: user.id,
      name: user.name,
      intro: user.intro ?? null,
      location: user.location ?? null,
      timezone: user.timezone ?? null,
      profileConfirmed: Boolean(user.onboarding?.profileConfirmedAt),
    };
    return this.identity;
  }

  /**
   * @param limit - How many signals to read. Defaults to 100.
   * @returns The owner's signals. `ARCHIVED` is derived from `archivedAt`, which is how removal is recorded.
   */
  async listIntents(limit = 100): Promise<IntentSummary[]> {
    const { intents } = await this.request<{
      intents: { id: string; payload: string; status: string | null; archivedAt: string | null }[];
    }>("POST", "/intents/list", { limit });
    return intents.map((intent) => ({
      id: intent.id,
      statement: intent.payload,
      status: (intent.archivedAt ? "ARCHIVED" : intent.status ?? "ACTIVE") as IntentStatus,
    }));
  }

  /**
   * @returns Open negotiations for this seat.
   */
  async listNegotiations(): Promise<Negotiation[]> {
    const { negotiations } = await this.request<{ negotiations: Negotiation[] }>("GET", "/negotiations?state=open");
    return negotiations;
  }

  /**
   * @param id - Opportunity id.
   * @returns The negotiation as this seat sees it.
   */
  async getNegotiation(id: string): Promise<NegotiationDetail> {
    const { negotiation } = await this.request<{ negotiation: NegotiationDetail }>(
      "GET", `/negotiations/${encodeURIComponent(id)}`,
    );
    return negotiation;
  }

  /**
   * @param id - Opportunity id.
   * @param turn - Action, message, and the log length it was decided against.
   * @returns The negotiation after the turn.
   */
  async submitTurn(
    id: string,
    turn: { action: NegotiationAction; message: string; expectedTurnCount: number },
  ): Promise<NegotiationDetail> {
    const { negotiation } = await this.request<{ negotiation: NegotiationDetail }>(
      "POST", this.fence(`/negotiations/${encodeURIComponent(id)}/turns`), turn,
    );
    return negotiation;
  }

  /**
   * @param intentId - Signal whose principal conversation to read.
   * @returns The agent DM slice for that signal.
   */
  async principalInbox(intentId: string): Promise<{
    conversationId: string;
    messages: ConversationMessage[];
    agent?: PersonalAgentState;
  }> {
    return this.request("GET", `/conversations/agent/messages?intentId=${encodeURIComponent(intentId)}`);
  }

  /**
   * Publish agent-authored questions and messages onto the principal conversation.
   * @param intentId - Signal.
   * @param entries - `question` and `message` entries. The API drops the rest.
   * @throws When this instance has no executor id.
   */
  async sendPrincipal(intentId: string, entries: PrincipalMessage[]): Promise<void> {
    if (!this.executorId) throw new Error("INDEX_EXECUTOR_ID is required");
    await this.request("POST", this.fence("/conversations/agent/h2a"), { intentId, entries });
  }

  /**
   * Open the user's SSE channel. Reconnects until stopped. JSON calls do not retry.
   * @param onEvent - Parsed frames the caller handles. Handshake is not delivered.
   * @returns Stop handle. After stop there is no reconnect.
   */
  events(onEvent: (event: UserEvent) => void): () => void {
    const abort = new AbortController();
    let stopped = false;
    let delay = 1000;
    let primed = false;
    const seen = new Set<string>();

    const catchUp = async () => {
      const rows = await this.listNegotiations();
      if (rows.length) {
        onEvent({
          type: "negotiation.opened",
          id: `${rows[0]!.intentId}:opened:catchup`,
          title: "",
          body: "",
          data: { intentId: rows[0]!.intentId, count: rows.length },
        });
      }
      const { conversationId, messages } = await this.request<{
        conversationId: string;
        messages: ConversationMessage[];
      }>("GET", "/conversations/agent/messages");
      for (const message of messages) {
        if (seen.has(message.id) || message.role === "agent") {
          seen.add(message.id);
          continue;
        }
        seen.add(message.id);
        if (primed) onEvent({ type: "message", conversationId, message });
      }
      primed = true;
    };

    const read = async () => {
      while (!stopped) {
        try {
          const response = await fetch(`${this.baseUrl}/api/events`, {
            headers: { "x-api-key": this.apiKey, Accept: "text/event-stream" },
            signal: abort.signal,
          });
          if (!response.ok || !response.body) throw new Error("stream");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!stopped) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";
            for (const part of parts) {
              if (part.split("\n").every((line) => line.startsWith(":"))) continue;
              const data = part.split("\n")
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trimStart())
                .join("\n");
              if (!data) continue;
              let parsed: unknown;
              try { parsed = JSON.parse(data); } catch { continue; }
              if ((parsed as { type?: string })?.type === "connected") {
                delay = 1000;
                await catchUp();
                continue;
              }
              const event = parseUserEvent(parsed);
              if (!event) continue;
              if (event.type === "message") {
                if (event.message.role === "agent" || seen.has(event.message.id)) continue;
                seen.add(event.message.id);
              }
              onEvent(event);
            }
          }
        } catch {
          if (stopped || abort.signal.aborted) return;
        }
        if (stopped) return;
        try {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, delay);
            abort.signal.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
            }, { once: true });
          });
        } catch {
          return;
        }
        delay = Math.min(delay * 2, 30_000);
      }
    };

    void read();
    return () => {
      stopped = true;
      abort.abort();
    };
  }
}
