/**
 * Protocol-side contract for reading a chat session's current digest. The
 * backend implementation (ChatSummaryService) handles persistence and
 * incremental summarization; the protocol layer only sees this shape.
 */
import type { ChatContextDigest } from "../schemas/chat-context.schema.js";

export interface ChatSummaryReader {
  /**
   * Returns the freshest digest for the session, running incremental
   * summarization if there are new messages.
   *
   * @returns the digest, or `null` when the session has no messages or
   *   when summarization fails on a session that has no prior digest.
   */
  getDigest(sessionId: string): Promise<ChatContextDigest | null>;
}
