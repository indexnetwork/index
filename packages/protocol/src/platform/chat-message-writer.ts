/**
 * Protocol-side contract for inserting a user message into the user's
 * most-recently-active chat session. The backend implementation finds
 * the session and persists the message via the existing chat-message
 * insertion path.
 */
export interface ChatMessageWriter {
  /**
   * Insert a user message into the user's most-recent chat session.
   *
   * @param userId - The owning user
   * @param content - The flattened user-message text
   * @returns The sessionId written to, or `null` if the user has no chat session
   */
  addUserMessage(
    userId: string,
    content: string,
  ): Promise<{ sessionId: string } | null>;
}
