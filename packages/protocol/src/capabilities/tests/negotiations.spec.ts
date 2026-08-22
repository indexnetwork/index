import { config } from "dotenv";
import { describe, expect, test } from "bun:test";

import type { UserNegotiationContext } from "../../internal/negotiations/negotiation.state.js";
import { createModel } from "../../internal/shared/agent/model.config.js";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Negotiations } from "../negotiations.js";

// This spec is intentionally a live evaluation. Package scripts execute from
// packages/protocol, while credentials live at the repository root.
config({ path: new URL("../../../../../.env.test", import.meta.url).pathname, override: true });

const HAS_OPENROUTER_KEY = Boolean(process.env.OPENROUTER_API_KEY);

const alice: UserNegotiationContext = {
  id: "alice",
  intents: [{
    id: "alice-intent",
    title: "Find a technical co-founder",
    description: "Looking for an ML engineer to co-found a New York developer-tools company.",
    confidence: 1,
  }],
  profile: { name: "Alice", bio: "Founder building developer tools in New York", skills: ["product", "fundraising"] },
};

const bob: UserNegotiationContext = {
  id: "bob",
  intents: [{
    id: "bob-intent",
    title: "Join an early-stage developer-tools startup",
    description: "ML engineer seeking a New York co-founder role; available Tuesday evenings for an initial conversation.",
    confidence: 1,
  }],
  profile: { name: "Bob", bio: "ML engineer with production LLM experience", skills: ["ML", "distributed systems"] },
};

const casey: UserNegotiationContext = {
  id: "casey",
  intents: [{ id: "casey-intent", title: "Find a ceramic studio", description: "Looking for a shared ceramics workspace in New York.", confidence: 1 }],
  profile: { name: "Casey", bio: "Ceramic artist", skills: ["ceramics"] },
};

const context = { networkId: "test-network", prompt: "New York founders and technical co-founders" };
const assessment = { reasoning: "Alice needs a technical co-founder and Bob is an experienced ML engineer seeking that role.", valencyRole: "peer" };

class FakePersonalChat {
  readonly messages: Array<{
    role: "assistant" | "user";
    content: string;
    decisionQuestion?: { title: string; prompt: string };
  }> = [];

}

