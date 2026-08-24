import { conversationDatabaseAdapter } from './database.adapter';

/** Persona literal mirrored locally so the data layer stays protocol-agnostic. */
const PERSONAL_AGENT_PERSONA = 'personal';

export class ChatSessionAdapter {
  async getSessionMessages(sessionId: string, limit?: number): Promise<Array<{ role: string; content: string }>> {
    const rows = limit
      ? await conversationDatabaseAdapter.getLatestChatSessionMessages(sessionId, limit)
      : await conversationDatabaseAdapter.getChatSessionMessages(sessionId);
    return rows.map((m) => ({ role: m.role, content: m.content }));
  }

  // Scoped to the one PersonalAgent persona, excluding intent-pinned DMs:
  // a signal's DM transcript is read through its signal surface, never
  // through a generic session reader.
  listSessions(userId: string, limit = 25) {
    return conversationDatabaseAdapter.listChatSessionSummaries(
      userId,
      limit,
      PERSONAL_AGENT_PERSONA,
      { excludeIntentPinned: true },
    );
  }

  getSession(userId: string, sessionId: string, messageLimit = 50) {
    return conversationDatabaseAdapter.getChatSessionDetail(
      userId,
      sessionId,
      messageLimit,
      PERSONAL_AGENT_PERSONA,
      { excludeIntentPinned: true },
    );
  }
}

export const chatSessionAdapter = new ChatSessionAdapter();
