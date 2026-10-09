import { expect, test } from "bun:test";

import type { ConversationMessage, Counterparty, CounterpartyPick, Index, Negotiation, NegotiationDetail, PrincipalMessage } from "@indexnetwork/client";

import { publishActions, readConversation, runMorning, runWake } from "./host.ts";
import type { Model, ModelMessage, ToolDefinition } from "./model.ts";
import type { ConversationEntry } from "./types.ts";
import { reach, unansweredPrincipalMessage, wake } from "./wake.ts";

const intent = { id: "intent-1", statement: "Meet collaborators" };
const user = { id: "owner-1", name: "Alex", profileConfirmed: false };

function call(id: string, name: string, argument: object): ModelMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(argument) } }],
  };
}

class ScriptedModel implements Model {
  readonly seen: ModelMessage[][] = [];

  constructor(private readonly replies: ModelMessage[]) {}

  async complete(messages: ModelMessage[], _tools?: ToolDefinition[]): Promise<ModelMessage> {
    this.seen.push([...messages]);
    const reply = this.replies.shift();
    if (!reply) throw new Error("Unexpected model call");
    return reply;
  }
}

function message(role: "user" | "agent", text: string, kind?: "answer" | "reply"): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    conversationId: "conversation-1",
    senderId: role === "user" ? user.id : "agent-1",
    role,
    parts: [{ kind: "text", text }],
    createdAt: new Date().toISOString(),
    ...(kind ? { metadata: { principalMessage: kind === "reply" ? { kind: "message", reply: true } : { kind } } } : {}),
  };
}

function index(messages: ConversationMessage[] = []) {
  const sent: PrincipalMessage[][] = [];
  const client: Index = {
    me: async () => ({ ...user, intro: null, location: null, timezone: null }),
    listIntents: async () => [],
    discover: async () => { throw new Error("Unexpected discovery"); },
    createOpportunities: async () => { throw new Error("Unexpected opportunity"); },
    listNegotiations: async () => [],
    listIntentNegotiations: async () => [],
    acceptOpportunity: async () => { throw new Error("Unexpected accept"); },
    rejectOpportunity: async () => { throw new Error("Unexpected reject"); },
    getNegotiation: async () => { throw new Error("Unexpected negotiation read"); },
    submitTurn: async () => { throw new Error("Unexpected turn"); },
    principalInbox: async () => ({ conversationId: "conversation-1", messages }),
    sendPrincipal: async (_intentId: string, entries: PrincipalMessage[]) => { sent.push(entries); },
    events: () => { throw new Error("Unexpected event subscription"); },
    listEvents: async () => { throw new Error("Unexpected event page"); },
  };
  return { client, sent };
}

const done: ModelMessage = { role: "assistant", content: "Done." };

test("an unanswered direct message is explicit, replied to once, and published as a plain message", async () => {
  const { client, sent } = index();
  const conversation = readConversation([message("user", "Hello")]);
  expect(conversation).toEqual([{ kind: "user", text: "Hello" }]);
  expect(unansweredPrincipalMessage(conversation)).toEqual({ text: "Hello" });

  const model = new ScriptedModel([
    call("0", "note_principal", { text: "An unnecessary note" }),
    call("1", "reply_principal", { text: "Hello!" }),
    done,
  ]);
  const result = await wake({ user, intent, principalConversation: conversation, opportunities: [], model, client });
  expect(model.seen[0]![1]!.content).toContain('"unansweredMessage":{"text":"Hello"}');
  expect(result.actions).toEqual([{ type: "reply", text: "Hello!" }]);

  const log: string[] = [];
  await publishActions(client, intent.id, result.actions, { counterparts: new Map(), log: (line) => log.push(line) });
  expect(sent).toHaveLength(1);
  expect(sent[0]).toHaveLength(1);
  expect(sent[0]![0]).toMatchObject({ kind: "message", reply: true, text: "Hello!", matches: [] });
  expect(readConversation([message("user", "Hello"), message("agent", "Hello!", "reply")]).at(-1)?.kind).toBe("reply");
  expect(readConversation([message("user", "Hello"), message("agent", "Progress: here's where we stand", "reply")]).at(-1)?.kind).toBe("reply");
  expect(log).toEqual(["  reply: Hello!"]);
});

