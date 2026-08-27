import { describe, expect, test } from "bun:test";
import type { NegotiationDecision } from "../../core/types.ts";
import { decisionToMessage, historyFromMessages, messageToDecision } from "./history.ts";
import type { A2AMessage } from "./types.ts";

describe("history helpers", () => {
  test("decisionToMessage round-trips through messageToDecision", () => {
    const decision: NegotiationDecision = { action: "counter", message: "Let's meet at $400." };
    const message = decisionToMessage(decision, "agent", { taskId: "t1", contextId: "c1" });

    expect(message.role).toBe("agent");
    expect(message.taskId).toBe("t1");
    expect(messageToDecision(message)).toEqual(decision);
  });

  test("historyFromMessages flips role based on viewpoint", () => {
    const messages: A2AMessage[] = [
      decisionToMessage({ action: "propose", message: "Offer A" }, "user"),
      decisionToMessage({ action: "counter", message: "Offer B" }, "agent"),
    ];

    expect(historyFromMessages(messages, "server")).toEqual([
      { role: "incoming", content: "Offer A" },
      { role: "outgoing", content: "Offer B" },
    ]);
    expect(historyFromMessages(messages, "client")).toEqual([
      { role: "outgoing", content: "Offer A" },
      { role: "incoming", content: "Offer B" },
    ]);
  });
});
