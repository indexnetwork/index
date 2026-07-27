import { describe, it, expect, afterEach } from "bun:test";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { NEGOTIATOR_STANCES, DEFAULT_NEGOTIATOR_STANCE, configuredNegotiatorStance, stanceAppliesValueBar, stanceQueryMatchIsNecessaryNotSufficient, stanceResolvesDeadlockByStalemate, stanceJobFraming, stanceActionRules, stanceQuerySatisfiedRule, type NegotiatorStance } from "../domain/negotiation.stance.contracts.js";
import { renderBargainingShiftSection } from "../domain/negotiation.deadlock.js";
import { PROMPT_MATRIX } from "./fixtures/negotiator-prompt-matrix.js";
import GOLDEN from "./fixtures/negotiator-advocate-prompts.golden.json" with { type: "json" };

/**
 * NEGOTIATOR_STANCE (IND-611).
 *
 * The hard invariant this file exists to defend: **`advocate` is byte-identical
 * to the pre-stance build**. `negotiator-advocate-prompts.golden.json` was
 * captured by `scripts/capture-negotiator-prompts.ts` run against the source at
 * `6175f8d13` — i.e. the prompt as it already shipped, including the IND-570
 * unconditional withdraw rule. The golden is a real external pin, not a
 * self-comparison: if any stance fragment leaks into the default rendering, the
 * matrix comparison below fails.
 *
 * The rest pins the additive, gated fragments per stance, and that the seat
 * invariants pinned by `negotiation.initiator-withdraw-rule.spec.ts` and
 * `negotiation.seat-rules.spec.ts` continue to hold under EVERY stance —
 * fragments render into all seats and both protocol versions, so they must
 * never introduce a quoted `"withdraw"` into a seat that has no withdraw, and
 * must never name `ask_user` where the grant is absent.
 *
 * Uses the same provider-free `callModel` seam as the other prompt specs.
 */

class CapturingNegotiator extends IndexNegotiator {
  prompt = "";
  constructor(private readonly output: unknown) {
    super({ turnTimeoutMs: 1000 });
  }
  protected override async callModel(
    _model: unknown,
    chatMessages: Array<{ role: string; content: string }>,
  ): Promise<unknown> {
    this.prompt = chatMessages[0].content;
    return this.output;
  }
}

function validTurn(action: string) {
  return {
    action,
    assessment: { reasoning: "ok", suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const } },
    message: null,
  };
}

const golden = GOLDEN as unknown as Record<string, string>;

/** Render the whole prompt matrix under one stance value. */
async function renderMatrix(stance: string | undefined): Promise<Record<string, string>> {
  const original = process.env.NEGOTIATOR_STANCE;
  if (stance === undefined) delete process.env.NEGOTIATOR_STANCE;
  else process.env.NEGOTIATOR_STANCE = stance;
  try {
    const out: Record<string, string> = {};
    for (const entry of PROMPT_MATRIX) {
      const agent = new CapturingNegotiator(validTurn(entry.action));
      await agent.invoke(entry.input as NegotiationAgentInput);
      out[entry.id] = agent.prompt;
    }
    return out;
  } finally {
    if (original === undefined) delete process.env.NEGOTIATOR_STANCE;
    else process.env.NEGOTIATOR_STANCE = original;
  }
}

const ORIGINAL_STANCE = process.env.NEGOTIATOR_STANCE;
afterEach(() => {
  if (ORIGINAL_STANCE === undefined) delete process.env.NEGOTIATOR_STANCE;
  else process.env.NEGOTIATOR_STANCE = ORIGINAL_STANCE;
});

describe("configuredNegotiatorStance", () => {
  it("defaults to advocate when unset", () => {
    delete process.env.NEGOTIATOR_STANCE;
    expect(configuredNegotiatorStance()).toBe("advocate");
    expect(DEFAULT_NEGOTIATOR_STANCE).toBe("advocate");
  });

  it("resolves every declared stance verbatim", () => {
    for (const stance of NEGOTIATOR_STANCES) {
      process.env.NEGOTIATOR_STANCE = stance;
      expect(configuredNegotiatorStance()).toBe(stance);
    }
  });

  it("falls back to advocate on unrecognized, empty, or wrong-cased values", () => {
    for (const raw of ["", "SKEPTIC", "Evaluator", "cynic", "off", "true", " skeptic "]) {
      process.env.NEGOTIATOR_STANCE = raw;
      expect(configuredNegotiatorStance()).toBe("advocate");
    }
  });

  it("exposes the documented capability matrix", () => {
    const matrix: Record<NegotiatorStance, [boolean, boolean, boolean]> = {
      // [value bar, necessary-not-sufficient query, stalemate deadlock]
      advocate: [false, false, false],
      evaluator: [true, true, false],
      skeptic: [true, true, true],
    };
    for (const stance of NEGOTIATOR_STANCES) {
      expect([
        stanceAppliesValueBar(stance),
        stanceQueryMatchIsNecessaryNotSufficient(stance),
        stanceResolvesDeadlockByStalemate(stance),
      ]).toEqual(matrix[stance]);
    }
  });
});

