/** Persona literal mirrored locally so the data layer stays protocol-agnostic. */
const PERSONAL_AGENT_PERSONA = 'personal';

/**
 * Local structural type matching ChatMessageWriter from @indexnetwork/protocol.
 * Defined here to keep adapters free of cross-layer imports.
 */
interface ChatMessageWriter {
  addUserMessage(
    userId: string,
    content: string,
  ): Promise<{ sessionId: string } | null>;
}

/**
 * Minimal structural type for the parts of ChatSessionService we depend on.
 * Defined locally so this adapter does not import from the services layer.
 */
interface ChatSessionServiceLike {
  getUserSessions(
    userId: string,
    limit: number,
    persona: string,
    opts?: { excludeIntentPinned?: boolean },
  ): Promise<Array<{ id: string }>>;
  addMessage(params: {
    sessionId: string;
    role: "user" | "assistant" | "system";
    content: string;
  }): Promise<string>;
}

/**
 * Adapter implementation of ChatMessageWriter. Finds the user's most-recent
 * chat session and inserts a user message via the existing addMessage path.
 * Returns null if the user has no sessions (caller decides what to do).
 */
export class ChatMessageWriterAdapter implements ChatMessageWriter {
  constructor(private readonly chatSessionService: ChatSessionServiceLike) {}

  async addUserMessage(
    userId: string,
    content: string,
  ): Promise<{ sessionId: string } | null> {
    // The one PersonalAgent persona, excluding intent-pinned DMs: an
    // elicited answer must never land inside a signal's DM (the IntentAgent's
    // conversation memory), and the retired orchestrator rows stay read-only
    // history the server refuses to continue.
    const sessions = await this.chatSessionService.getUserSessions(
      userId,
      1,
      PERSONAL_AGENT_PERSONA,
      { excludeIntentPinned: true },
    );
    const mostRecent = sessions[0];
    if (!mostRecent) return null;

    await this.chatSessionService.addMessage({
      sessionId: mostRecent.id,
      role: "user",
      content,
    });

    return { sessionId: mostRecent.id };
  }
}