test("reply_principal rejects a second reply and a wake with no unanswered message", async () => {
  const { client } = index();
  const conversation: ConversationEntry[] = [{ kind: "user", text: "Hello" }];
  const model = new ScriptedModel([
    call("1", "reply_principal", { text: "Hello!" }),
    call("2", "reply_principal", { text: "Again!" }),
    done,
  ]);
  const result = await wake({ user, intent, principalConversation: conversation, opportunities: [], model, client });
  expect(result.actions).toEqual([{ type: "reply", text: "Hello!" }]);
  expect(model.seen[2]!.at(-1)?.content).toContain("Error: You already replied");

  const absent = new ScriptedModel([call("3", "reply_principal", { text: "Hello!" }), done]);
  const silent = await wake({ user, intent, principalConversation: [], opportunities: [], model: absent, client });
  expect(silent.actions).toEqual([]);
  expect(absent.seen[1]!.at(-1)?.content).toContain("Error: No unanswered direct message");
});

test("only a direct reply closes a direct message; a question answer is not one", () => {
  const pending = [{ kind: "user", text: "Hello" }] as ConversationEntry[];
  expect(unansweredPrincipalMessage(readConversation([message("user", "Hello"), message("agent", "Working")]))).toEqual({ text: "Hello" });
  expect(unansweredPrincipalMessage([...pending, { kind: "question", text: "Why?" }])).toEqual({ text: "Hello" });
  expect(unansweredPrincipalMessage([...pending, { kind: "progress", text: "Working" }])).toEqual({ text: "Hello" });
  expect(unansweredPrincipalMessage(readConversation([message("user", "Hello"), message("agent", "Hello!", "reply")]))).toBeNull();
  expect(unansweredPrincipalMessage(readConversation([message("user", "Hello"), message("user", "Yes", "answer")]))).toBeNull();
});

test("reject_opportunity records the verdict and the reply reports it", async () => {
  const { client } = index();
  const rejected: string[] = [];
  client.rejectOpportunity = async (id) => {
    rejected.push(id);
    return { opportunityId: id, status: "rejected" };
  };
  const opportunity = { id: "opp-1", counterpart: "Sean", status: "pending" };
  const model = new ScriptedModel([
    call("1", "reject_opportunity", { opportunityId: "opp-1" }),
    call("2", "reply_principal", { text: "Opportunity rejected: opp-1." }),
    done,
  ]);
  const result = await wake({
    user,
    intent,
    principalConversation: [{ kind: "user", text: "reject sean" }],
    opportunities: [opportunity],
    model,
    client,
  });
  expect(rejected).toEqual(["opp-1"]);
  expect(model.seen[1]!.at(-1)?.content).toBe("Opportunity rejected: opp-1.");
  expect(result.actions).toEqual([{ type: "reply", text: "Opportunity rejected: opp-1." }]);
});

test("runWake retries a silent first pass and publishes one direct reply", async () => {
  const { client, sent } = index([message("user", "Hello")]);
  const result = await runWake(client, intent, { model: new ScriptedModel([done, call("1", "reply_principal", { text: "Hello!" }), done]) });
  expect(result.actions).toEqual([{ type: "reply", text: "Hello!" }]);
  expect(sent.flat().filter((entry) => entry.reply)).toMatchObject([{ reply: true, text: "Hello!" }]);
  await expect(runWake(client, intent, { model: new ScriptedModel([done, done]) }))
    .rejects.toThrow("No reply to principal's direct message.");
});

const since = "2026-10-07T08:00:00.000Z";

function negotiation(opportunityId: string, userId: string, settled = false): Negotiation {
  return {
    id: opportunityId, opportunityId, intentId: intent.id, awaitingUserId: "them", outcome: settled ? "rejected" : null,
    settledAt: settled ? since : null, turnCount: 1, createdAt: since, updatedAt: since,
    counterparty: { intentId: `${userId}-signal`, userId, name: userId, avatar: null, statement: "Building tools" },
  } as Negotiation;
}

