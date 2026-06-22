import { describe, it, expect, mock } from "bun:test";
import { ChatMessageWriterAdapter } from "../chat-message-writer.adapter";

describe("ChatMessageWriterAdapter", () => {
  it("posts into the user's most-recent session and returns its sessionId", async () => {
    const chatSessionService = {
      getUserSessions: mock(async (_userId: string, _limit: number) => [
        { id: "session-recent", title: "x", updatedAt: new Date() },
        { id: "session-older", title: "y", updatedAt: new Date(0) },
      ]),
      addMessage: mock(
        async (_p: { sessionId: string; role: string; content: string }) => "msg-1",
      ),
    };

    const adapter = new ChatMessageWriterAdapter(
      chatSessionService as unknown as ConstructorParameters<
        typeof ChatMessageWriterAdapter
      >[0],
    );

    const result = await adapter.addUserMessage("user-1", "hello");

    expect(result).toEqual({ sessionId: "session-recent" });
    expect(chatSessionService.getUserSessions).toHaveBeenCalledWith("user-1", 1);
    expect(chatSessionService.addMessage).toHaveBeenCalledWith({
      sessionId: "session-recent",
      role: "user",
      content: "hello",
    });
  });

  it("returns null when the user has no chat sessions", async () => {
    const chatSessionService = {
      getUserSessions: mock(async () => []),
      addMessage: mock(async () => "msg-x"),
    };
    const adapter = new ChatMessageWriterAdapter(
      chatSessionService as unknown as ConstructorParameters<
        typeof ChatMessageWriterAdapter
      >[0],
    );

    const result = await adapter.addUserMessage("user-2", "hello");

    expect(result).toBeNull();
    expect(chatSessionService.addMessage).not.toHaveBeenCalled();
  });
});
