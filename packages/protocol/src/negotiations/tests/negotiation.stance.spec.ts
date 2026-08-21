import { describe, it, expect } from "bun:test";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { JOB_FRAMING, negotiatorActionRules, querySatisfiedRule } from "../negotiation.stance.contracts.js";
import { renderStalemateShiftSection } from "../negotiation.deadlock.js";
import { PROMPT_MATRIX } from "./fixtures/negotiator-prompt-matrix.js";

/**
 * The negotiator's drafting stance (IND-611).
 *
 * There is one stance now — the former `skeptic` — so this file no longer pins
 * differences between stances. What it pins is the law that stance renders:
 * the checklist protocol, the basis discipline, the ask rule, the verdict rule,
 * the responding seat's scoring duty, and the stalemate deadlock resolution.
 *
 * The load-bearing invariants are unchanged. Fragments render into every seat
 * and both protocol versions, so they must never introduce a quoted
 * `"withdraw"` into a seat that has no withdraw, and must never name `ask_user`
 * where the grant is absent. The seat-blind/responder-only split is checked by
 * subtraction in `responderPortion`, so it stays honest if the wording moves.
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

/** Render the whole prompt matrix. */
async function renderMatrix(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of PROMPT_MATRIX) {
    const agent = new CapturingNegotiator(validTurn(entry.action));
    await agent.invoke(entry.input as NegotiationAgentInput);
    out[entry.id] = agent.prompt;
  }
  return out;
}

/** Render one ad-hoc input — for shapes outside the fixed matrix. */
async function renderPrompt(input: NegotiationAgentInput, action: string): Promise<string> {
  const agent = new CapturingNegotiator(validTurn(action));
  await agent.invoke(input);
  return agent.prompt;
}

describe("job framing and the opportunity-cost bar", () => {
  it("asks for assessment before advocacy and carries the not-worth-making prior", async () => {
    const prompt = (await renderMatrix())["v2-initiator"];
    expect(prompt).toContain("Assess before you advocate");
    expect(prompt).toContain("Advocate only for a match that survives that judgment");
    expect(prompt).toContain("most candidate matches are NOT worth making");
    expect(prompt).toContain("OPPORTUNITY COST");
    expect(prompt).toContain("Alice's attention is finite");
    // The negative-only bar is not the last word on declining.
    expect(prompt).toContain('The bar is "worth that spend", not "does no harm"');
  });

  it("leaves the {userName} placeholder for the caller's global replace", () => {
    expect(JOB_FRAMING).toContain("{userName}");
  });

  it("prefers consulting the client over resolving intent uncertainty by assumption", async () => {
    const rendered = await renderMatrix();
    for (const entry of PROMPT_MATRIX) {
      const prompt = rendered[entry.id];
      expect(prompt).toContain("CONSULT, DON'T ASSUME");
      expect(prompt).toContain("prefer consulting Alice over resolving that uncertainty by assumption");
      expect(prompt).toContain("deciding for them what only they can decide");
      // Sharpened into a gate: an unverified assumption is a reason not to proceed.
      expect(prompt).toContain("a gate, not a preference");
      expect(prompt).toContain(
        "an UNVERIFIED assumption that the two sides' intents actually align is a reason NOT to proceed",
      );
      expect(prompt).toContain("consulting Alice is how that assumption gets verified");
    }
  });

  it("the consult rule stays conditional — no wording that fights the ask-rounds cap", () => {
    for (const seat of ["initiator", "counterparty"] as const) {
      const rules = negotiatorActionRules(seat);
      // Conditional on client-resolvable uncertainty, never an unconditional urge:
      // when the cap is reached the action is simply not offered, and the prompt
      // must not push against that.
      expect(rules).not.toMatch(/always/i);
      expect(rules).not.toMatch(/regardless/i);
      expect(rules).not.toMatch(/every turn/i);
      expect(rules).toContain("when your judgment turns on a fact about {userName}'s OWN intent");
    }
  });

  it("query satisfaction is necessary-not-sufficient", async () => {
    const rendered = await renderMatrix();
    for (const id of ["v2-initiator-discovery-query", "v1-discovery-query"]) {
      const prompt = rendered[id];
      expect(prompt).toContain("PRECONDITION for continuing to evaluate, NOT a reason to connect");
      expect(prompt).not.toContain("PROPOSE or ACCEPT the connection");
      // The mismatch half of the query rule is untouched.
      expect(prompt).toContain("does NOT satisfy the query: REJECT the match");
    }
    expect(querySatisfiedRule("Bob", "Alice")).toContain(
      "satisfying the query is a PRECONDITION for continuing to evaluate",
    );
  });

  it("the query rule never appears on a prompt that has no discovery query", async () => {
    const rendered = await renderMatrix();
    expect(rendered["v2-initiator"]).not.toContain("PRECONDITION for continuing to evaluate");
  });
});

