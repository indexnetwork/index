import { describe, it, expect, afterEach } from "bun:test";

import { MAX_CHECKLIST_DIMENSIONS, MIN_CHECKLIST_DIMENSIONS, NegotiationChecklistSchema, QUESTION_BUDGET_PER_PRINCIPAL, assessAskAdmissibility, authorChecklist, checklistFromTurns, checklistVerdictState, configuredQuestionBudgetPerPrincipal, isChecklistAuthored, normalizeChecklistDraft, reconcileChecklist, renderChecklistSection, type ChecklistDraftItem, type ChecklistItem } from "../negotiation.checklist.contracts.js";

/**
 * The checklist: a pre-registered conjunctive screen
 * (docs/plans/2026-08-19-checklist-negotiations.md §2–§4, §6).
 *
 * Three properties this file exists to pin, because the prompt cannot pin them
 * itself — a rule an agent is asked to follow is not a rule until something
 * enforces it:
 *
 *  1. **The freeze.** Dimensions are authored once and only re-scored. Nothing
 *     later may add, drop or rename one, whatever the draft says.
 *  2. **The basis discipline.** A score is admissible only with the commitment
 *     it came from, and every repair falls toward `unknown` — never toward
 *     `ok`. This is the machine-checkable form of the provenance rule.
 *  3. **Ask admissibility.** Each condition of the plan's five-part rule has a
 *     negative case here; the rule is what makes asking the default move for
 *     an unknown without making it unbounded.
 */

const item = (
  name: string,
  kind: ChecklistItem["kind"],
  result: ChecklistItem["result"],
  basis = "",
): ChecklistDraftItem => ({ name, kind, result, basis });

/** A well-formed turn-1 authoring: mutual want plus two decision-relevant dimensions. */
const draft = (): ChecklistDraftItem[] => [
  item("Mutual want", "mutual_want", "ok", "Alice's intent seeks an ML engineer; Bob's intent seeks applied ML work"),
  item("Location", "fit", "unknown"),
  item("Stage fit", "fit", "unknown"),
];

const authored = (): ChecklistItem[] => authorChecklist(draft())!;

describe("checklist authoring — pre-registration on turn 1", () => {
  it("authors 3–5 dimensions with mutual want present", () => {
    const checklist = authorChecklist(draft());
    expect(checklist).not.toBeNull();
    expect(checklist!.length).toBeGreaterThanOrEqual(MIN_CHECKLIST_DIMENSIONS);
    expect(checklist!.length).toBeLessThanOrEqual(MAX_CHECKLIST_DIMENSIONS);
    expect(checklist!.some((entry) => entry.kind === "mutual_want")).toBe(true);
    expect(NegotiationChecklistSchema.safeParse(checklist).success).toBe(true);
  });

  it("refuses a checklist with no mutual-want dimension — mutuality is what a match IS", () => {
    expect(authorChecklist([
      item("Location", "fit", "unknown"),
      item("Stage fit", "fit", "unknown"),
      item("Timing", "fit", "unknown"),
    ])).toBeNull();
  });

  it("refuses a checklist too thin to screen anything", () => {
    expect(authorChecklist([
      item("Mutual want", "mutual_want", "unknown"),
      item("Location", "fit", "unknown"),
    ])).toBeNull();
  });

  it("trims an over-long draft to the cap without dropping mutual want", () => {
    const long = [
      item("Location", "fit", "unknown"),
      item("Stage fit", "fit", "unknown"),
      item("Timing", "fit", "unknown"),
      item("Budget", "hard_constraint", "unknown"),
      item("Format", "fit", "unknown"),
      item("Mutual want", "mutual_want", "unknown"),
      item("Vibe", "fit", "unknown"),
    ];
    const checklist = authorChecklist(long)!;
    expect(checklist.length).toBe(MAX_CHECKLIST_DIMENSIONS);
    expect(checklist.some((entry) => entry.kind === "mutual_want")).toBe(true);
  });

  it("de-duplicates dimensions that differ only in case or spacing", () => {
    const checklist = authorChecklist([
      ...draft(),
      item("  location ", "fit", "unknown"),
      item("LOCATION", "hard_constraint", "unknown"),
    ])!;
    expect(checklist.filter((entry) => entry.name.toLowerCase().trim() === "location")).toHaveLength(1);
  });

  it("returns null rather than manufacturing a checklist from nothing", () => {
    // Fail-open: the negotiation runs exactly as it does today and the next
    // turn drafts again. An invented dimension would be pre-registration in
    // name only.
    expect(authorChecklist([])).toBeNull();
    expect(isChecklistAuthored([])).toBe(false);
  });
});

