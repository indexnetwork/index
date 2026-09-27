import { expect, test } from "bun:test";

import type { ConversationMessage, Index, NegotiationAction, NegotiationDetail, PrincipalMessage } from "@indexnetwork/client";

import { runNegotiate } from "./host.ts";
import type { Model, ModelMessage, ToolDefinition } from "./model.ts";

const intent = { id: "intent-1", statement: "Meet seed investors" };
const user = { id: "owner-1", name: "Alex", intro: null, location: null, timezone: null, profileConfirmed: true };
const opportunityId = "opp-1";
const counterpart = { intentId: "intent-2", userId: "them-1", name: "Sam", avatar: null, statement: "Investing in seed rounds" };
const RERUN = "What you stalled on is not your principal's to answer.";

function call(name: string, argument: object): ModelMessage {
  return { role: "assistant", content: null, tool_calls: [{ id: crypto.randomUUID(), type: "function", function: { name, arguments: JSON.stringify(argument) } }] };
}

const done: ModelMessage = { role: "assistant", content: "Done." };
const stall = (reason: string, suggestedAsk: string) => call("stall", { reason, suggestedAsk });
const classify = (territory: string) => call("classify_stall", { reasoning: "Because.", territory });

/** Answers negotiator runs and triage calls from separate scripts, told apart by the tools each call offers. */
class RoutedModel implements Model {
  /** The prompt of every negotiator run, in order. */
  readonly negotiations: string[] = [];
  /** How many times triage was called. */
  triages = 0;

  constructor(private readonly negotiator: ModelMessage[], private readonly triage: ModelMessage[] = []) {}

  async complete(messages: ModelMessage[], tools: ToolDefinition[] = []): Promise<ModelMessage> {
    if (tools.some((tool) => tool.function.name === "classify_stall")) {
      this.triages++;
      const reply = this.triage.shift();
      if (!reply) throw new Error("Unexpected triage call");
      return reply;
    }
    // A negotiator run's second step follows its tool call and ends it.
    if (messages.at(-1)?.role !== "user") return done;
    this.negotiations.push(messages.at(-1)!.content!);
    const reply = this.negotiator.shift();
    if (!reply) throw new Error("Unexpected negotiator call");
    return reply;
  }
}

function agentMessage(text: string): ConversationMessage {
  return {
    id: crypto.randomUUID(),
    conversationId: "conversation-1",
    senderId: "agent-1",
    role: "agent",
    parts: [{ kind: "text", text }],
    createdAt: new Date().toISOString(),
    metadata: { principalMessage: { kind: "message", matches: [{ opportunityId, counterparty: { id: counterpart.userId, name: counterpart.name } }] } },
  };
}

function index() {
  const sent: PrincipalMessage[][] = [];
  const turns: { action: NegotiationAction; message: string }[] = [];
  const detail: NegotiationDetail = {
    id: "negotiation-1",
    opportunityId,
    intentId: intent.id,
    awaitingUserId: user.id,
    outcome: null,
    settledAt: null,
    turnCount: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    counterparty: counterpart,
    turns: [{ turnIndex: 0, seatUserId: counterpart.userId, action: "propose", message: "What stage is your company at?", createdAt: new Date().toISOString() }],
    protocol: { guidance: "", availableActions: ["propose", "counter", "accept", "decline"], blockedReason: null, maxTurns: 6, messageLimit: 2000 },
  };
  const client: Index = {
    me: async () => user,
    listIntents: async () => [],
    discover: async () => { throw new Error("Unexpected discovery"); },
    createOpportunities: async () => { throw new Error("Unexpected opportunity"); },
    listNegotiations: async () => [],
    listIntentNegotiations: async () => [],
    acceptOpportunity: async () => { throw new Error("Unexpected accept"); },
    rejectOpportunity: async () => { throw new Error("Unexpected reject"); },
    getNegotiation: async () => detail,
    submitTurn: async (_id, turn) => { turns.push(turn); return undefined as never; },
    principalInbox: async () => ({
      conversationId: "conversation-1",
      messages: [agentMessage("Brief: Alex is raising a seed round."), agentMessage("Decision: continue")],
    }),
    sendPrincipal: async (_intentId, entries) => { sent.push(entries); },
    events: () => { throw new Error("Unexpected event subscription"); },
  };
  return { client, sent, turns };
}