/**
 * The checklist protocol (docs/plans/2026-08-19-checklist-negotiations.md).
 *
 * What it replaced and why the replacement is not a loss:
 *
 * - The evidence-provenance rule (#1448) is now the `basis` discipline. It was
 *   written for circular verification — an accept grounded in the same
 *   negotiator's earlier acceptances — and as a free-standing duty it was a
 *   standard the agent graded itself against. As a basis rule it is a property
 *   of the artifact: a score with nothing behind it is repaired back to
 *   `unknown` in `negotiation.checklist.contracts.ts`, so an unbacked `ok`
 *   cannot conclude a match even when the agent believes it. The prompt half
 *   is pinned here; the repair half is pinned in the checklist spec.
 * - The responder verification rules (#1446) are now the responding seat's
 *   scoring duty, and stay seat-scoped for the same reason they always were.
 *
 * Seat-blindness is the load-bearing invariant of the block below: the
 * checklist, its basis discipline, the ask rule and the verdict law are duties
 * of BOTH seats, so they render in the shared prefix — which is what the
 * strict-prefix assertion in `responderPortion` keeps honest.
 */
const CHECKLIST_MARKER = "THE CHECKLIST DECIDES, NOT YOUR IMPRESSION";
const BASIS_MARKER = "SCORE ONLY FROM WHAT SOMEONE STATED";
const PROVENANCE_MARKER = "YOUR OWN RECORD IS DECISIONS, NOT COMMITMENTS";
const UNKNOWN_MARKER = "UNKNOWN IS A REAL SCORE, NOT A GAP TO PAPER OVER";
const ASK_MARKER = "IS THE ORDINARY WAY TO RESOLVE AN UNKNOWN";
const ANSWERHOOD_MARKER = "ONE DIMENSION PER QUESTION, WITH ITS ANSWERHOOD DECLARED FIRST";
const VERDICT_MARKER = "THE VERDICT IS A FUNCTION OF THE CHECKLIST";
const CHEAP_ANSWER_MARKER = "your prior makes ending the negotiation the cheap answer";

