import { conversationDatabaseAdapter } from './database.adapter';

export class ChatSessionAdapter {
  async getSessionMessages(sessionId: string, limit?: number): Promise<Array<{ role: string; content: string }>> {
    const rows = await conversationDatabaseAdapter.getChatSessionMessages(sessionId, limit);
    return rows.map((m) => ({ role: m.role, content: m.content }));
  }

  listSessions(userId: string, limit?: number) {
    return conversationDatabaseAdapter.listChatSessionSummaries(userId, limit);
  }

  getSession(userId: string, sessionId: string, messageLimit?: number) {
    return conversationDatabaseAdapter.getChatSessionDetail(userId, sessionId, messageLimit);
  }
}

export const chatSessionAdapter = new ChatSessionAdapter();
