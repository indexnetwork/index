import { describe, it, expect } from "bun:test";
import { IndexNegotiator } from "../negotiation.agent.js";
import type { NegotiationAgentInput } from "../negotiation.agent.js";

/**
 * IND-397 — system-agent invalid output: retry once, then conservative fallback.
 *
 * Uses the `callModel` seam so no live provider is involved: the subclass
 * feeds scripted raw model outputs into the validate→retry→fallback loop.
 */

class ScriptedNegotiator extends IndexNegotiator {
  calls = 0;
  constructor(private outputs: unknown[]) {
    super({ turnTimeoutMs: 1000 });
  }
  protected override async callModel(): Promise<unknown> {
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
  history: [],
  seat: "initiator",
  protocolVersion: "v2",
};

function validTurn(action: string) {
  return {
    action,
    assessment: { reasoning: "ok", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
    message: null,
  };
}

describe("IndexNegotiator — seat-schema validation with retry + fallback (IND-397)", () => {
  it("valid seat output passes through on the first attempt", async () => {
    const agent = new ScriptedNegotiator([validTurn("outreach")]);
    const turn = await agent.invoke(baseInput);
    expect(turn.action).toBe("outreach");
    expect(agent.calls).toBe(1);
  });

  it("initiator accept (schema-impossible) retries once, then succeeds on a valid retry", async () => {
    const agent = new ScriptedNegotiator([validTurn("accept"), validTurn("counter")]);
    const turn = await agent.invoke(baseInput);
    expect(turn.action).toBe("counter");
    expect(agent.calls).toBe(2);
  });

  it("invalid output twice falls back to conservative counter (initiator, non-final)", async () => {
    const agent = new ScriptedNegotiator([validTurn("accept"), validTurn("accept")]);
    const turn = await agent.invoke(baseInput);
    expect(turn.action).toBe("counter");
    expect(agent.calls).toBe(2);
    expect(turn.assessment.reasoning).toContain("conservative fallback");
  });

  it("counterparty final turn falls back to decline (must decide)", async () => {
    const agent = new ScriptedNegotiator([validTurn("counter"), validTurn("counter")]);
    const turn = await agent.invoke({
      ...baseInput,
      seat: "counterparty",
      isFinalTurn: true,
    });
    expect(turn.action).toBe("decline");
  });

  it("v1 output is validated against the legacy schema (propose valid, outreach invalid)", async () => {
    const v1Input: NegotiationAgentInput = { ...baseInput, seat: undefined, protocolVersion: "v1" };
    const okAgent = new ScriptedNegotiator([validTurn("propose")]);
    expect((await okAgent.invoke(v1Input)).action).toBe("propose");

    const badAgent = new ScriptedNegotiator([validTurn("outreach"), validTurn("outreach")]);
    const fallback = await badAgent.invoke(v1Input);
    expect(fallback.action).toBe("counter");
    expect(badAgent.calls).toBe(2);
  });
});