describe("checklist protocol — the pre-registered screen", () => {
  it("renders the whole protocol on EVERY prompt in the matrix", async () => {
    const rendered = await renderMatrix();
    for (const entry of PROMPT_MATRIX) {
      const prompt = rendered[entry.id];
      for (const marker of [CHECKLIST_MARKER, BASIS_MARKER, PROVENANCE_MARKER, UNKNOWN_MARKER, ASK_MARKER, ANSWERHOOD_MARKER, VERDICT_MARKER]) {
        expect(prompt).toContain(marker);
      }
    }
  });

  it("pre-registers 3–5 dimensions with mutual want, and freezes them", async () => {
    const prompt = (await renderMatrix())["v2-initiator"];
    expect(prompt).toContain("explicit checklist of 3 to 5 dimensions");
    expect(prompt).toContain("On the FIRST turn you write it, from the two intents alone");
    expect(prompt).toContain("one dimension for MUTUAL WANT");
    expect(prompt).toContain("what a match IS");
    // The freeze, in both directions: nothing added, nothing quietly dropped.
    expect(prompt).toContain("The checklist is FIXED once written");
    expect(prompt).toContain("no dimension is added because the exchange went somewhere you did not expect");
    expect(prompt).toContain("none is quietly dropped because it turned inconvenient");
    // A dimension no answer could flip is not a dimension — but the caveat
    // must not read as licence to under-fill, which is exactly how it read to
    // a live model: it drafted two dimensions and the checklist was discarded.
    expect(prompt).toContain("is decoration, not a dimension");
    expect(prompt).toContain("three is a FLOOR, not a target you may fall short of");
    expect(prompt).toContain("add the dimension whose answer would most change your mind");
  });

  it("binds scoring to the commitment record and carries the provenance rule into the basis", async () => {
    const prompt = (await renderMatrix())["v2-counterparty"];
    expect(prompt).toContain("scored ok or conflict from the commitment record alone");
    expect(prompt).toContain("their own intents, the premises they hold, and the answers they have given");
    // A profile is background, never a basis. The plan's commitment store is
    // what the principals STATED they want (§2) — and the live failure this
    // pins is a hard constraint about where two people could climb together
    // being scored `ok` from a bio line ("Product designer in Istanbul"). With
    // profiles admissible, a well-populated dataset ticks every dimension
    // without anyone being asked anything, and the protocol never asks.
    expect(prompt).toContain("A PROFILE IS BACKGROUND, NOT A COMMITMENT");
    expect(prompt).toContain("describe who someone IS; a commitment is what they have said they WANT");
    expect(prompt).toContain("Where only a profile speaks to a dimension, that dimension is unknown");
    expect(prompt).toContain("Write that commitment into the dimension's basis");
    expect(prompt).toContain("A score with nothing behind it is an assertion rather than a finding");
    // #1448, rewritten rather than restated: the three sources that get
    // mistaken for evidence are all still named, now as non-commitments.
    expect(prompt).toContain("your earlier turns");
    expect(prompt).toContain("the connections you proposed or accepted on Alice's behalf");
    expect(prompt).toContain("the conclusions you carry in memory");
    expect(prompt).toContain("re-asserts a judgment instead of checking it");
    expect(prompt).toContain("reads your own past eagerness back as Alice's interest");
    // And unknown stays unknown rather than being rounded up.
    expect(prompt).toContain("Do not round it to ok because nothing contradicts it");
  });

  it("does not ban memory or prior dialogue — it re-scopes what they establish", () => {
    for (const seat of ["initiator", "counterparty"] as const) {
      const rules = negotiatorActionRules(seat);
      // Memory keeps its job: the rule changes what may SCORE a dimension, not
      // what gets injected (`renderNegotiatorMemorySection` is untouched), so
      // no wording may tell the negotiator to drop it.
      expect(rules).toContain("Prior dialogue and memory keep their job");
      expect(rules).toContain("what has already been asked");
      expect(rules).toContain("the history of the argument, not commitments in it");
      expect(rules).not.toMatch(/ignore (your |the )?(prior |negotiator )?(dialogue|memory|memories)/i);
      expect(rules).not.toMatch(/disregard/i);
      expect(rules).not.toMatch(/do not use (your )?memory/i);
    }
  });

  it("states the five-part ask rule and demands the answerhood map before the question", async () => {
    const prompt = (await renderMatrix())["v2-initiator"];
    expect(prompt).toContain("ASKING Alice IS THE ORDINARY WAY TO RESOLVE AN UNKNOWN, not a last resort");
    expect(prompt).toContain("(1) the dimension is unknown");
    expect(prompt).toContain("(2) some plausible answer would change the verdict");
    expect(prompt).toContain("(3) the missing fact is Alice's own to hold");
    expect(prompt).toContain("(4) that topic has not been asked in this negotiation");
    expect(prompt).toContain("(5) their question budget is not spent");
    expect(prompt).toContain("Fail any one of the five and do not ask");
    // Pivotality is proved by writing the map, not asserted after the fact.
    expect(prompt).toContain("say what kind of answer would score that dimension ok and what kind would score it conflict");
    expect(prompt).toContain("no answer would flip anything and the question must not be asked");
    // Charitable closure, and one ask per topic however it is worded.
    expect(prompt).toContain("a vague but non-negative answer counts as ok");
    expect(prompt).toContain("raising the same topic again in different words is a repeat");
  });

  it("makes the verdict a function of the checklist — unknowns never end a negotiation", async () => {
    const prompt = (await renderMatrix())["v2-initiator"];
    expect(prompt).toContain("conclude in favour of the match when every dimension is ok");
    // The stopping rule: a spent budget with no conflict is a match.
    expect(prompt).toContain("which is where a spent question budget leaves you");
    // Elimination by aspects, with the commitment named.
    expect(prompt).toContain("End the negotiation against the match when a dimension is in conflict");
    expect(prompt).toContain("An unknown is not a reason to end anything");
    // Matching means worth a first conversation, and nothing about terms.
    expect(prompt).toContain('A MATCH MEANS "WORTH A FIRST CONVERSATION", NOTHING MORE');
    expect(prompt).toContain("Deal terms, valuation, equity and logistics stay outside this dialogue");
  });

  it("sharpens the ask rule against the stance's own prior", async () => {
    const rendered = await renderMatrix();
    for (const entry of PROMPT_MATRIX) {
      expect(rendered[entry.id]).toContain(CHEAP_ANSWER_MARKER);
    }
    // The sharpening exists because the cheap answer is to walk: an unknown
    // treated as grounds to end decides for the client just as much.
    expect(rendered["v2-initiator"]).toContain("decides for Alice just as much as a match closed on a guess");
  });

  it("lives in the seat-blind prefix, not in the responder-only tail", () => {
    // Both seats hold every part of the protocol...
    for (const seat of ["initiator", "counterparty"] as const) {
      const rules = negotiatorActionRules(seat);
      for (const marker of [CHECKLIST_MARKER, BASIS_MARKER, PROVENANCE_MARKER, ASK_MARKER, VERDICT_MARKER]) {
        expect(rules).toContain(marker);
      }
    }
    // ...so none of it is in the responder-only portion, and the strict
    // prefix invariant (asserted inside `responderPortion`) still holds.
    const portion = responderPortion();
    for (const marker of [CHECKLIST_MARKER, BASIS_MARKER, PROVENANCE_MARKER, ASK_MARKER, VERDICT_MARKER]) {
      expect(portion).not.toContain(marker);
    }
  });

  it("reads in the order it is used: checklist, basis, ask, verdict, then the responder rules", () => {
    const rules = negotiatorActionRules("counterparty");
    const at = (marker: string) => rules.indexOf(marker);
    expect(at(CHECKLIST_MARKER)).toBeGreaterThan(at("CONSULT, DON'T ASSUME"));
    expect(at(BASIS_MARKER)).toBeGreaterThan(at(CHECKLIST_MARKER));
    expect(at(ASK_MARKER)).toBeGreaterThan(at(BASIS_MARKER));
    expect(at(VERDICT_MARKER)).toBeGreaterThan(at(ASK_MARKER));
    // The responder rules land last, after the basis discipline they specialize.
    expect(at(OPENING_MARKER)).toBeGreaterThan(at(VERDICT_MARKER));
  });

  it("names no action and no mechanism", () => {
    for (const seat of ["initiator", "counterparty"] as const) {
      const rules = negotiatorActionRules(seat);
      const protocol = rules.slice(rules.indexOf(CHECKLIST_MARKER));
      expect(protocol).not.toContain("ask_user");
      for (const token of ['"withdraw"', '"accept"', '"counter"', '"decline"', '"question"', '"outreach"']) {
        expect(protocol).not.toContain(token);
      }
    }
  });
});

