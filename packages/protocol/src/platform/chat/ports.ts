import type { ChatContextDigest } from "../../protocol/schemas/chat-context.schema.js";
import type { StructuredQuestion } from "../../protocol/schemas/structured-question.schema.js";

/** Host reads of H2A chat sessions. */
export interface ChatSessionSummary { sessionId: string; title: string | null; messageCount: number; lastMessageAt: Date | null; createdAt: Date; }
export interface ChatSessionDetail extends ChatSessionSummary { messages: Array<{ role: string; content: string; createdAt: Date }>; }
export interface ChatSessionReader {
  getSessionMessages(sessionId: string, limit?: number): Promise<Array<{ role: string; content: string }>>;
  listSessions(userId: string, limit?: number): Promise<ChatSessionSummary[]>;
  getSession(userId: string, sessionId: string, messageLimit?: number): Promise<ChatSessionDetail | null>;
}

/** Host writer for a user's most-recent chat session. */
export interface ChatMessageWriter { addUserMessage(userId: string, content: string): Promise<{ sessionId: string } | null>; }

/** Host reader for an incrementally maintained chat digest. */
export interface ChatSummaryReader { getDigest(sessionId: string): Promise<ChatContextDigest | null>; }

/** Delivers a negotiation clarification as an assistant message in its owner's chat. */
export interface InChatNegotiationQuestionDelivery {
  deliver(input: {
    ownerUserId: string;
    ownerIntentId: string;
    opportunityId: string;
    negotiationTaskId: string;
    settlementId: string;
    question: StructuredQuestion;
  }): Promise<void>;
}
