import { afterAll, describe, expect, it, mock } from "bun:test";

let capturedMessages: Array<{ content?: unknown }> = [];

mock.module("../../shared/agent/model.config", () => ({
  createStructuredModel: () => ({
    invoke: (messages: Array<{ content?: unknown }>) => {
      capturedMessages = messages;
      return Promise.resolve({
        message:
          "We both attended the same session. I am building privacy tooling and would enjoy comparing notes.",
      });
    },
  }),
}));

const { generateInviteMessage } = await import("../contact.inviter.js");

afterAll(() => mock.restore());

describe("generateInviteMessage claim safety", () => {
  it("sanitizes prompt context and generated invite output", async () => {
    const result = await generateInviteMessage({
      recipientName: "Alice",
      senderName: "Bob",
      opportunityInterpretation:
        "Alice and Bob attended the same event.",
      senderIntents: ["Build privacy tooling"],
      recipientIntents: ["Review privacy tooling"],
    });

    const systemContent = String(capturedMessages[0]?.content ?? "");
    const humanContent = String(capturedMessages[1]?.content ?? "");
    expect(systemContent).toContain("NEVER proof");
    expect(humanContent).not.toContain("attended");
    expect(humanContent).toContain(
      "Their current goals may be relevant to each other.",
    );
    expect(result.message).toBe(
      "I am building privacy tooling and would enjoy comparing notes.",
    );
  });
});