/**
 * Responder scoring — the #1446 duties, rewritten as scoring rules.
 *
 * The failure they exist for: a first-contact outreach accepted in one
 * exchange, where the accept's reasoning restated the OPENING's own fit claim
 * — the initiator's agent characterizing what this client wants — as the
 * reason for accepting. Under the checklist protocol that move has a sharper
 * name: the opening is not a commitment, so it cannot be the BASIS for a
 * dimension, and the dimension it would score is the one mutuality itself
 * rests on. Both rules are duties of the seat that did not open, so
 * seat-scoping stays the invariant this file pins hardest.
 *
 * Seats here are the RESOLVED ones. Under v1 there is no `seat` on the input
 * at all, so the `isDiscoverer` fallback decides it: `v1` (not the discoverer)
 * responds, `v1-discovery-query` (the discoverer) opens. Those two entries are
 * what make the derivation itself a checked claim.
 */
const OPENING_MARKER = "THE OPENING IS ADVOCACY, NOT A COMMITMENT";
const SPEND_MARKER = "WHAT AGREEING SPENDS";
const RESPONDER_PATIENCE_MARKER = "closing while a pivotal dimension is still unknown is the exception rather than the default";

/**
 * The responder-only tail of the action rules: what the responding seat gets
 * and the initiating seat does not. Derived by subtraction rather than by
 * re-quoting the fragment, so it stays honest if the wording moves.
 */
