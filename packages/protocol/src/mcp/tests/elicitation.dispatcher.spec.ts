import { describe, it, expect, mock } from "bun:test";
import { dispatchElicitations } from "../elicitation.dispatcher.js";
import type { Question } from "../../shared/schemas/question.schema.js";
import type { ChatMessageWriter } from "../../shared/interfaces/chat-message-writer.interface.js";

const q1: Question = {
  title: "Stage",
  prompt: "Are you pre- or post-revenue?",
  options: [
    { label: "Pre-revenue (Recommended)", description: "No paying customers yet." },
    { label: "Post-revenue", description: "At least one paying customer." },
  ],
  multiSelect: false,
};

const q2: Question = {
  title: "Timing",
  prompt: "When do you need a co-founder in place?",
  options: [
    { label: "In the next month", description: "Urgent." },
    { label: "In the next quarter", description: "Soon." },
  ],
  multiSelect: false,
};

function makeWriter(): ChatMessageWriter & {
  calls: Array<{ userId: string; content: string }>;
} {
  const calls: Array<{ userId: string; content: string }> = [];
  return {
    calls,
    async addUserMessage(userId, content) {
      calls.push({ userId, content });
      return { sessionId: "session-1" };
    },
  };
}

describe("dispatchElicitations", () => {
  it("dispatches one elicitInput per question sequentially and posts accepts", async () => {
    const elicitations: unknown[] = [];
    // Reply with a label valid for whichever question is being asked, so
    // flattenChoice's enum validation accepts both.
    const replies = [
      { action: "accept" as const, content: { choice: "Pre-revenue (Recommended)" } },
      { action: "accept" as const, content: { choice: "In the next month" } },
    ];
    let i = 0;
    const elicitInput = mock(async (params: unknown) => {
      elicitations.push(params);
      return replies[i++];
    });
    const writer = makeWriter();

    await dispatchElicitations({
      userId: "u-1",
      questions: [q1, q2],
      elicitInput,
      chatMessageWriter: writer,
    });

    expect(elicitInput).toHaveBeenCalledTimes(2);
    expect((elicitations[0] as { message: string }).message).toBe(
      "Stage: Are you pre- or post-revenue?",
    );
    expect((elicitations[1] as { message: string }).message).toBe(
      "Timing: When do you need a co-founder in place?",
    );
    expect(writer.calls).toHaveLength(2);
    expect(writer.calls[0].content).toBe(
      "Stage (Are you pre- or post-revenue?): Pre-revenue (Recommended)",
    );
    expect(writer.calls[1].content).toBe(
      "Timing (When do you need a co-founder in place?): In the next month",
    );
  });

  it("decline is a no-op but continues to next question", async () => {
    const elicitInput = mock(async (_params: unknown) => ({
      action: "decline" as const,
    }));
    const writer = makeWriter();

    await dispatchElicitations({
      userId: "u-1",
      questions: [q1, q2],
      elicitInput,
      chatMessageWriter: writer,
    });

    expect(elicitInput).toHaveBeenCalledTimes(2);
    expect(writer.calls).toHaveLength(0);
  });

  it("cancel stops the loop", async () => {
    const elicitInput = mock(async (_params: unknown) => ({
      action: "cancel" as const,
    }));
    const writer = makeWriter();

    await dispatchElicitations({
      userId: "u-1",
      questions: [q1, q2],
      elicitInput,
      chatMessageWriter: writer,
    });

    expect(elicitInput).toHaveBeenCalledTimes(1);
    expect(writer.calls).toHaveLength(0);
  });

  it("a transport throw stops the loop", async () => {
    let callCount = 0;
    const elicitInput = mock(async (_params: unknown) => {
      callCount += 1;
      throw new Error("transport-fail");
    });
    const writer = makeWriter();

    await dispatchElicitations({
      userId: "u-1",
      questions: [q1, q2],
      elicitInput,
      chatMessageWriter: writer,
    });

    expect(callCount).toBe(1);
    expect(writer.calls).toHaveLength(0);
  });

  it("accept with empty multi-select array is treated as unanswered (no post)", async () => {
    const multiQ: Question = { ...q1, multiSelect: true };
    const elicitInput = mock(async (_params: unknown) => ({
      action: "accept" as const,
      content: { choice: [] },
    }));
    const writer = makeWriter();

    await dispatchElicitations({
      userId: "u-1",
      questions: [multiQ],
      elicitInput,
      chatMessageWriter: writer,
    });

    expect(writer.calls).toHaveLength(0);
  });

  it("no-op when questions is empty", async () => {
    const elicitInput = mock(async (_params: unknown) => ({ action: "accept" as const }));
    const writer = makeWriter();

    await dispatchElicitations({
      userId: "u-1",
      questions: [],
      elicitInput,
      chatMessageWriter: writer,
    });

    expect(elicitInput).not.toHaveBeenCalled();
    expect(writer.calls).toHaveLength(0);
  });

  it("no-op when chatMessageWriter is undefined (elicitations still dispatched)", async () => {
    const elicitInput = mock(async (_params: unknown) => ({
      action: "accept" as const,
      content: { choice: "Pre-revenue (Recommended)" },
    }));

    await dispatchElicitations({
      userId: "u-1",
      questions: [q1],
      elicitInput,
      // chatMessageWriter omitted entirely — should compile against the
      // optional-typed param and run the absent-writer warn path.
    });

    expect(elicitInput).toHaveBeenCalledTimes(1);
  });

  it("malformed elicit reply (null / unknown shape) is treated as no-op and loop continues", async () => {
    const replies: unknown[] = [
      null,
      { action: "accept", content: { choice: "In the next month" } },
    ];
    let i = 0;
    // Cast to ElicitInputFn — runtime returns deliberately bogus shapes
    // to exercise the validation guard.
    const elicitInput = mock(async (_params: unknown) => replies[i++]) as unknown as Parameters<
      typeof dispatchElicitations
    >[0]["elicitInput"];
    const writer = makeWriter();

    await dispatchElicitations({
      userId: "u-1",
      questions: [q1, q2],
      elicitInput,
      chatMessageWriter: writer,
    });

    // Both elicitations dispatched; null reply continues without writing,
    // second valid accept writes once.
    expect(i).toBe(2);
    expect(writer.calls).toHaveLength(1);
    expect(writer.calls[0].content).toBe(
      "Timing (When do you need a co-founder in place?): In the next month",
    );
  });

  it("unknown action (not accept/decline/cancel) is treated as no-op, not as accept", async () => {
    // Even with a valid-looking `content.choice`, an unknown action must
    // not write anything. Guards against forwards-incompatible MCP servers
    // and against non-conformant clients trying to spoof acceptance.
    const replies: unknown[] = [
      { action: "maybe-later", content: { choice: "Pre-revenue (Recommended)" } },
    ];
    let i = 0;
    const elicitInput = mock(async (_params: unknown) => replies[i++]) as unknown as Parameters<
      typeof dispatchElicitations
    >[0]["elicitInput"];
    const writer = makeWriter();

    await dispatchElicitations({
      userId: "u-1",
      questions: [q1],
      elicitInput,
      chatMessageWriter: writer,
    });

    expect(writer.calls).toHaveLength(0);
  });

  it("addUserMessage returning null does not halt subsequent elicitations", async () => {
    const replies = [
      { action: "accept" as const, content: { choice: "Pre-revenue (Recommended)" } },
      { action: "accept" as const, content: { choice: "In the next month" } },
    ];
    let i = 0;
    const elicitInput = mock(async (_params: unknown) => replies[i++]);
    const writeCalls: Array<{ userId: string; content: string }> = [];
    // Writer that always returns null — user has no chat session.
    const writer: ChatMessageWriter = {
      async addUserMessage(userId, content) {
        writeCalls.push({ userId, content });
        return null;
      },
    };

    await dispatchElicitations({
      userId: "u-1",
      questions: [q1, q2],
      elicitInput,
      chatMessageWriter: writer,
    });

    // Both elicitations dispatched, both writes attempted, but null returns
    // don't break the loop.
    expect(elicitInput).toHaveBeenCalledTimes(2);
    expect(writeCalls).toHaveLength(2);
  });

  it("addUserMessage throwing does not halt subsequent elicitations", async () => {
    const replies = [
      { action: "accept" as const, content: { choice: "Pre-revenue (Recommended)" } },
      { action: "accept" as const, content: { choice: "In the next month" } },
    ];
    let i = 0;
    const elicitInput = mock(async (_params: unknown) => replies[i++]);
    let writeAttempts = 0;
    const writer: ChatMessageWriter = {
      async addUserMessage(_userId, _content) {
        writeAttempts += 1;
        throw new Error("db-down");
      },
    };

    await dispatchElicitations({
      userId: "u-1",
      questions: [q1, q2],
      elicitInput,
      chatMessageWriter: writer,
    });

    // Both writes attempted even though the first one threw — the catch
    // logs and continues rather than aborting.
    expect(elicitInput).toHaveBeenCalledTimes(2);
    expect(writeAttempts).toBe(2);
  });
});
