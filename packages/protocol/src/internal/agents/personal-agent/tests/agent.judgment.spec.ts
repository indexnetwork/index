import { describe, expect, test } from "bun:test";

import { NEGOTIATION_TURN_TIMEOUT_MS, PersonalAgentModel, PERSONAL_AGENT_MODEL_TIMEOUT_MS, validateDecidedAct } from "../agent.judgment.js";
import type { PersonalAgentExecutedAct, PersonalAgentNonDurableObservation, PersonalAgentTurnContext } from "../agent.types.js";

class CapturingPersonalAgentModel extends PersonalAgentModel {
  lastMessages: Array<{ role: string; content: string }> = [];

  protected override async callActsModel(messages: Array<{ role: string; content: string }>): Promise<unknown> {
    this.lastMessages = messages;
    return { act: "message_user", text: "The other side is deciding." };
  }
}

class SignalCapturingPersonalAgentModel extends PersonalAgentModel {
  choiceSignal?: AbortSignal;
  proseSignal?: AbortSignal;
  proseModelNames: string[] = [];

  protected override createChoiceModel() {
    return {
      invoke: async (_input: unknown, config?: { signal?: AbortSignal }) => {
        this.choiceSignal = config?.signal;
        return { act: "message_user", text: "Done." };
      },
    } as never;
  }

  protected override createProseModel(name: string) {
    this.proseModelNames.push(name);
    return {
      invoke: async (_input: unknown, config?: { signal?: AbortSignal }) => {
        this.proseSignal = config?.signal;
        return { text: "A concise strategy." };
      },
    } as never;
  }
}

class UnsupportedStrategyModel extends PersonalAgentModel {
  protected override async callProseModel(): Promise<unknown> {
    return { text: "They are deliberating over the pricing terms while I contact another match." };
  }
}

function context(overrides: Partial<PersonalAgentTurnContext> = {}): PersonalAgentTurnContext {
  return {
    userId: "alice", intentId: "intent-1", event: "user_message",
    message: { text: "hello", sessionId: "dm-1", messageId: "m-1" },
    signalText: "Looking for a technical co-founder.",
    matches: [{ opportunityId: "opportunity-1", label: "A match", status: "negotiating" }],
    kickoffTargets: [], knownMatchIds: [],
    paused: [{ negotiationId: "task-1", opportunityId: "opportunity-1", reason: "ready_for_verdict", pausedByUs: true, thread: [] }],
    dossier: [], recentDm: [], recentActs: [], ...overrides,
  };
}

describe("validateDecidedAct", () => {
  test("keeps asks in safe canonical questions instead of message prose", () => {
    const question = {
      title: "Timing",
      prompt: "What timing works for you?",
      options: [
        { label: "This month", description: "Start within the next few weeks." },
        { label: "Next quarter", description: "Plan for a later start." },
      ],
      multiSelect: false,
    };
    expect(validateDecidedAct({ act: "message_user", text: "A quick detail will help.", questions: [question] }, context()))
      .toEqual({ tool: "message_user", text: "A quick detail will help.", questions: [question] });
    expect(validateDecidedAct({ act: "message_user", text: "What timing works for you?" }, context())).toBeNull();
    expect(validateDecidedAct({
      act: "message_user",
      text: "A quick detail will help.",
      questions: [{ ...question, prompt: "What is the opportunity_id?" }],
    }, context())).toBeNull();
  });

  test("keeps references bounded to the state the model was shown", () => {
    expect(validateDecidedAct({ act: "reject", negotiation: 2 }, context())).toBeNull();
  });

  test("permits verdicts only for an owned ready_for_verdict pause", () => {
    expect(validateDecidedAct({ act: "promote", negotiation: 1 }, context()))
      .toEqual({ tool: "promote", negotiationId: "task-1", reasoning: "Worth surfacing." });
    expect(validateDecidedAct({ act: "reject", negotiation: 1 }, context({
      paused: [{ negotiationId: "task-1", opportunityId: "opportunity-1", reason: "needs_principal", pausedByUs: true, thread: [] }],
    }))).toBeNull();
    expect(validateDecidedAct({ act: "reject", negotiation: 1 }, context({
      paused: [{ negotiationId: "task-1", opportunityId: "opportunity-1", reason: "ready_for_verdict", pausedByUs: false, thread: [] }],
    }))).toBeNull();
  });

  test("accepts only a bounded user-message verdict and rejects background acceptance", () => {
    expect(validateDecidedAct({ act: "accept_opportunity", opportunity: 1 }, context()))
      .toEqual({ tool: "accept_opportunity", opportunityId: "opportunity-1" });
    expect(validateDecidedAct(
      { act: "accept_opportunity", opportunity: 1 },
      context({ event: "matches_ready", message: undefined }),
    )).toBeNull();
  });

  test("counterparty deciding state cannot become invented response or review narration", () => {
    const deciding = context({
      event: "all_paused",
      message: undefined,
      round: 1,
      paused: [{
        negotiationId: "task-1",
        opportunityId: "opportunity-1",
        reason: "ready_for_verdict",
        pausedByUs: false,
        thread: [],
      }],
    });

    expect(validateDecidedAct({
      act: "message_user",
      text: "They still have not responded and are reviewing the pricing details.",
    }, deciding)).toBeNull();
    expect(validateDecidedAct({ act: "message_user", text: "There is no response yet." }, deciding)).toBeNull();
    expect(validateDecidedAct({ act: "message_user", text: "They are assessing the pricing." }, deciding)).toBeNull();
    expect(validateDecidedAct({ act: "message_user", text: "They are deliberating over the pricing terms." }, deciding)).toBeNull();
    expect(validateDecidedAct({ act: "message_user", text: "They are thinking through your proposed timeline." }, deciding)).toBeNull();
    expect(validateDecidedAct({ act: "message_user", text: "The other side is deciding. I will keep you posted." }, deciding)).toBeNull();
    expect(validateDecidedAct({ act: "message_user", text: "The other side is deciding." }, deciding))
      .toEqual({ tool: "message_user", text: "The other side is deciding." });
  });
});