/** @param sent - What the run wrote. @returns The one stall entry, in the shape dev writes it. */
function persistedStall(sent: PrincipalMessage[][]) {
  expect(sent).toHaveLength(1);
  expect(sent[0]).toHaveLength(1);
  const { id: _id, createdAt: _createdAt, ...rest } = sent[0]![0]!;
  return rest;
}

test("a stall about the principal is written as before, after one negotiator run", async () => {
  const { client, sent, turns } = index();
  const model = new RoutedModel([stall("They asked our stage.", "What stage is your company at?")], [classify("principal")]);
  const log: string[] = [];
  await runNegotiate(client, opportunityId, intent, { model, log: (line) => log.push(line) });

  expect(model.negotiations).toHaveLength(1);
  expect(turns).toEqual([]);
  expect(persistedStall(sent)).toEqual({
    kind: "message",
    matches: [{ opportunityId, counterparty: { id: counterpart.userId, name: counterpart.name } }],
    text: "Stall: They asked our stage.\n\nTo ask: What stage is your company at?",
    stall: { turnCount: 1 },
  });
  expect(log).toContain(`  triage ${opportunityId} principal asked`);
});

for (const territory of ["counterpart", "deferrable"] as const) {
  test(`a ${territory} stall re-runs the negotiator once and submits its turn`, async () => {
    const { client, sent, turns } = index();
    const model = new RoutedModel(
      [stall("Missing something.", "What is it?"), call("submit_turn", { action: "counter", message: "What would you want from Alex?" })],
      [classify(territory)],
    );
    const log: string[] = [];
    const result = await runNegotiate(client, opportunityId, intent, { model, log: (line) => log.push(line) });

    expect(result).toEqual({ turn: { action: "counter", message: "What would you want from Alex?" } });
    expect(model.negotiations).toHaveLength(2);
    expect(model.negotiations[0]).not.toContain(RERUN);
    expect(model.negotiations[1]).toContain(`Alex is raising a seed round.\n\n${RERUN}`);
    expect(turns).toEqual([{ action: "counter", message: "What would you want from Alex?" }]);
    expect(sent).toEqual([]);
    expect(log).toContain(`  triage ${opportunityId} ${territory} rerun_turn`);
  });
}

test("a re-run that stalls again is written as before, after exactly two negotiator runs", async () => {
  const { client, sent, turns } = index();
  const model = new RoutedModel(
    [stall("They asked for a time.", "Which Thursday works?"), stall("They insist on a time.", "Which Thursday works?")],
    [classify("deferrable")],
  );
  const log: string[] = [];
  await runNegotiate(client, opportunityId, intent, { model, log: (line) => log.push(line) });

  expect(model.negotiations).toHaveLength(2);
  expect(model.triages).toBe(1);
  expect(turns).toEqual([]);
  expect(persistedStall(sent)).toMatchObject({
    text: "Stall: They insist on a time.\n\nTo ask: Which Thursday works?",
    stall: { turnCount: 1 },
  });
  expect(persistedStall(sent).stall).toEqual({ turnCount: 1 });
  expect(log).toContain(`  triage ${opportunityId} deferrable rerun_stalled`);
});

test("a stall without suggestedAsk is not triaged", async () => {
  const { client, sent } = index();
  const model = new RoutedModel([done]);
  await runNegotiate(client, opportunityId, intent, { model });

  expect(model.triages).toBe(0);
  expect(model.negotiations).toHaveLength(1);
  expect(persistedStall(sent)).toMatchObject({
    text: "Stall: The negotiator ended without taking a turn or stating what was missing.",
    stall: { turnCount: 1 },
  });
});
