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
  protocolVersion: "v2",
};

const askUserOutput = {
  action: "ask_user",
  assessment: { reasoning: "need permission", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
  message: null,
  askUser: { disclosureSubject: "budget range", draftQuestion: "Share your budget?" },
};

function validTurn(action: string) {
  return {
    action,
    assessment: { reasoning: "ok", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
    message: null,
  };
}

describe("IndexNegotiator — canAskUser (IND-401)", () => {
  it("accepts an ask_user turn with payload when granted, and the prompt carries the rule", async () => {
    const agent = new CapturingNegotiator([askUserOutput]);
    const turn = await agent.invoke({ ...baseInput, canAskUser: true });
    expect(turn.action).toBe("ask_user");
    expect(turn.askUser?.disclosureSubject).toBe("budget range");
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

  it("v1 never gains the action even with canAskUser set", async () => {
    const agent = new CapturingNegotiator([askUserOutput, validTurn("counter")]);
    const turn = await agent.invoke({ ...baseInput, protocolVersion: "v1", seat: "initiator", canAskUser: true });
    expect(turn.action).toBe("counter");
    expect(agent.systemPrompts[0]).not.toContain("ask_user");
  });

  it("final turns never gain the action even with canAskUser set", async () => {
    const agent = new CapturingNegotiator([askUserOutput, validTurn("withdraw")]);
    const turn = await agent.invoke({ ...baseInput, isFinalTurn: true, canAskUser: true });
    expect(turn.action).toBe("withdraw");
    expect(agent.systemPrompts[0]).not.toContain('"ask_user"');
  });
});