describe("basis discipline — a score without a commitment is not a score", () => {
  it("rejects an ok or conflict with an empty basis, by schema", () => {
    for (const result of ["ok", "conflict"] as const) {
      const parsed = NegotiationChecklistSchema.safeParse([
        item("Mutual want", "mutual_want", result, ""),
        item("Location", "fit", "unknown"),
        item("Stage fit", "fit", "unknown"),
      ]);
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects an unknown that carries a basis", () => {
    const parsed = NegotiationChecklistSchema.safeParse([
      item("Mutual want", "mutual_want", "ok", "both intents state it"),
      item("Location", "fit", "unknown", "she seems flexible"),
      item("Stage fit", "fit", "unknown"),
    ]);
    expect(parsed.success).toBe(false);
  });

  it("repairs an unbacked ok DOWN to unknown, never the other way", () => {
    const [repaired] = normalizeChecklistDraft([item("Location", "fit", "ok", "   ")]);
    expect(repaired.result).toBe("unknown");
    expect(repaired.basis).toBe("");
  });

  it("drops the basis from an unknown rather than promoting the score", () => {
    const [repaired] = normalizeChecklistDraft([item("Location", "fit", "unknown", "vibes")]);
    expect(repaired.result).toBe("unknown");
    expect(repaired.basis).toBe("");
  });
});

describe("the freeze — later turns re-score and nothing else", () => {
  const frozen = authored();

  it("re-scores a dimension from a later draft, basis and all", () => {
    const next = reconcileChecklist(frozen, [item("Location", "fit", "ok", "Bob's profile says Berlin, Alice's intent says Berlin")]);
    const location = next.find((entry) => entry.name === "Location")!;
    expect(location.result).toBe("ok");
    expect(location.basis).toContain("Berlin");
  });

  it("ignores a dimension the checklist does not carry — nothing is ever added", () => {
    const next = reconcileChecklist(frozen, [item("Ticket size", "hard_constraint", "conflict", "invented mid-flight")]);
    expect(next.map((entry) => entry.name)).toEqual(frozen.map((entry) => entry.name));
  });

  it("keeps a dimension the draft omitted — nothing is ever dropped", () => {
    const scored = reconcileChecklist(frozen, [item("Location", "fit", "ok", "both say Berlin")]);
    const next = reconcileChecklist(scored, [item("Mutual want", "mutual_want", "ok", "both intents state it")]);
    expect(next.find((entry) => entry.name === "Location")!.result).toBe("ok");
    expect(next).toHaveLength(frozen.length);
  });

  it("keeps the frozen kind even when a later draft re-labels it", () => {
    const next = reconcileChecklist(frozen, [item("Location", "hard_constraint", "conflict", "Bob is in Lisbon")]);
    const location = next.find((entry) => entry.name === "Location")!;
    expect(location.kind).toBe("fit");
    expect(location.result).toBe("conflict");
  });

  it("applies the basis discipline to a re-score too", () => {
    const next = reconcileChecklist(frozen, [item("Location", "fit", "ok", "")]);
    expect(next.find((entry) => entry.name === "Location")!.result).toBe("unknown");
  });

  it("reads the current checklist off the last turn that carried one", () => {
    const scored = reconcileChecklist(authored(), [item("Location", "fit", "ok", "both say Berlin")]);
    const turns = [
      { checklist: authored() },
      { action: "counter" },
      { checklist: scored },
      { action: "question" },
    ] as Array<{ checklist?: ChecklistItem[] }>;
    expect(checklistFromTurns(turns).find((entry) => entry.name === "Location")!.result).toBe("ok");
    expect(checklistFromTurns([{ action: "outreach" }] as Array<{ checklist?: ChecklistItem[] }>)).toEqual([]);
  });
});

describe("verdict state — conflicts decide, unknowns never do", () => {
  it("reports all-ok only when nothing is unknown and nothing conflicts", () => {
    const allOk = reconcileChecklist(authored(), [
      item("Location", "fit", "ok", "both say Berlin"),
      item("Stage fit", "fit", "ok", "both state pre-seed"),
    ]);
    expect(checklistVerdictState(allOk).allOk).toBe(true);
  });

  it("surfaces a conflict with its basis, and does not let ok scores compensate", () => {
    const conflicted = reconcileChecklist(authored(), [
      item("Location", "fit", "ok", "both say Berlin"),
      item("Stage fit", "fit", "conflict", "Alice's intent is pre-seed; Bob's states Series B only"),
    ]);
    const state = checklistVerdictState(conflicted);
    expect(state.allOk).toBe(false);
    expect(state.conflicts).toHaveLength(1);
    expect(state.conflicts[0].basis).toContain("Series B");
  });

  it("counts unknowns separately from conflicts — an unknown is not a rejection", () => {
    const state = checklistVerdictState(authored());
    expect(state.conflicts).toHaveLength(0);
    expect(state.unknowns).toHaveLength(2);
    expect(state.allOk).toBe(false);
  });
});

describe("ask admissibility — the five-part rule, in the part a machine can check", () => {
  const answerhood = { ok_when: "she says remote works", conflict_when: "she says on-site only" };
  const admissible = {
    checklist: authored(),
    dimension: "Location",
    answerhood,
    askedDimensions: [] as string[],
    questionsSpent: 0,
  };

  it("admits an ask on an unknown, pivotal, unasked dimension within budget", () => {
    const verdict = assessAskAdmissibility(admissible);
    expect(verdict.admissible).toBe(true);
    expect(verdict.admissible && verdict.dimension.name).toBe("Location");
  });

  it("refuses an ask that names no dimension, or one the checklist does not carry", () => {
    for (const dimension of [undefined, "", "Ticket size"]) {
      const verdict = assessAskAdmissibility({ ...admissible, dimension });
      expect(verdict).toEqual({ admissible: false, reason: "no_such_dimension" });
    }
  });

  it("refuses an ask about a dimension the commitment record already settled", () => {
    // Conditions 1 and 3 of the plan's rule, which are the same fact: a
    // dimension is unknown exactly when nothing on the record settles it, so a
    // scored one is answerable without spending the client's attention.
    for (const scored of [
      item("Location", "fit", "ok", "Bob's profile says Berlin"),
      item("Location", "fit", "conflict", "Bob's profile says Lisbon only"),
    ]) {
      const checklist = reconcileChecklist(authored(), [scored]);
      expect(assessAskAdmissibility({ ...admissible, checklist }))
        .toEqual({ admissible: false, reason: "already_scored" });
    }
  });

  it("refuses an ask whose answerhood proves no pivotality", () => {
    // Missing map, half a map, and a map whose branches cannot distinguish
    // anything are all the same failure: no answer would flip the verdict.
    const cases = [
      undefined,
      { ok_when: "", conflict_when: "she says on-site only" },
      { ok_when: "she says remote works", conflict_when: "   " },
      { ok_when: "she answers", conflict_when: "She answers" },
    ];
    for (const map of cases) {
      expect(assessAskAdmissibility({ ...admissible, answerhood: map as typeof answerhood }))
        .toEqual({ admissible: false, reason: "not_pivotal" });
    }
  });

  it("refuses a topic already asked, however it is re-worded", () => {
    expect(assessAskAdmissibility({ ...admissible, askedDimensions: ["  location  "] }))
      .toEqual({ admissible: false, reason: "repeat_topic" });
  });

  it("refuses every ask once the principal's budget is spent", () => {
    expect(assessAskAdmissibility({ ...admissible, questionsSpent: QUESTION_BUDGET_PER_PRINCIPAL }))
      .toEqual({ admissible: false, reason: "budget_spent" });
    // And the budget binds before anything else has a chance to: a spent
    // budget is what turns the remaining unknowns into meeting-settleable
    // residue rather than more questions.
    expect(assessAskAdmissibility({
      ...admissible,
      dimension: "Ticket size",
      questionsSpent: QUESTION_BUDGET_PER_PRINCIPAL,
    })).toEqual({ admissible: false, reason: "budget_spent" });
  });
});

describe("question budget resolution", () => {
  const original = process.env.NEGOTIATOR_STANCE;
  afterEach(() => {
    if (original === undefined) delete process.env.NEGOTIATOR_STANCE;
    else process.env.NEGOTIATOR_STANCE = original;
  });

  it("is the checklist budget under the assessing stances", () => {
    for (const stance of ["evaluator", "skeptic"]) {
      process.env.NEGOTIATOR_STANCE = stance;
      expect(configuredQuestionBudgetPerPrincipal()).toBe(QUESTION_BUDGET_PER_PRINCIPAL);
    }
  });

  it("is the legacy one-consultation ration under advocate", () => {
    for (const stance of ["advocate", "nonsense"]) {
      process.env.NEGOTIATOR_STANCE = stance;
      expect(configuredQuestionBudgetPerPrincipal()).toBe(1);
    }
  });
});

describe("prompt rendering", () => {
  it("renders the authoring instruction when no checklist exists yet", () => {
    const section = renderChecklistSection({ checklist: [], questionsSpent: 0 });
    expect(section).toContain("none yet — you write it on this turn");
    expect(section).toContain("Write it now from the two intents alone");
    expect(section).toContain(`0 of ${QUESTION_BUDGET_PER_PRINCIPAL}`);
  });

  it("states the dimension floor where the model actually authors — it is not enough to say it in the rules", () => {
    // Against a live provider the negotiator reliably drafted TWO dimensions
    // and `authorChecklist` discarded them, so the whole protocol silently
    // no-opped: no checklist, no unknowns, no asks. The rules said "3 to 5"
    // and the authoring instruction did not, and the instruction is what the
    // model is reading at the moment it writes. Both now carry the floor, and
    // the consequence of missing it is stated where it is missed.
    const section = renderChecklistSection({ checklist: [], questionsSpent: 0 });
    expect(section).toContain(`${MIN_CHECKLIST_DIMENSIONS} to ${MAX_CHECKLIST_DIMENSIONS} dimensions`);
    expect(section).toContain("one of them the mutual want");
    expect(section).toContain(`Fewer than ${MIN_CHECKLIST_DIMENSIONS} is not a checklist and will be discarded`);
  });

  it("renders the frozen dimensions with their scores, bases and the spent budget", () => {
    const checklist = reconcileChecklist(authored(), [item("Location", "fit", "conflict", "Bob's profile says Lisbon only")]);
    const section = renderChecklistSection({
      checklist,
      questionsSpent: 2,
      askedTopics: [{
        dimension: "Stage fit",
        answerhood: { ok_when: "Alice says pre-seed is in scope", conflict_when: "Alice says Series A only" },
      }],
    });
    expect(section).toContain("fixed for this negotiation — re-score it, never rewrite it");
    expect(section).toContain("- Mutual want [mutual want]: ok — basis:");
    expect(section).toContain("- Location [fit]: conflict — basis: Bob's profile says Lisbon only");
    expect(section).toContain("- Stage fit [fit]: unknown");
    expect(section).toContain(`2 of ${QUESTION_BUDGET_PER_PRINCIPAL}`);
    expect(section).toContain("Topics already asked: Stage fit — never ask any of them again");
    // The map the ask declared travels with the topic, so the answer that has
    // since arrived is scored against it rather than re-read freely.
    expect(section).toContain("Answerhood you declared when you asked");
    expect(section).toContain("- Stage fit: ok when Alice says pre-seed is in scope; conflict when Alice says Series A only");
  });

  it("never reports more spent than the budget allows", () => {
    const section = renderChecklistSection({ checklist: authored(), questionsSpent: 9 });
    expect(section).toContain(`${QUESTION_BUDGET_PER_PRINCIPAL} of ${QUESTION_BUDGET_PER_PRINCIPAL}`);
  });
});