function responderPortion(): string {
  const initiator = negotiatorActionRules("initiator");
  const counterparty = negotiatorActionRules("counterparty");
  expect(counterparty.startsWith(initiator)).toBe(true);
  return counterparty.slice(initiator.length);
}

/** Matrix entries whose RESOLVED seat is the responding one. */
const RESPONDER_IDS = ["v2-counterparty", "v2-counterparty-discovery-query", "v1"];
const INITIATOR_IDS = PROMPT_MATRIX.map((e) => e.id).filter((id) => !RESPONDER_IDS.includes(id));

describe("responder scoring — the opening is a claim, not a commitment", () => {
  it("covers both resolved seats in the matrix, v1 fallback included", () => {
    // Guards the two id lists above against drifting out of the matrix.
    expect(RESPONDER_IDS.every((id) => PROMPT_MATRIX.some((e) => e.id === id))).toBe(true);
    expect(INITIATOR_IDS).toContain("v1-discovery-query");
    expect(INITIATOR_IDS).toContain("v2-initiator");
  });

  it("renders on responder turns", async () => {
    const rendered = await renderMatrix();
    for (const id of RESPONDER_IDS) {
      const prompt = rendered[id];
      expect(prompt).toContain(OPENING_MARKER);
      expect(prompt).toContain("is that agent's CLAIM about them");
      // The opening cannot be a basis, least of all for mutual want.
      expect(prompt).toContain("it cannot be the basis for any dimension, least of all mutual want");
      expect(prompt).toContain("Score that one from Alice's OWN intent");
      expect(prompt).toContain("Restating the opening's fit claim back as your basis is agreement, not scoring");
      expect(prompt).toContain(SPEND_MARKER);
      // The opportunity-cost currency restated in the terms this seat spends
      // it, and pointed at the checklist as what the answer comes from.
      expect(prompt).toContain("agreeing puts a connection in front of Alice for approval");
      expect(prompt).toContain('"Would Alice be open to connecting?" is a bar almost anything clears');
      expect(prompt).toContain("it is not the bar — the checklist is");
      // The two-sided handshake: agree when nothing conflicts AND nothing
      // pivotal is open. The live failure this pins is a responder that
      // accepted on its first turn every time — closing the negotiation
      // before the initiator ever reached a turn on which it could ask.
      expect(prompt).toContain("your checklist holds no conflict AND nothing pivotal is still unknown, close it");
      expect(prompt).toContain("is the same guess the initiator would be making, taken from the other chair");
      // And the patience sharpening rides with them.
      expect(prompt).toContain(RESPONDER_PATIENCE_MARKER);
      expect(prompt).toContain("spend one question or one exchange before you close");
      expect(prompt).toContain("costs the counterparty nothing and Alice very little");
    }
  });

  it("never leaks onto an initiator turn", async () => {
    const rendered = await renderMatrix();
    for (const id of INITIATOR_IDS) {
      expect(rendered[id]).not.toContain(OPENING_MARKER);
      expect(rendered[id]).not.toContain(SPEND_MARKER);
      expect(rendered[id]).not.toContain(RESPONDER_PATIENCE_MARKER);
    }
  });

  it("leaves the seat-blind fragments identical on both seats", () => {
    const initiator = negotiatorActionRules("initiator");
    const counterparty = negotiatorActionRules("counterparty");
    // The responder rules are strictly appended: the initiator's rendering is
    // a prefix of the responder's, so the value bar, the consult propensity
    // and the whole checklist protocol cannot fork by seat.
    expect(counterparty.startsWith(initiator)).toBe(true);
    expect(counterparty.length).toBeGreaterThan(initiator.length);
    expect(initiator).not.toContain(OPENING_MARKER);
    expect(initiator).not.toContain(SPEND_MARKER);
  });

  it("does not urge unconditional probing — the steer is conditional on what is unscored", () => {
    const portion = responderPortion();
    // No blanket instruction in either direction: a match whose dimensions
    // score from the client's own intent may still be closed on first contact.
    expect(portion).not.toMatch(/never accept/i);
    expect(portion).not.toMatch(/\balways\b/i);
    expect(portion).not.toMatch(/\bnever\b/i);
    // Conditioned on a dimension actually being unscored.
    expect(portion).toContain("Where a pivotal dimension is still unknown");
    // And the escape hatch stays explicit: a checklist that already scores may
    // be closed on first contact.
    expect(portion).toContain(
      "Where {userName}'s own intent and the counterparty's own evidence already score every dimension, closing straight away is still the right call",
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
      const prompt = await renderPrompt(input, action);
      expect(prompt).toContain(OPENING_MARKER);
      expect(prompt).toContain(SPEND_MARKER);
      expect(prompt).toContain(RESPONDER_PATIENCE_MARKER);
    }
  });

  it("names no action and no mechanism the responding seat may not hold", async () => {
    const rules = negotiatorActionRules("counterparty");
    // Same discipline as every other fragment here: the seat's own rules and
    // the graph's grants decide which token carries "one more exchange".
    expect(rules).not.toContain("ask_user");
    for (const token of ['"withdraw"', '"question"', '"accept"', '"counter"', '"decline"', '"outreach"']) {
      expect(rules).not.toContain(token);
    }
    // And the rendered responder prompts still carry no withdraw vocabulary.
    const rendered = await renderMatrix();
    for (const id of RESPONDER_IDS) {
      expect(rendered[id]).not.toContain('"withdraw"');
      expect(rendered[id]).not.toContain("ask_user");
    }
  });
});