type FakeTask = {
  id: string;
  conversationId: string;
  state: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

type QuestionDelivery = {
  ownerUserId: string;
  ownerIntentId: string;
  opportunityId: string;
  negotiationTaskId: string;
  settlementId: string;
  question: { title: string; prompt: string };
};

/** In-memory host implementing the ports a real `Negotiations` capability uses. */
class FakeNegotiationHost {
  readonly opportunity = { id: "opportunity-1", status: "latent", updatedAt: new Date("2026-08-22T00:00:00Z") };
  readonly timeline: Array<{ at: number; kind: string; detail: unknown }> = [];
  readonly messages: Array<Record<string, unknown>> = [];
  readonly tasks = new Map<string, FakeTask>();
  readonly aliceChat = new FakePersonalChat();
  readonly bobChat = new FakePersonalChat();
  private taskCounter = 0;
  private delivery: QuestionDelivery | null = null;

  constructor(private readonly chatContext: Record<string, string> = {
    [alice.id]: "I want a New York technical co-founder, but I have not yet decided whether I can make time for an initial meeting this month.",
    [bob.id]: "I am interested in a New York developer-tools co-founder role, but I need to decide whether I can commit time to an initial meeting this month.",
  }) {}

  pendingQuestionOwner(): string {
    if (!this.delivery) throw new Error("No chat question was delivered");
    return this.delivery.ownerUserId;
  }

  readonly database = {
    getOrCreateDM: async () => ({ id: "conversation-1" }),
    getMessagesForConversation: async () => this.messages,
    getNegotiationMessages: async () => this.messages,
    getNegotiationTaskForOpportunity: async () => [...this.tasks.values()].find((task) => task.metadata?.opportunityId === this.opportunity.id) ?? null,
    getLatestNegotiationTaskForConversation: async () => null,
    createNegotiationTaskForAttempt: async (input: { conversationId: string; metadata: Record<string, unknown> }) => this.createTask(input.conversationId, input.metadata),
    createTask: async (conversationId: string, metadata: Record<string, unknown>) => this.createTask(conversationId, metadata),
    updateOpportunityStatus: async (_id: string, status: string) => ({ id: this.opportunity.id, status }),
    createMessage: async (input: { conversationId: string; senderId: string; role: string; parts: unknown[]; taskId?: string }) => {
      const message = { id: `message-${this.messages.length + 1}`, ...input, createdAt: new Date() };
      this.messages.push(message);
      this.timeline.push({ at: Date.now(), kind: "a2a", detail: message });
      return message;
    },
    updateTaskState: async (id: string, state: string) => { const task = this.tasks.get(id)!; task.state = state; return task; },
    createArtifact: async () => ({ id: "artifact-1" }),
    setTaskTurnContext: async () => {},
    getUserContext: async () => ({ text: "Alice wants a New York technical co-founder." }),
    getTasksForUser: async () => [],
    getArtifactsForTask: async () => [],
    getOpportunityUserAnswers: async () => [],
    getTask: async (id: string) => this.tasks.get(id) ?? null,
    captureNegotiationAskUserBinding: async (input: { taskId: string; settlementId: string; recipientUserId: string; recipientIntentId: string; opportunityId: string; networkId: string }) => {
      const task = this.tasks.get(input.taskId)!;
      task.metadata.questionSettlement = { settlementId: input.settlementId, taskId: input.taskId };
      return { version: 2, settlementId: input.settlementId, recipientUserId: input.recipientUserId, recipientIntentId: input.recipientIntentId, opportunityId: input.opportunityId, networkId: input.networkId, intentFingerprint: "fingerprint", opportunityStatus: "negotiating", opportunityUpdatedAt: this.opportunity.updatedAt.toISOString(), counterpartyUserId: bob.id, counterpartyIntentId: bob.intents[0].id };
    },
  };
  readonly dispatcher = { hasExternalAgent: async () => false, dispatch: async () => {
    return { handled: false, reason: "no_agent" as const };
  }};
  readonly clientDmRetrieve = async ({ userId }: { userId: string }) => [{
    role: "client" as const,
    content: this.chatContext[userId] ?? "",
  }];
  readonly timeoutQueue = { enqueueTimeout: async () => "timeout", cancelTimeout: async () => {}, enqueueAskUserExpiry: async () => "ask-timeout", cancelAskUserExpiry: async () => {} };
  readonly deliveryPort = { deliver: async (input: QuestionDelivery) => {
    this.delivery = input;
    const chat = input.ownerUserId === alice.id ? this.aliceChat : this.bobChat;
    chat.messages.push({ role: "assistant", content: input.question.prompt, decisionQuestion: { title: input.question.title, prompt: input.question.prompt } });
    this.timeline.push({ at: Date.now(), kind: `${input.ownerUserId}-chat-assistant`, detail: chat.messages.at(-1) });
  }};

  private createTask(conversationId: string, metadata: Record<string, unknown>): FakeTask {
    const task = { id: `task-${++this.taskCounter}`, conversationId, state: "submitted", metadata, createdAt: new Date(), updatedAt: new Date() };
    this.tasks.set(task.id, task);
    return task;
  }

  answerFrom(ownerUserId: string, answer: string) {
    if (!this.delivery) throw new Error("No chat question was delivered");
    if (this.delivery.ownerUserId !== ownerUserId) throw new Error("Only the question owner may answer it");
    const chat = ownerUserId === alice.id ? this.aliceChat : this.bobChat;
    chat.messages.push({ role: "user", content: answer });
    this.timeline.push({ at: Date.now(), kind: `${ownerUserId}-chat-user`, detail: chat.messages.at(-1) });
    const parked = this.tasks.get(this.delivery.negotiationTaskId)!;
    parked.state = "canceled";
    const successor = this.createTask(parked.conversationId, { continuationExecution: { token: "continuation-token", fence: 1, status: "claimed" } });
    return {
      resumeFromTaskId: parked.id,
      continuationSettlementId: this.delivery.settlementId,
      continuationExecution: {
        taskId: parked.id, settlementId: this.delivery.settlementId, opportunityId: this.opportunity.id, userId: ownerUserId, recipientIntentId: this.delivery.ownerIntentId, networkId: context.networkId, intentFingerprint: "fingerprint", opportunityStatus: "negotiating", opportunityUpdatedAt: this.opportunity.updatedAt.toISOString(), counterpartyUserId: ownerUserId === alice.id ? bob.id : alice.id, counterpartyIntentId: ownerUserId === alice.id ? bob.intents[0].id : alice.intents[0].id, successorTaskId: successor.id, conversationId: parked.conversationId, token: "continuation-token", fence: 1, leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(), consultation: { recipientUserId: ownerUserId, recipientIntentId: this.delivery.ownerIntentId, kind: "answer", selectedOptions: [], freeText: answer },
      },
    };
  }
}

async function answerAsOwner(ownerId: string, question: string): Promise<string> {
  const profile = ownerId === alice.id
    ? "You are Alice. You can meet a potential co-founder on Tuesday evening this month."
    : "You are Bob. You can meet a potential co-founder on Tuesday evening this month.";
  const response = await createModel("negotiator").invoke([
    new SystemMessage("Reply as the user in one concise sentence. Answer only from the provided private profile; do not mention agents or hidden negotiation details."),
    new HumanMessage(`${profile}\n\nYour chat assistant asks: ${question}`),
  ]);
  return String(response.content).trim();
}

describe.skipIf(!HAS_OPENROUTER_KEY)("PersonalAgentChat negotiation — in-chat owner question (live)", () => {
  test.concurrent("runs the opportunity, chat delivery, and continuation through the Negotiations capability", async () => {
    const host = new FakeNegotiationHost();
    const capability = new Negotiations([
      host.database as never,
      host.dispatcher as never,
      host.timeoutQueue as never,
      undefined,
      undefined,
      host.clientDmRetrieve,
      host.deliveryPort,
    ]);
    const graph = capability.createGraph();
    const input = {
      sourceUser: alice,
      candidateUser: bob,
      sourceIntentId: alice.intents[0].id,
      candidateIntentId: bob.intents[0].id,
      indexContext: context,
      seedAssessment: assessment,
      opportunityId: host.opportunity.id,
      opportunityStatus: host.opportunity.status,
      opportunityUpdatedAt: host.opportunity.updatedAt,
      maxTurns: 3,
    };

    let result = await graph.invoke(input);
    for (let questions = 0; result.status === "input_required" && questions < 3; questions += 1) {
      const ownerId = host.pendingQuestionOwner();
      const chat = ownerId === alice.id ? host.aliceChat : host.bobChat;
      const question = chat.messages.at(-1);
      expect(question).toMatchObject({ role: "assistant" });
      result = await graph.invoke({ ...input, ...host.answerFrom(ownerId, await answerAsOwner(ownerId, question!.content)) });
    }
    expect(result.outcome).not.toBeNull();

    console.info("[protocol flow timeline]", host.timeline.sort((a, b) => a.at - b.at).map((event) => {
      if (event.kind === "a2a") {
        const message = event.detail as { senderId: string; parts: Array<{ data: { action: string; message?: string | null } }> };
        return { at: new Date(event.at).toISOString(), channel: "a2a", from: message.senderId, action: message.parts[0].data.action, message: message.parts[0].data.message ?? null };
      }
      const message = event.detail as { role: string; content: string };
      return { at: new Date(event.at).toISOString(), channel: event.kind, from: message.role, message: message.content };
    }));
  }, 180_000);

  test.concurrent("completes a match directly when both owners already settled availability in chat", async () => {
    const host = new FakeNegotiationHost({
      [alice.id]: "I want a New York technical co-founder and can meet on Tuesday evening this month.",
      [bob.id]: "I want a New York developer-tools co-founder role and can meet on Tuesday evening this month.",
    });
    const graph = new Negotiations([host.database as never, host.dispatcher as never, host.timeoutQueue as never, undefined, undefined, host.clientDmRetrieve]).createGraph();
    const result = await graph.invoke({
      sourceUser: alice,
      candidateUser: bob,
      sourceIntentId: alice.intents[0].id,
      candidateIntentId: bob.intents[0].id,
      indexContext: context,
      seedAssessment: assessment,
      opportunityId: host.opportunity.id,
      opportunityStatus: host.opportunity.status,
      opportunityUpdatedAt: host.opportunity.updatedAt,
      maxTurns: 3,
    });

    expect(result.status).not.toBe("input_required");
    expect(result.outcome).not.toBeNull();
    expect(host.aliceChat.messages).toEqual([]);
    expect(host.bobChat.messages).toEqual([]);
  }, 120_000);

  test.concurrent("rejects an incompatible candidate without asking either owner", async () => {
    const host = new FakeNegotiationHost({
      [alice.id]: "I need an ML technical co-founder for my New York developer-tools startup.",
      [casey.id]: "I am looking only for a ceramics workspace.",
    });
    const graph = new Negotiations([host.database as never, host.dispatcher as never, host.timeoutQueue as never, undefined, undefined, host.clientDmRetrieve, host.deliveryPort]).createGraph();
    const result = await graph.invoke({
      sourceUser: alice,
      candidateUser: casey,
      sourceIntentId: alice.intents[0].id,
      candidateIntentId: casey.intents[0].id,
      indexContext: context,
      seedAssessment: { reasoning: "The candidate seeks ceramics workspace, not a technical co-founder role.", valencyRole: "peer" },
      opportunityId: host.opportunity.id,
      opportunityStatus: host.opportunity.status,
      opportunityUpdatedAt: host.opportunity.updatedAt,
      maxTurns: 3,
    });

    expect(result.outcome?.hasOpportunity).toBe(false);
    expect(host.aliceChat.messages).toEqual([]);
    expect(host.bobChat.messages).toEqual([]);
    console.info("[incompatible-match transcript]", host.timeline);
  }, 120_000);

});
