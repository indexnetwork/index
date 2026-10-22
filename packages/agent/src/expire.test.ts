import { describe, expect, test } from "bun:test";

import type { ConversationMessage, Index, PrincipalMessage } from "@indexnetwork/client";

import { expireUnanswered, latestBriefs, owedWork, readConversation } from "./host.ts";

const HOUR = 3_600_000;
const now = new Date("2026-01-10T00:00:00Z");
const match = { opportunityId: "o1", counterparty: { id: "c", name: "Counterpart" } };

function message(id: string, hoursAgo: number, text: string, principalMessage: Record<string, unknown>): ConversationMessage {
  return {
    id, conversationId: "dm", senderId: "agent", role: "agent", parts: [{ kind: "text", text }],
    createdAt: new Date(now.getTime() - hoursAgo * HOUR).toISOString(), metadata: { principalMessage },
  };
}

function fakeIndex(questionHoursAgo: number) {
  const inbox = [
    message("b1", 100, "Wants a design partner.", { kind: "message", record: "brief", matches: [match] }),
    message("d1", 100, "continue", { kind: "message", record: "decision", matches: [match] }),
    message("s1", 99, "Budget unknown.", { kind: "message", record: "stall", stall: { turnCount: 2 }, matches: [match] }),
    message("q1", questionHoursAgo, "What is your budget?", { kind: "question", questionId: "q1", stalls: ["s1"], matches: [match] }),
  ];
  const negotiation = { opportunityId: "o1", intentId: "i", awaitingUserId: "u", settledAt: null, turnCount: 2, counterparty: { userId: "c", name: "Counterpart" } };
  const client = {
    me: async () => ({ id: "u" }),
    listIntentNegotiations: async () => [negotiation],
    principalInbox: async () => ({ messages: inbox }),
    sendPrincipal: async (_intentId: string, entries: PrincipalMessage[]) => {
      for (const { id, text, ...rest } of entries) inbox.push(message(id, 0, text, rest));
    },
  } as unknown as Index;
  return { client, inbox };
}

describe("expireUnanswered", () => {
  test("withdraws an overdue question and releases its negotiation with the brief saying so", async () => {
    const { client, inbox } = fakeIndex(80);
    expect(await expireUnanswered(client, { id: "i", statement: "" }, 72 * HOUR, now)).toEqual(["o1"]);

    const carried = latestBriefs(readConversation(inbox)).get("o1");
    expect(carried?.stall).toBeUndefined();
    expect(carried?.brief).toContain("did not answer: What is your budget?");
    expect(inbox.some((entry) => (entry.metadata as { principalMessage: { kind: string } }).principalMessage.kind === "expire")).toBe(true);
    expect((await owedWork(client, { id: "i", statement: "" })).negotiate).toEqual(["o1"]);
    expect(await expireUnanswered(client, { id: "i", statement: "" }, 72 * HOUR, now)).toEqual([]);
  });

  test("leaves a question still within its time", async () => {
    const { client, inbox } = fakeIndex(10);
    expect(await expireUnanswered(client, { id: "i", statement: "" }, 72 * HOUR, now)).toEqual([]);
    expect(inbox).toHaveLength(4);
  });
});