describe("deadlock resolution", () => {
  const input = { active: true, userName: "Alice", consecutiveNonConvergent: 4 };

  it("resolves a deadlock as a stalemate rather than by concession", () => {
    const section = renderStalemateShiftSection(input);
    expect(section).toContain("THE MERITS ARE EXHAUSTED");
    expect(section).not.toContain("SHIFT FROM PERSUASION TO BARGAINING");
    expect(section).toContain("Do NOT buy agreement with a concession or a reduced scope");
    expect(section).toContain("An unresolved disagreement is an acceptable outcome");
    // Stance-only: the action vocabulary is untouched.
    expect(section).toContain("your available actions are unchanged");
  });

  it("renders empty when inactive", () => {
    expect(renderStalemateShiftSection({ ...input, active: false })).toBe("");
  });

  it("never names ask_user", () => {
    expect(renderStalemateShiftSection(input)).not.toContain("ask_user");
  });
});

describe("seat and version invariants", () => {
  it("no quoted withdraw leaks into v1 or the v2 counterparty seat", async () => {
    const rendered = await renderMatrix();
    for (const id of ["v1", "v1-discovery-query", "v2-counterparty", "v2-counterparty-discovery-query"]) {
      expect(rendered[id]).not.toContain('"withdraw"');
      expect(rendered[id]).not.toContain("WITHDRAW ON DISQUALIFYING INFORMATION");
    }
  });

  it("ask_user is never named when the grant is absent, and the grant still renders it", async () => {
    const rendered = await renderMatrix();
    expect(rendered["v2-initiator"]).not.toContain("ask_user");
    expect(rendered["v1"]).not.toContain("ask_user");
    expect(rendered["v2-counterparty"]).not.toContain("ask_user");
    expect(rendered["v2-initiator-ask-user"]).toContain('"ask_user"');
  });

  it("the IND-570 withdraw rule survives unchanged on the v2 initiator", async () => {
    const rendered = await renderMatrix();
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
  });

  it("the final-turn instruction is untouched", async () => {
    const rendered = await renderMatrix();
    expect(rendered["v2-initiator-final"]).toContain(
      "IMPORTANT: This is your FINAL turn. You MUST choose either 'withdraw' or 'counter'.",
    );
  });
});
