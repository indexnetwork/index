import { expect, test } from "bun:test";

import type { ConversationMessage, Index, Negotiation, PrincipalMessage } from "@indexnetwork/client";

import { latestBriefs, owedWork, publishActions, readConversation, runWake } from "./host.ts";
import type { Model, ModelMessage, ToolDefinition } from "./model.ts";
import type { ConversationEntry, Opportunity } from "./types.ts";
import { unansweredPrincipalMessage, wake } from "./wake.ts";

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
  expect(sent).toHaveLength(1);
  expect(sent[0]![0]).toMatchObject({ reply: true, text: "Hello!" });
  await expect(runWake(client, intent, { model: new ScriptedModel([done, done]) }))
    .rejects.toThrow("No reply to principal's direct message.");
});

/** One agent DM row carrying a principal entry, as Index stores it. */
function stored(text: string, principal: Partial<PrincipalMessage>, role: "user" | "agent" = "agent"): ConversationMessage {
  return { ...message(role, text), metadata: { principalMessage: principal } };
}

const openQuestion: ConversationEntry = { kind: "question", text: "How much are you raising?", questionId: "q-1", stalls: ["stall-1"] };

/** Carla's stall is asked by q-1; Dario's is new and asks for the same fact. */
function stalledOpportunities(): Opportunity[] {
  return [
    { id: "opp-1", counterpart: "Carla", status: "negotiating", brief: "b", decision: "continue", stall: { id: "stall-1", reason: "How much?", turnCount: 1, questionId: "q-1" } },
    { id: "opp-2", counterpart: "Dario", status: "negotiating", brief: "b", decision: "continue", stall: { id: "stall-2", reason: "Round size?", turnCount: 1 } },
  ];
}

test("link_stall attaches a new stall to the open question that asks for it, leaving nothing owed", async () => {
  const { client } = index();
  const model = new ScriptedModel([call("1", "link_stall", { questionId: "q-1", stalled: ["opp-2"] }), done]);
  const result = await wake({ user, intent, principalConversation: [openQuestion], opportunities: stalledOpportunities(), model, client });
  expect(result.actions).toEqual([{ type: "link", questionId: "q-1", stalls: ["stall-2"] }]);
  expect(result.unresolved).toEqual([]);
  expect(model.seen).toHaveLength(2);
});

test("link_stall rejects a question that is not open and a stall already asked", async () => {
  const { client } = index();
  const model = new ScriptedModel([
    call("1", "link_stall", { questionId: "q-9", stalled: ["opp-2"] }),
    call("2", "link_stall", { questionId: "q-1", stalled: ["opp-1"] }),
    call("3", "link_stall", { questionId: "q-1", stalled: ["opp-2"] }),
    call("4", "link_stall", { questionId: "q-1", stalled: ["opp-2"] }),
    done,
  ]);
  const result = await wake({ user, intent, principalConversation: [openQuestion], opportunities: stalledOpportunities(), model, client });
  expect(model.seen[1]!.at(-1)?.content).toContain("Error: No question q-9 is waiting on your principal");
  expect(model.seen[2]!.at(-1)?.content).toContain("Error: opp-1 has no stall waiting for a question.");
  expect(model.seen[4]!.at(-1)?.content).toContain("Error: opp-2 has no stall waiting for a question.");
  expect(result.actions).toEqual([{ type: "link", questionId: "q-1", stalls: ["stall-2"] }]);
  expect(result.unresolved).toEqual([]);
});

test("publishActions writes a link as a Linked entry that reads back as one", async () => {
  const { client, sent } = index();
  const log: string[] = [];
  await publishActions(client, intent.id, [{ type: "link", questionId: "q-1", stalls: ["stall-2"] }], {
    counterparts: new Map(),
    questions: new Map([["q-1", "How much are you raising?"]]),
    log: (line) => log.push(line),
  });
  expect(sent[0]).toHaveLength(1);
  expect(sent[0]![0]).toMatchObject({ kind: "message", text: "Linked: How much are you raising?", questionId: "q-1", stalls: ["stall-2"], matches: [] });
  expect(log).toEqual(["  link q-1 for stall-2"]);

  const { id: _id, createdAt: _createdAt, text, ...principal } = sent[0]![0]!;
  expect(readConversation([stored(text, principal)])).toEqual([
    { kind: "link", text: "How much are you raising?", questionId: "q-1", stalls: ["stall-2"] },
  ]);
});

/** Both stalls, the question asking for Carla's, and the link adding Dario's. */
function linkedTranscript(): ConversationMessage[] {
  const match = (opportunityId: string) => [{ opportunityId, counterparty: { id: opportunityId, name: null } }];
  return [
    { ...stored("Stall: How much?", { kind: "message", matches: match("opp-1"), stall: { turnCount: 1 } }), id: "stall-1" },
    stored("How much are you raising?", { kind: "question", questionId: "q-1", scope: "intent", matches: match("opp-1"), stalls: ["stall-1"] }),
    { ...stored("Stall: Round size?", { kind: "message", matches: match("opp-2"), stall: { turnCount: 1 } }), id: "stall-2" },
    stored("Linked: How much are you raising?", { kind: "message", matches: [], questionId: "q-1", stalls: ["stall-2"] }),
  ];
}

test("the answer to a question releases the stall linked to it", () => {
  const transcript = [...linkedTranscript(), stored("€2M", { kind: "answer", questionId: "q-1", matches: [] }, "user")];
  const carried = latestBriefs(readConversation(transcript));
  expect(carried.get("opp-2")?.stall).toMatchObject({ id: "stall-2", questionId: "q-1", answered: true });
  expect(carried.get("opp-2")?.answered).toBe(true);
});

test("expiring a question makes the stall linked to it owed again", async () => {
  const linked = latestBriefs(readConversation(linkedTranscript()));
  expect(linked.get("opp-2")?.stall).toMatchObject({ id: "stall-2", questionId: "q-1" });

  const transcript = [...linkedTranscript(), stored("Withdrawn: How much are you raising?", { kind: "expire", questionId: "q-1", matches: [] })];
  expect(latestBriefs(readConversation(transcript)).get("opp-2")?.stall?.questionId).toBeUndefined();

  const negotiation = { opportunityId: "opp-2", settledAt: null, turnCount: 1, awaitingUserId: user.id } as Negotiation;
  const before = index(linkedTranscript()).client;
  before.listIntentNegotiations = async () => [negotiation];
  expect(await owedWork(before, intent)).toEqual({ wake: false, negotiate: [] });
  const after = index(transcript).client;
  after.listIntentNegotiations = async () => [negotiation];
  expect(await owedWork(after, intent)).toEqual({ wake: true, negotiate: [] });
});
