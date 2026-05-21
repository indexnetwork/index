import { describe, it, expect } from "bun:test";
import { ChatStreamer } from "../chat.streamer.js";

describe("ChatStreamer — decision_questions relay", () => {
  it("forwards a custom decision_questions writer event as a typed stream event", async () => {
    const fakeGraph = {
      async *stream(_initial: unknown, _opts: unknown) {
        yield ["custom", { type: "decision_questions", questions: [{ title: "T", prompt: "P?", options: [{ label: "a", description: "x" }, { label: "b", description: "y" }], multiSelect: false }] }];
        yield ["updates", { agent_loop: { responseText: "ok", debugMeta: { graph: "agent_loop", iterations: 1 } } }];
      },
    };
    const streamer = new ChatStreamer(async () => [], () => fakeGraph as never);
    const events: Array<{ type?: string }> = [];
    for await (const ev of streamer.streamChatEvents({ userId: "u", messages: [] }, "s-1")) {
      events.push(ev);
    }
    const decisionEvents = events.filter((e) => e.type === "decision_questions");
    expect(decisionEvents).toHaveLength(1);
  });
});