describe("PersonalAgentModel", () => {
  test("rejects kickoff strategy prose that bypasses canonical counterpart status", async () => {
    const model = new UnsupportedStrategyModel();
    await expect(model.strategy(context({
      paused: [{
        negotiationId: "task-1",
        opportunityId: "opportunity-1",
        reason: "ready_for_verdict",
        pausedByUs: false,
        thread: [],
      }],
    }))).rejects.toThrow("PersonalAgent produced no usable strategy");
  });

  test("counterparty pause rendering exposes only public state, not thread topics", async () => {
    const model = new CapturingPersonalAgentModel();
    await model.next(context({
      event: "all_paused",
      message: undefined,
      round: 1,
      paused: [{
        negotiationId: "task-1",
        opportunityId: "opportunity-1",
        reason: "ready_for_verdict",
        pausedByUs: false,
        thread: [{ speaker: "counterparty", turn: { verb: "counter", message: "SECRET_PRICING_TOPIC", reasoning: "private" } }],
      }],
    }), []);

    const prompt = model.lastMessages.find((message) => message.role === "user")?.content;
    expect(prompt).toContain("CANONICAL COUNTERPART STATUS RESPONSE:\nThe other side is deciding.");
    expect(prompt).not.toContain("SECRET_PRICING_TOPIC");
  });

  test("renders refused irreversible calls as non-durable observations", async () => {
    const model = new CapturingPersonalAgentModel();
    const observation: PersonalAgentNonDurableObservation = {
      kind: "irreversible_tool_refused",
      tool: "kickoff",
      reason: "A kickoff already executed against this turn's snapshot. Choose a different next step.",
    };

    await model.next(context(), [], [observation]);

    const prompt = model.lastMessages.find((message) => message.role === "user")?.content;
    expect(prompt).toContain("NON-DURABLE REFUSALS (these calls did not execute and changed no state)");
    expect(prompt).toContain("Refused kickoff: A kickoff already executed against this turn's snapshot.");
  });

  test("renders a refused verdict by bounded list position, never raw negotiation id", async () => {
    const model = new CapturingPersonalAgentModel();
    const negotiationId = "aeb2e65d-0c7b-4a0d-909c-d3868d1cb091";
    const turn = context({
      paused: [{
        negotiationId,
        opportunityId: "opportunity-1",
        reason: "ready_for_verdict",
        pausedByUs: true,
        thread: [],
      }],
    });
    const observation: PersonalAgentNonDurableObservation = {
      kind: "irreversible_tool_refused",
      tool: "promote",
      negotiationId,
      reason: "A terminal verdict already executed for this negotiation against this turn's snapshot.",
    };

    await model.next(turn, [], [observation]);

    const prompt = model.lastMessages.find((message) => message.role === "user")?.content;
    expect(prompt).toContain("Refused promote for negotiation 1");
    expect(prompt).not.toContain(negotiationId);
  });

  test("renders a refused acceptance by bounded match position, never raw opportunity id", async () => {
    const model = new CapturingPersonalAgentModel();
    const opportunityId = "5d8e06ce-6d99-4212-a8ec-3a5451950127";
    const turn = context({ matches: [{ opportunityId, label: "First match", status: "pending" }] });
    const observation: PersonalAgentNonDurableObservation = {
      kind: "irreversible_tool_refused",
      tool: "accept_opportunity",
      opportunityId,
      reason: "An acceptance already executed for this match against this turn's snapshot.",
    };

    await model.next(turn, [], [observation]);

    const prompt = model.lastMessages.find((message) => message.role === "user")?.content;
    expect(prompt).toContain("Refused accept_opportunity for match 1");
    expect(prompt).not.toContain(opportunityId);
  });

  test("renders partial kickoff failures explicitly for the next choice", async () => {
    const model = new CapturingPersonalAgentModel();
    const kickoff: PersonalAgentExecutedAct = {
      tool: "kickoff",
      round: 2,
      opened: 2,
      attempted: 2,
      failed: 1,
      reasoning: "Reaching out.",
    };

    await model.next(context(), [kickoff]);

    const prompt = model.lastMessages.find((message) => message.role === "user")?.content;
    expect(prompt).toContain("attempted to open or re-open 2 match(es); 1 failed to open");
    expect(prompt).toContain("round settled with 2 negotiation task(s)");
  });

  test("passes a 15-second abort signal to choice and prose model calls", async () => {
    const model = new SignalCapturingPersonalAgentModel();

    await model.next(context(), []);
    await model.strategy(context());

    expect(PERSONAL_AGENT_MODEL_TIMEOUT_MS).toBe(15_000);
    expect(model.choiceSignal).toBeInstanceOf(AbortSignal);
    expect(model.proseSignal).toBeInstanceOf(AbortSignal);
  });

  test("gives a counterparty seat brief the negotiation turn budget", async () => {
    const model = new SignalCapturingPersonalAgentModel();

    await model.seatBrief({
      intent: { userId: "alice", payload: "Looking for a technical co-founder." },
      negotiation: { state: "working", metadata: { initiatorUserId: "bob" } },
      thread: [],
    } as never);

    expect(NEGOTIATION_TURN_TIMEOUT_MS).toBe(20_000);
    expect(model.proseModelNames).toContain("personal_agent_seat_brief");
    expect(model.proseSignal).toBeInstanceOf(AbortSignal);
  });

});
