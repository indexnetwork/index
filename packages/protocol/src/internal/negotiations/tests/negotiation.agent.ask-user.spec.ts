import { describe, it, expect } from "bun:test";
import { IndexNegotiator } from "../negotiation.agent.js";
import type { NegotiationAgentInput } from "../negotiation.agent.js";

/**
 * IND-401 — IndexNegotiator `canAskUser` contract.
 *
 * Uses the `callModel` seam (no live provider): the subclass captures the
 * system prompt and feeds scripted outputs into the validate loop, pinning:
 * - the ask_user rule appears in the prompt ONLY when canAskUser is granted,
 * - the schema accepts an ask_user turn (with payload) only when granted,
 * - without the grant an ask_user output is schema-invalid → conservative
 *   fallback after the retry,
 * - v1 and final turns never gain the action even with canAskUser set.
 *
 * Plus the authoring contract: with the grant the rule asks for a reason AND a
 * question the agent wrote itself, and it no longer tells the model the server
 * owns the copy. Without the grant none of that is visible.
 */

class CapturingNegotiator extends IndexNegotiator {
  calls = 0;
  systemPrompts: string[] = [];
  constructor(private outputs: unknown[]) {
    super({ turnTimeoutMs: 1000 });
  }
  protected override async callModel(
    _model: unknown,
    chatMessages: Array<{ role: string; content: string }>,
  ): Promise<unknown> {
    this.systemPrompts.push(chatMessages[0].content);
    const out = this.outputs[Math.min(this.calls, this.outputs.length - 1)];
    this.calls += 1;
    return out;
  }
}

const baseInput: NegotiationAgentInput = {
  ownUser: { id: "u-init", intents: [], profile: { name: "Alice" } },
  otherUser: { id: "u-cp", intents: [], profile: { name: "Bob" } },
  indexContext: { networkId: "net-1", prompt: "" },
  seedAssessment: { reasoning: "seed", valencyRole: "peer" },
  history: [{ action: "counter", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: null }],
  seat: "initiator",
};

