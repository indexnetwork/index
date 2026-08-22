import { describe, it, expect } from "bun:test";
import { IndexNegotiator } from "../negotiation.agent.js";
import type { NegotiationAgentInput } from "../negotiation.agent.js";

/**
 * Initiator-only "withdraw on disqualifying information" rule.
 *
 * The v2 initiator seat already had `withdraw` in its vocabulary, but nothing
 * connected information learned through clarification (a counterparty answer to
 * a `question`, or the user's own between-session answers / private
 * consultation) to the decision to walk away — so the seat could question,
 * learn the match was disqualified, and keep countering.
 *
 * Uses the same `callModel` seam as `negotiation.agent.ask-user.spec.ts` (no
 * live provider): the subclass captures the system prompt and returns a
 * scripted valid turn. Pins:
 * - the rule is present in the v2 initiator prompt,
 * - it names BOTH clarification channels,
 * - it is absent from the v2 counterparty prompt, which still gets no
 *   `withdraw` at all,
 * - it is absent from v1,
 * - it renders identically with `canAskUser` on and off, and never names the
 *   `ask_user` action (which is conditionally appended and must not be
 *   referenced by an unconditional rule).
 */

class CapturingNegotiator extends IndexNegotiator {
  systemPrompts: string[] = [];
  constructor(private readonly outputs: unknown[]) {
    super({ turnTimeoutMs: 1000 });
  }
  private calls = 0;
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
  history: [
    { action: "outreach", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: null },
    { action: "question", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: null },
  ],
  seat: "initiator",
};

function validTurn(action: string) {
  return {
    action,
    assessment: { reasoning: "ok", suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const } },
    message: null,
  };
}

/** Distinctive marker of the rule — absent from the pre-change prompt. */
const RULE_MARKER = "WITHDRAW ON DISQUALIFYING INFORMATION";

async function promptFor(input: Partial<NegotiationAgentInput>, action = "counter"): Promise<string> {
  const agent = new CapturingNegotiator([validTurn(action)]);
  await agent.invoke({ ...baseInput, ...input });
  return agent.systemPrompts[0];
}

describe("IndexNegotiator — initiator withdraw-after-clarification rule", () => {
  it("v2 initiator prompt instructs withdraw when clarification disqualifies the match", async () => {
    const prompt = await promptFor({});
    expect(prompt).toContain(RULE_MARKER);
    expect(prompt).toContain('choose "withdraw" rather than countering or questioning again');
    expect(prompt).toContain("no longer serves Alice");
  });

  it("the rule covers BOTH clarification channels", async () => {
    const prompt = await promptFor({});
    // counterparty question/answer channel
    expect(prompt).toContain("the counterparty's answer to one of your questions");
    // own-user answers / private-consultation channel
    expect(prompt).toContain("Alice's own answers or private consultation provided between sessions");
  });

  it("v2 counterparty seat never receives the rule and still has no withdraw", async () => {
    const prompt = await promptFor({ seat: "counterparty" }, "accept");
    expect(prompt).not.toContain(RULE_MARKER);
    expect(prompt).not.toContain("the counterparty's answer to one of your questions");
    expect(prompt).toContain("RECEIVING seat");
    expect(prompt).not.toContain('"withdraw"');
  });

  it("renders identically with canAskUser off and on, and never names the ask_user action", async () => {
    const withoutGrant = await promptFor({ canAskUser: false });
    const withGrant = await promptFor({ canAskUser: true });

    expect(withoutGrant).toContain(RULE_MARKER);
    expect(withGrant).toContain(RULE_MARKER);

    const ruleOf = (prompt: string) => prompt.slice(prompt.indexOf(RULE_MARKER)).split("\n")[0];
    expect(ruleOf(withoutGrant)).toBe(ruleOf(withGrant));

    // Unconditional rule must not reference the conditionally-appended action.
    expect(ruleOf(withoutGrant)).not.toContain("ask_user");
    expect(withoutGrant).not.toContain("ask_user");
    expect(withGrant).toContain('"ask_user"');
  });

  it("still present on the final turn, where the initiator must pick withdraw or counter", async () => {
    const prompt = await promptFor({ isFinalTurn: true }, "withdraw");
    expect(prompt).toContain(RULE_MARKER);
    expect(prompt).toContain("You MUST choose either 'withdraw' or 'counter'");
  });
});