describe("NEGOTIATOR_STANCE=advocate — byte-identical prompt invariant", () => {
  it("the golden fixture covers the whole prompt matrix", () => {
    expect(Object.keys(golden).sort()).toEqual(PROMPT_MATRIX.map((e) => e.id).sort());
  });

  it("renders byte-identically to the pre-stance build with the var unset", async () => {
    const rendered = await renderMatrix(undefined);
    for (const entry of PROMPT_MATRIX) {
      expect(rendered[entry.id]).toBe(golden[entry.id]);
    }
  });

  it("renders byte-identically with NEGOTIATOR_STANCE=advocate set explicitly", async () => {
    const rendered = await renderMatrix("advocate");
    for (const entry of PROMPT_MATRIX) {
      expect(rendered[entry.id]).toBe(golden[entry.id]);
    }
  });

  it("renders byte-identically for an unrecognized value (fail-safe default)", async () => {
    const rendered = await renderMatrix("nonsense-stance");
    for (const entry of PROMPT_MATRIX) {
      expect(rendered[entry.id]).toBe(golden[entry.id]);
    }
  });

  it("contributes no fragments at all under advocate", () => {
    expect(stanceActionRules("advocate")).toBe("");
    expect(stanceJobFraming("advocate")).toBe(
      "Argue their case honestly — acknowledge weaknesses, but advocate for genuine fit.",
    );
    expect(stanceQuerySatisfiedRule("advocate", "Bob", "Alice")).toBe(
      "- If Bob DOES satisfy the query: PROPOSE or ACCEPT the connection and evaluate fit normally using intents and profile data.",
    );
  });
});

describe("evaluator / skeptic — additive, gated fragments", () => {
  it("evaluator changes every prompt in the matrix relative to advocate", async () => {
    const rendered = await renderMatrix("evaluator");
    for (const entry of PROMPT_MATRIX) {
      expect(rendered[entry.id]).not.toBe(golden[entry.id]);
    }
  });

  it("skeptic changes every prompt in the matrix relative to advocate", async () => {
    const rendered = await renderMatrix("skeptic");
    for (const entry of PROMPT_MATRIX) {
      expect(rendered[entry.id]).not.toBe(golden[entry.id]);
    }
  });

  it("evaluator asks for assessment before advocacy and adds the opportunity-cost bar", async () => {
    const rendered = await renderMatrix("evaluator");
    const prompt = rendered["v2-initiator"];
    expect(prompt).toContain("Assess before you advocate");
    expect(prompt).toContain("Advocate only for a match that survives that judgment");
    expect(prompt).toContain("OPPORTUNITY COST");
    expect(prompt).toContain("Alice's attention is finite");
    // The negative-only bar is no longer the last word on declining.
    expect(prompt).toContain('The bar is "worth that spend", not "does no harm"');
    // evaluator does NOT carry the skeptic prior.
    expect(prompt).not.toContain("most candidate matches are NOT worth making");
  });

  it("skeptic carries the evaluator framing PLUS the not-worth-making prior", async () => {
    const rendered = await renderMatrix("skeptic");
    const prompt = rendered["v2-initiator"];
    expect(prompt).toContain("Assess before you advocate");
    expect(prompt).toContain("most candidate matches are NOT worth making");
    expect(prompt).toContain("OPPORTUNITY COST");
  });

  it("query satisfaction becomes necessary-not-sufficient under evaluator and skeptic", async () => {
    for (const stance of ["evaluator", "skeptic"]) {
      const rendered = await renderMatrix(stance);
      for (const id of ["v2-initiator-discovery-query", "v1-discovery-query"]) {
        const prompt = rendered[id];
        expect(prompt).toContain("PRECONDITION for continuing to evaluate, NOT a reason to connect");
        expect(prompt).not.toContain("PROPOSE or ACCEPT the connection");
        // The mismatch half of the query rule is untouched.
        expect(prompt).toContain("does NOT satisfy the query: REJECT the match");
      }
    }
  });

  it("stance fragments never appear on a prompt that has no discovery query", async () => {
    const rendered = await renderMatrix("skeptic");
    expect(rendered["v2-initiator"]).not.toContain("PRECONDITION for continuing to evaluate");
  });
});

