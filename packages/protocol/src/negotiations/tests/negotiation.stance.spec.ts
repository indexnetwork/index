import { describe, it, expect, afterEach } from "bun:test";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { NEGOTIATOR_STANCES, DEFAULT_NEGOTIATOR_STANCE, configuredNegotiatorStance, stanceAppliesValueBar, stanceQueryMatchIsNecessaryNotSufficient, stanceResolvesDeadlockByStalemate, stanceVerifiesResponderFit, stanceJobFraming, stanceActionRules, stanceQuerySatisfiedRule, type NegotiatorStance } from "../negotiation.stance.contracts.js";
import { renderBargainingShiftSection } from "../negotiation.deadlock.js";
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
 * Only the two `canAskUser` entries have been recaptured since: `ASK_USER_RULE`
 * was rewritten to have the negotiator author its own consultation question.
 * That rewrite is deliberately invisible without the grant — every other entry
 * in the golden is still the `6175f8d13` capture, byte for byte, which is what
 * makes the ungranted prompt's byte-identity a checked claim rather than an
 * assertion.
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

/** Render one ad-hoc input under a stance — for shapes outside the fixed matrix. */
async function renderPrompt(
  input: NegotiationAgentInput,
  stance: string,
  action: string,
): Promise<string> {
  const original = process.env.NEGOTIATOR_STANCE;
  process.env.NEGOTIATOR_STANCE = stance;
  try {
    const agent = new CapturingNegotiator(validTurn(action));
    await agent.invoke(input);
    return agent.prompt;
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
    const matrix: Record<NegotiatorStance, [boolean, boolean, boolean, boolean]> = {
      // [value bar, necessary-not-sufficient query, responder verification, stalemate deadlock]
      advocate: [false, false, false, false],
      evaluator: [true, true, true, false],
      skeptic: [true, true, true, true],
    };
    for (const stance of NEGOTIATOR_STANCES) {
      expect([
        stanceAppliesValueBar(stance),
        stanceQueryMatchIsNecessaryNotSufficient(stance),
        stanceVerifiesResponderFit(stance),
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
    expect(stanceActionRules("advocate", "initiator")).toBe("");
    expect(stanceActionRules("advocate", "counterparty")).toBe("");
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

  it("evaluator prefers consulting the client over resolving intent uncertainty by assumption", async () => {
    const rendered = await renderMatrix("evaluator");
    for (const entry of PROMPT_MATRIX) {
      const prompt = rendered[entry.id];
      expect(prompt).toContain("CONSULT, DON'T ASSUME");
      expect(prompt).toContain("prefer consulting Alice over resolving that uncertainty by assumption");
      // Guessing, conceding, and vibes-acceptance are all named as the failure mode.
      expect(prompt).toContain("deciding for them what only they can decide");
      // evaluator does NOT carry the skeptic gate.
      expect(prompt).not.toContain("a gate, not a preference");
    }
  });

  it("skeptic sharpens the consult rule into a gate: unverified alignment is a reason NOT to proceed", async () => {
    const rendered = await renderMatrix("skeptic");
    for (const entry of PROMPT_MATRIX) {
      const prompt = rendered[entry.id];
      expect(prompt).toContain("CONSULT, DON'T ASSUME");
      expect(prompt).toContain("a gate, not a preference");
      expect(prompt).toContain(
        "an UNVERIFIED assumption that the two sides' intents actually align is a reason NOT to proceed",
      );
      expect(prompt).toContain("consulting Alice is how that assumption gets verified");
    }
  });

  it("the consult rule stays conditional — no wording that fights the ask-rounds cap", () => {
    for (const stance of ["evaluator", "skeptic"] as const)
    for (const seat of ["initiator", "counterparty"] as const) {
      const rules = stanceActionRules(stance, seat);
      // Conditional on client-resolvable uncertainty, never an unconditional urge:
      // when the cap is reached the action is simply not offered, and the prompt
      // must not push against that.
      expect(rules).not.toMatch(/always/i);
      expect(rules).not.toMatch(/regardless/i);
      expect(rules).not.toMatch(/every turn/i);
      expect(rules).toContain("when your judgment turns on a fact about {userName}'s OWN intent");
    }
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

/**
 * Responder verification (the sibling of the consult-propensity fragment).
 *
 * The failure it exists for: a first-contact outreach accepted in one
 * exchange, where the accept's reasoning restated the OPENING's own fit claim
 * — the initiator's agent characterizing what this client wants — as the
 * reason for accepting. Two fragments answer it, and both are duties of the
 * seat that did not open, so seat-scoping is the invariant this file pins
 * hardest: initiator prompts must stay free of responder-facing copy in both
 * directions.
 *
 * Seats here are the RESOLVED ones. Under v1 there is no `seat` on the input
 * at all, so the `isDiscoverer` fallback decides it: `v1` (not the discoverer)
 * responds, `v1-discovery-query` (the discoverer) opens. Those two entries are
 * what make the derivation itself a checked claim.
 */
const OPENING_MARKER = "THE OPENING IS ADVOCACY, NOT EVIDENCE";
const SPEND_MARKER = "WHAT ACCEPTING SPENDS";
const SKEPTIC_RESPONDER_MARKER = "an accept on the first exchange is the exception, not the default";

/**
 * The responder-only tail of a stance's action rules: what the responding seat
 * gets and the initiating seat does not. Derived by subtraction rather than by
 * re-quoting the fragment, so it stays honest if the wording moves.
 */
function responderPortion(stance: NegotiatorStance): string {
  const initiator = stanceActionRules(stance, "initiator");
  const counterparty = stanceActionRules(stance, "counterparty");
  expect(counterparty.startsWith(initiator)).toBe(true);
  return counterparty.slice(initiator.length);
}

/** Matrix entries whose RESOLVED seat is the responding one. */
const RESPONDER_IDS = ["v2-counterparty", "v2-counterparty-discovery-query", "v1"];
const INITIATOR_IDS = PROMPT_MATRIX.map((e) => e.id).filter((id) => !RESPONDER_IDS.includes(id));

describe("responder verification — the opening is a claim, not evidence", () => {
  it("covers both resolved seats in the matrix, v1 fallback included", () => {
    // Guards the two id lists above against drifting out of the matrix.
    expect(RESPONDER_IDS.every((id) => PROMPT_MATRIX.some((e) => e.id === id))).toBe(true);
    expect(INITIATOR_IDS).toContain("v1-discovery-query");
    expect(INITIATOR_IDS).toContain("v2-initiator");
  });

  it("renders on responder turns under evaluator and skeptic", async () => {
    for (const stance of ["evaluator", "skeptic"]) {
      const rendered = await renderMatrix(stance);
      for (const id of RESPONDER_IDS) {
        const prompt = rendered[id];
        expect(prompt).toContain(OPENING_MARKER);
        expect(prompt).toContain("is that agent's CLAIM about Alice, not a fact you have checked");
        expect(prompt).toContain("Restating the opening's fit claim back as your reason is agreement, not verification");
        expect(prompt).toContain(SPEND_MARKER);
        // The opportunity-cost currency restated in the terms this seat spends it.
        expect(prompt).toContain("it puts a connection in front of Alice for approval");
        expect(prompt).toContain('"Would Alice be open to connecting?" is a bar almost anything clears');
        // The grounding bar and the two cheap moves when it is not met.
        expect(prompt).toContain("what Alice themselves stated they were looking for");
        expect(prompt).toContain("the cheap move is one more exchange");
        expect(prompt).toContain("consulting Alice settles it instead");
      }
    }
  });

  it("never renders under advocate — on any seat", async () => {
    for (const stance of [undefined, "advocate", "nonsense-stance"]) {
      const rendered = await renderMatrix(stance);
      for (const entry of PROMPT_MATRIX) {
        expect(rendered[entry.id]).not.toContain(OPENING_MARKER);
        expect(rendered[entry.id]).not.toContain(SPEND_MARKER);
        expect(rendered[entry.id]).not.toContain(SKEPTIC_RESPONDER_MARKER);
      }
    }
  });

  it("never leaks onto an initiator turn under any stance", async () => {
    for (const stance of NEGOTIATOR_STANCES) {
      const rendered = await renderMatrix(stance);
      for (const id of INITIATOR_IDS) {
        expect(rendered[id]).not.toContain(OPENING_MARKER);
        expect(rendered[id]).not.toContain(SPEND_MARKER);
        expect(rendered[id]).not.toContain(SKEPTIC_RESPONDER_MARKER);
      }
    }
  });

  it("leaves the seat-blind fragments identical on both seats", () => {
    for (const stance of ["evaluator", "skeptic"] as const) {
      const initiator = stanceActionRules(stance, "initiator");
      const counterparty = stanceActionRules(stance, "counterparty");
      // The responder rules are strictly appended: the initiator's rendering is
      // a prefix of the responder's, so the value bar and consult propensity
      // cannot fork by seat.
      expect(counterparty.startsWith(initiator)).toBe(true);
      expect(counterparty.length).toBeGreaterThan(initiator.length);
      expect(initiator).not.toContain(OPENING_MARKER);
      expect(initiator).not.toContain(SPEND_MARKER);
    }
  });

  it("skeptic sharpens the responder rule additively over evaluator", async () => {
    const evaluator = await renderMatrix("evaluator");
    const skeptic = await renderMatrix("skeptic");
    for (const id of RESPONDER_IDS) {
      // Everything the evaluator says about the opening survives verbatim.
      expect(evaluator[id]).toContain(OPENING_MARKER);
      expect(skeptic[id]).toContain(OPENING_MARKER);
      expect(evaluator[id]).not.toContain(SKEPTIC_RESPONDER_MARKER);
      expect(skeptic[id]).toContain(SKEPTIC_RESPONDER_MARKER);
      expect(skeptic[id]).toContain("probe once before accepting");
      expect(skeptic[id]).toContain("one exchange costs the counterparty nothing and Alice very little");
    }
    // Additive at the fragment level too: the whole evaluator responder body
    // survives verbatim inside the skeptic's, which only appends to it.
    expect(stanceActionRules("skeptic", "counterparty")).toContain(responderPortion("evaluator"));
  });

  it("does not urge unconditional probing — the steer is conditional on the opening carrying the fit case", () => {
    for (const stance of ["evaluator", "skeptic"] as const) {
      const portion = responderPortion(stance);
      // No blanket instruction in either direction: a match the client's own
      // criteria independently support may still be accepted on first contact.
      expect(portion).not.toMatch(/never accept/i);
      expect(portion).not.toMatch(/\balways\b/i);
      expect(portion).not.toMatch(/\bnever\b/i);
      // Both fragments are conditioned on the fit case resting on the opening.
      expect(portion).toContain("Where the case for fit still rests on how the other agent characterized");
    }
    // The skeptic's sharpening keeps the escape hatch explicit: an
    // independently supported match may still be accepted on first contact.
    expect(stanceActionRules("skeptic", "counterparty")).toContain(
      "Where {userName}'s stated criteria and the counterparty's own evidence carry the fit without that characterization, accepting straight away is still the right call",
    );
  });

  it("renders on every responder turn shape, not only the matrix ones", async () => {
    const responderBase = PROMPT_MATRIX.find((e) => e.id === "v2-counterparty")!.input;
    const shapes: Array<[string, NegotiationAgentInput, string]> = [
      // The exact shape the failure came from: one opening turn to respond to.
      ["first response", { ...responderBase, history: responderBase.history.slice(0, 1) }, "accept"],
      ["final turn", { ...responderBase, isFinalTurn: true }, "accept"],
      ["with consult grant", { ...responderBase, canAskUser: true }, "accept"],
      ["continuation", { ...responderBase, isContinuation: true }, "accept"],
    ];
    for (const [, input, action] of shapes) {
      const prompt = await renderPrompt(input, "skeptic", action);
      expect(prompt).toContain(OPENING_MARKER);
      expect(prompt).toContain(SPEND_MARKER);
      expect(prompt).toContain(SKEPTIC_RESPONDER_MARKER);
    }
  });

  it("names no action and no mechanism the responding seat may not hold", async () => {
    for (const stance of ["evaluator", "skeptic"] as const) {
      const rules = stanceActionRules(stance, "counterparty");
      // Same discipline as every other fragment here: the seat's own rules and
      // the graph's grants decide which token carries "one more exchange".
      expect(rules).not.toContain("ask_user");
      expect(rules).not.toContain('"withdraw"');
      expect(rules).not.toContain('"question"');
      expect(rules).not.toContain('"accept"');
      expect(rules).not.toContain('"counter"');
      expect(rules).not.toContain('"decline"');
      expect(rules).not.toContain('"outreach"');
    }
    // And the rendered responder prompts still carry no withdraw vocabulary.
    for (const stance of NEGOTIATOR_STANCES) {
      const rendered = await renderMatrix(stance);
      for (const id of RESPONDER_IDS) {
        expect(rendered[id]).not.toContain('"withdraw"');
        expect(rendered[id]).not.toContain("ask_user");
      }
    }
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
