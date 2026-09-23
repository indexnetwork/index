import { expect, test } from "bun:test";

import type { ConversationMessage, Index, PrincipalMessage } from "@indexnetwork/client";

import { publishActions, readConversation, runWake } from "./host.ts";
import type { Model, ModelMessage, ToolDefinition } from "./model.ts";
import type { ConversationEntry } from "./types.ts";
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
    listIntentNegotiations: async () => { throw new Error("Unexpected negotiation list"); },
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

test("runWake retries a silent first pass and publishes one direct reply", async () => {
  const { client, sent } = index([message("user", "Hello")]);
  const result = await runWake(client, intent, { model: new ScriptedModel([done, call("1", "reply_principal", { text: "Hello!" }), done]) });
  expect(result.actions).toEqual([{ type: "reply", text: "Hello!" }]);
  expect(sent).toHaveLength(1);
  expect(sent[0]![0]).toMatchObject({ reply: true, text: "Hello!" });
  await expect(runWake(client, intent, { model: new ScriptedModel([done, done]) }))
    .rejects.toThrow("No reply to principal's direct message.");
});