describe("deadlock resolution per stance", () => {
  const input = { active: true, userName: "Alice", canAskUser: false, consecutiveNonConvergent: 4 };

  it("advocate and evaluator keep the bargaining shift byte-identical to the stanceless render", () => {
    const legacy = renderBargainingShiftSection(input);
    expect(renderBargainingShiftSection({ ...input, stance: "advocate" })).toBe(legacy);
    expect(renderBargainingShiftSection({ ...input, stance: "evaluator" })).toBe(legacy);
    expect(legacy).toContain("SHIFT FROM PERSUASION TO BARGAINING");
  });

  it("skeptic resolves a deadlock as a stalemate rather than by concession", () => {
    const section = renderBargainingShiftSection({ ...input, stance: "skeptic" });
    expect(section).toContain("THE MERITS ARE EXHAUSTED");
    expect(section).not.toContain("SHIFT FROM PERSUASION TO BARGAINING");
    expect(section).toContain("Do NOT buy agreement with a concession or a reduced scope");
    expect(section).toContain("An unresolved disagreement is an acceptable outcome");
    // Stance-only: the action vocabulary is untouched, same as the bargaining shift.
    expect(section).toContain("your available actions are unchanged");
  });

  it("an inactive shift renders empty under every stance", () => {
    for (const stance of NEGOTIATOR_STANCES) {
      expect(renderBargainingShiftSection({ ...input, active: false, stance })).toBe("");
    }
  });

  it("the skeptic stalemate section never names ask_user, even when the grant is held", () => {
    const section = renderBargainingShiftSection({ ...input, canAskUser: true, stance: "skeptic" });
    expect(section).not.toContain("ask_user");
  });
});

describe("seat and version invariants hold under EVERY stance", () => {
  it("no stance leaks a quoted withdraw into v1 or the v2 counterparty seat", async () => {
    for (const stance of NEGOTIATOR_STANCES) {
      const rendered = await renderMatrix(stance);
      for (const id of ["v1", "v1-discovery-query", "v2-counterparty", "v2-counterparty-discovery-query"]) {
        expect(rendered[id]).not.toContain('"withdraw"');
        expect(rendered[id]).not.toContain("WITHDRAW ON DISQUALIFYING INFORMATION");
      }
    }
  });

  it("no stance names ask_user when the grant is absent, and the grant still renders it", async () => {
    for (const stance of NEGOTIATOR_STANCES) {
      const rendered = await renderMatrix(stance);
      expect(rendered["v2-initiator"]).not.toContain("ask_user");
      expect(rendered["v1"]).not.toContain("ask_user");
      expect(rendered["v2-counterparty"]).not.toContain("ask_user");
      expect(rendered["v2-initiator-ask-user"]).toContain('"ask_user"');
    }
  });

  it("the IND-570 withdraw rule survives unchanged on the v2 initiator under every stance", async () => {
    for (const stance of NEGOTIATOR_STANCES) {
      const rendered = await renderMatrix(stance);
      for (const id of ["v2-initiator", "v2-initiator-final", "v2-initiator-ask-user", "v2-initiator-opening"]) {
        const prompt = rendered[id];
        expect(prompt).toContain("WITHDRAW ON DISQUALIFYING INFORMATION");
        expect(prompt).toContain('choose "withdraw" rather than countering or questioning again');
        expect(prompt).toContain("the counterparty's answer to one of your questions");
        expect(prompt).toContain("Alice's own answers or private consultation provided between sessions");
      }
      // The rule line itself is identical with and without the canAskUser grant.
      const marker = "WITHDRAW ON DISQUALIFYING INFORMATION";
      const ruleOf = (p: string) => p.slice(p.indexOf(marker)).split("\n")[0];
      expect(ruleOf(rendered["v2-initiator"])).toBe(ruleOf(rendered["v2-initiator-ask-user"]));
    }
  });

  it("the final-turn instruction is untouched by every stance", async () => {
    for (const stance of NEGOTIATOR_STANCES) {
      const rendered = await renderMatrix(stance);
      expect(rendered["v2-initiator-final"]).toContain(
        "IMPORTANT: This is your FINAL turn. You MUST choose either 'withdraw' or 'counter'.",
      );
    }
  });
});