function counterparty(userId: string): Counterparty {
  return { intentId: `${userId}-signal`, userId, name: userId, statement: "Building tools", networkId: "network-1", score: 0.5 };
}

function stall(opportunityId: string): ConversationMessage {
  return {
    ...message("agent", "Stall: Their budget is unknown."),
    metadata: { principalMessage: { kind: "message", matches: [{ opportunityId, counterparty: { id: "u2", name: "u2" } }], stall: { turnCount: 1 } } },
  };
}

/** A signal that searched once, with one negotiation still open. */
function morning(messages: ConversationMessage[] = [message("agent", `Progress: ${JSON.stringify({ plan: "p", queries: ["toolmakers"], discovered: 1, reached: 1 })}`)]) {
  const { client, sent } = index(messages);
  const discovered: { query: string; since?: string }[] = [];
  const picked: CounterpartyPick[][] = [];
  const open = [negotiation("opp-1", "u2")];
  client.listIntentNegotiations = async () => open;
  client.discover = async (_intentId, query, _limit, after) => {
    discovered.push({ query, ...(after ? { since: after } : {}) });
    return [];
  };
  client.createOpportunities = async (_intentId, picks) => {
    picked.push(picks);
    return picks.map((pick) => ({ opportunityId: `opp-${pick.intentId}` }));
  };
  client.getNegotiation = async (id) => ({
    ...open.find((item) => item.opportunityId === id)!,
    turns: [],
    protocol: { guidance: "", availableActions: ["propose"], blockedReason: null, maxTurns: 6, messageLimit: 1000 },
  } as NegotiationDetail);
  return { client, sent, discovered, picked, open };
}

test("a morning with nobody new and nothing owed reruns the saved queries and calls no model", async () => {
  const { client, discovered, picked } = morning();
  expect(await runMorning(client, intent, { model: new ScriptedModel([]), since })).toBeNull();
  expect(discovered).toEqual([{ query: "toolmakers", since }]);
  expect(picked).toEqual([]);
});

test("a morning opens a new arrival without the model and starts their negotiator", async () => {
  const { client, sent, picked } = morning();
  client.discover = async () => [counterparty("u3")];
  const started: string[] = [];
  expect(await runMorning(client, intent, { model: new ScriptedModel([]), since, onNegotiate: (id) => started.push(id) })).toBeNull();
  expect(picked).toEqual([[{ intentId: "u3-signal", networkId: "network-1" }]]);
  expect(started).toEqual(["opp-u3-signal"]);
  expect(sent.flat().map((entry) => entry.text)).toEqual([
    `Progress: ${JSON.stringify({ plan: "Good morning: reaching out to people who joined since the last morning.", queries: ["toolmakers"], discovered: 1, reached: 1 })}`,
  ]);
});

test("a morning with nothing open wakes the model, which may discover with new queries", async () => {
  const { client, discovered, open } = morning([]);
  open[0] = negotiation("opp-1", "u2", true);
  const model = new ScriptedModel([call("1", "reach_counterparties", { plan: "Reaching out to designers.", queries: ["designers"] }), done]);
  await runMorning(client, intent, { model });
  expect(model.seen).toHaveLength(2);
  expect(model.seen[0]![1]!.content).toContain('"opportunities":[]');
  expect(discovered).toEqual([{ query: "designers" }]);
});

test("a morning with a stall still owed wakes the model", async () => {
  const { client } = morning([stall("opp-1")]);
  const model = new ScriptedModel([done, done]);
  await runMorning(client, intent, { model, since }).catch(() => null);
  expect(model.seen.length).toBeGreaterThan(0);
});

test("reach skips anyone the owner already negotiates with on any signal", async () => {
  const { client, picked } = morning();
  client.listIntents = async () => [{ id: "intent-2", statement: "Hire", status: "active" }];
  client.listIntentNegotiations = async (id) => (id === "intent-2" ? [negotiation("opp-9", "u4")] : []);
  client.discover = async () => [counterparty("u4"), counterparty("u5")];
  expect(await reach(client, intent, ["toolmakers"])).toEqual({ found: 2, picked: 1, opened: ["opp-u5-signal"] });
  expect(picked).toEqual([[{ intentId: "u5-signal", networkId: "network-1" }]]);
});