const askUserOutput = {
  action: "ask_user",
  assessment: { reasoning: "need permission", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
  message: null,
  askUser: { reason: "consequential_disclosure_permission" },
};

function validTurn(action: string) {
  return {
    action,
    assessment: { reasoning: "ok", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
    message: null,
  };
}

describe("IndexNegotiator — canAskUser (IND-401)", () => {
  it("retries a counter that tries to consult its own client, then parks locally", async () => {
    const disguisedConsultation = {
      ...validTurn("counter"),
      message: "Before proceeding, we need to consult Alice directly.",
    };
    const agent = new CapturingNegotiator([disguisedConsultation, askUserOutput]);

    const turn = await agent.invoke({ ...baseInput, canAskUser: true });

    expect(agent.calls).toBe(2);
    expect(turn.action).toBe("ask_user");
    expect(turn.message).toBeNull();
  });

  it("parks locally rather than sending a second disguised consultation", async () => {
    const disguisedConsultation = {
      ...validTurn("counter"),
      message: "We need to consult Alice directly before proceeding.",
    };
    const agent = new CapturingNegotiator([disguisedConsultation, disguisedConsultation]);

    const turn = await agent.invoke({ ...baseInput, canAskUser: true });

    expect(agent.calls).toBe(2);
    expect(turn).toMatchObject({
      action: "ask_user",
      message: null,
      askUser: { reason: "unresolved_owner_constraint" },
    });
  });

  it("answers a supported fit question before seeking more qualification", async () => {
    const agent = new CapturingNegotiator([validTurn("counter")]);
    await agent.invoke(baseInput);

    const prompt = agent.systemPrompts[0];
    expect(prompt).toContain("ANSWER FIT QUESTIONS BEFORE QUALIFYING THEM");
    expect(prompt).toContain("make the concrete connection from the record first");
    expect(prompt).toContain("Never mirror a fit question back");
  });

  it("identifies the negotiation as an A2A conversation between personal agents", async () => {
    const agent = new CapturingNegotiator([validTurn("counter")]);
    await agent.invoke(baseInput);

    const prompt = agent.systemPrompts[0];
    expect(prompt).toContain("CHANNEL CONTEXT — A2A negotiation");
    expect(prompt).toContain("Alice's personal agent in a conversation with another person's personal agent");
    expect(prompt).toContain("You are not Alice");
  });

  it("accepts an ask_user turn with payload when granted, and the prompt carries the rule", async () => {
    const agent = new CapturingNegotiator([askUserOutput]);
    const turn = await agent.invoke({ ...baseInput, canAskUser: true });
    expect(turn.action).toBe("ask_user");
    expect(turn.askUser?.reason).toBe("consequential_disclosure_permission");
    expect(agent.calls).toBe(1);
    expect(agent.systemPrompts[0]).toContain('"ask_user"');
    expect(agent.systemPrompts[0]).toContain("AT MOST ONE client consultation");
    // The {userName} placeholder inside the rule is substituted.
    expect(agent.systemPrompts[0]).toContain("Alice's OWN input");
  });

  it("counterparty seat gains the same rule when granted", async () => {
    const agent = new CapturingNegotiator([askUserOutput]);
    const turn = await agent.invoke({ ...baseInput, seat: "counterparty", canAskUser: true });
    expect(turn.action).toBe("ask_user");
    expect(agent.systemPrompts[0]).toContain('"ask_user"');
  });

  it("without the grant, ask_user output is schema-invalid → retry → conservative fallback", async () => {
    const agent = new CapturingNegotiator([askUserOutput, askUserOutput]);
    const turn = await agent.invoke(baseInput);
    expect(turn.action).toBe("counter");
    expect(agent.calls).toBe(2);
    expect(agent.systemPrompts[0]).not.toContain("ask_user");
  });

  it("final turns never gain the action even with canAskUser set", async () => {
    const agent = new CapturingNegotiator([askUserOutput, validTurn("withdraw")]);
    const turn = await agent.invoke({ ...baseInput, isFinalTurn: true, canAskUser: true });
    expect(turn.action).toBe("withdraw");
    expect(agent.systemPrompts[0]).not.toContain('"ask_user"');
  });
});

describe("IndexNegotiator — the negotiator authors its own consultation question", () => {
  async function grantedPrompt(overrides: Partial<NegotiationAgentInput> = {}): Promise<string> {
    const agent = new CapturingNegotiator([askUserOutput]);
    await agent.invoke({ ...baseInput, canAskUser: true, ...overrides });
    return agent.systemPrompts[0];
  }

  it("asks for the question text, not just the admission category", async () => {
    const prompt = await grantedPrompt();
    expect(prompt).toContain("Write the question yourself in askUser.question");
    expect(prompt).toContain("set askUser.reason to exactly one closed server category");
    // All four closed categories still enumerated verbatim.
    for (const reason of [
      "unresolved_owner_constraint",
      "consequential_disclosure_permission",
      "repeated_non_convergence",
      "insufficient_commitment_authority",
    ]) {
      expect(prompt).toContain(reason);
    }
  });

  it("no longer tells the model the server owns the owner-facing copy", async () => {
    const prompt = await grantedPrompt();
    expect(prompt).not.toContain("Never write question text");
    expect(prompt).not.toContain("the server owns all owner-facing copy");
  });

  it("carries the renderer constraints the structured question schema enforces", async () => {
    const prompt = await grantedPrompt();
    expect(prompt).toContain("title: at most 12 characters");
    expect(prompt).toContain("at most 2 sentences and 400 characters, ending in a question mark");
    expect(prompt).toContain("2–4 of Alice's real decision options");
    expect(prompt).toContain("label at most 120 characters");
    expect(prompt).toContain("description at most 280 characters");
    expect(prompt).toContain("stating the CONSEQUENCE of choosing that option");
    expect(prompt).toContain("multiSelect: true ONLY when the options are not mutually exclusive");
    expect(prompt).toContain('Never add an "Other" option');
  });

  it("grounds the question in this negotiation and keeps the counterparty out of it", async () => {
    const prompt = await grantedPrompt();
    expect(prompt).toContain("grounded in the exchange above");
    expect(prompt).toContain("Never a generic template");
    expect(prompt).toContain("Do not name, quote, or describe the counterparty");
    // Grounding is the transcript only for now — the signal's DM lands later.
    expect(prompt).not.toContain("direct message");
  });

  it("encourages questions that turn a negotiation observation into a reusable signal boundary", async () => {
    const prompt = await grantedPrompt();
    expect(prompt).toContain("LEARN FOR THE SIGNAL, NOT JUST THIS COUNTERPARTY");
    expect(prompt).toContain("prefer one focused \"ask_user\" question over guessing");
    expect(prompt).toContain("only when the answer changes a concrete screening or negotiation decision");
  });

  it("keeps the pause economics and the question/ask_user split intact", async () => {
    const prompt = await grantedPrompt();
    expect(prompt).toContain("PAUSES the negotiation until they answer (up to 24h)");
    expect(prompt).toContain("AT MOST ONE client consultation per negotiation");
    expect(prompt).toContain('Use "question" (not "ask_user") when the clarification should come from the OTHER side');
  });

  it("never uses the counterparty agent as a relay to its client", async () => {
    const prompt = await grantedPrompt();
    expect(prompt).toContain("COUNTERPARTY BOUNDARY");
    expect(prompt).toContain("never a request for that agent to interrogate or relay from its human");
    expect(prompt).toContain("Never ask, imply, or instruct it to ask what its client wants, prefers, can do, or would decide");
  });

  it("substitutes {userName} inside the authoring rule", async () => {
    const prompt = await grantedPrompt();
    expect(prompt).toContain("Alice's OWN input");
    expect(prompt).toContain("You are Alice's own agent");
    expect(prompt).toContain("in Alice's own terms");
    expect(prompt).not.toContain("{userName}");
  });

  it("stays entirely invisible without the grant, on both seats", async () => {
    for (const seat of ["initiator", "counterparty"] as const) {
      const agent = new CapturingNegotiator([validTurn("counter"), validTurn("counter")]);
      await agent.invoke({ ...baseInput, seat });
      const prompt = agent.systemPrompts[0];
      expect(prompt).not.toContain("askUser");
      expect(prompt).not.toContain("ask_user");
      expect(prompt).not.toContain("multiSelect");
      expect(prompt).not.toContain("at most 12 characters");
    }
  });

  it("still accepts a reason-only payload — external agents will not author one", async () => {
    const agent = new CapturingNegotiator([askUserOutput]);
    const turn = await agent.invoke({ ...baseInput, canAskUser: true });
    expect(turn.action).toBe("ask_user");
    expect(turn.askUser).toEqual({ reason: "consequential_disclosure_permission" });
    expect(agent.calls).toBe(1);
  });

  it("accepts a turn that fills the authored question in", async () => {
    const authored = {
      ...askUserOutput,
      askUser: {
        reason: "unresolved_owner_constraint",
        question: {
          title: "Timing",
          prompt: "Should I commit you to an intro call in the next two weeks?",
          options: [
            { label: "Yes (Recommended)", description: "I book the call while their interest is warm." },
            { label: "Not yet", description: "I keep the thread open without promising your calendar." },
          ],
          multiSelect: false,
        },
      },
    };
    const agent = new CapturingNegotiator([authored]);
    const turn = await agent.invoke({ ...baseInput, canAskUser: true });
    expect(turn.action).toBe("ask_user");
    expect(turn.askUser?.question?.title).toBe("Timing");
    expect(turn.askUser?.question?.options).toHaveLength(2);
    expect(agent.calls).toBe(1);
  });
});
