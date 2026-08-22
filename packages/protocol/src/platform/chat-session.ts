// ═══════════════════════════════════════════════════════════════════════════════
// Chat session reads
//
// Port contract (host application implements):
//   • Reads only — no method here mutates state.
//   • `getSession` returns `null` when the session does not exist OR is not owned
//     by `userId` (ownership is enforced at this boundary, not by the caller).
//   • `getSessionMessages` / `listSessions` return an empty array (never null) when
//     there is nothing to return.
//   • `limit` / `messageLimit`, when provided, cap the most-recent N rows; when
//     omitted the adapter applies its own sane default.
//   • Category contract (IND-600): `listSessions` / `getSession` expose ONLY H2A
//     conversations (orchestrator-persona sessions with the system agent as a
//     participant). H2H DMs are never exposed through this port, and A2A
//     negotiation conversations are reachable only through the negotiation
//     tools; non-H2A session IDs behave exactly like nonexistent ones.
// ═══════════════════════════════════════════════════════════════════════════════

/** One conversation, summarized (no message bodies). */
export interface ChatSessionSummary {
  sessionId: string;
  title: string | null;
  messageCount: number;
  lastMessageAt: Date | null;
  createdAt: Date;
}

export interface ChatSessionDetail extends ChatSessionSummary {
  messages: Array<{ role: string; content: string; createdAt: Date }>;
}

export interface ChatSessionReader {
  getSessionMessages(
    sessionId: string,
    limit?: number,
  ): Promise<Array<{ role: string; content: string }>>;
  listSessions(userId: string, limit?: number): Promise<ChatSessionSummary[]>;
  getSession(
    userId: string,
    sessionId: string,
    messageLimit?: number,
  ): Promise<ChatSessionDetail | null>;
}
