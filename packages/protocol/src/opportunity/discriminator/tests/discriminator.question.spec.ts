import { describe, it, expect } from "bun:test";

import { QuestionSchema } from "../../../shared/schemas/question.schema.js";
import type { QuestionPoolDiscriminator } from "../../../shared/schemas/question.schema.js";
import { BOTH_MATTER_LABEL, selectQuestionDiscriminators, synthesizePoolQuestion, toQuestionDiscriminator } from "../discriminator.question.js";
import type { ScoredDiscriminator } from "../discriminator.types.js";

function scored(overrides: Partial<ScoredDiscriminator> = {}): ScoredDiscriminator {
  return {
    label: "Hands-on builders vs advisors",
    questionSeed: "Do you want someone hands-on or advisory",
    sides: ["Hands-on builder", "Advisor"],
    assignments: [
      { id: "opp-1", side: "Hands-on builder", evidence: "ev", verified: true },
      { id: "opp-2", side: "Advisor", evidence: "ev", verified: true },
      { id: "opp-3", side: "Advisor", evidence: "bad", verified: false },
      { id: "opp-4", side: null, evidence: null, verified: false },
    ],
    evidenceRate: 0.9,
    entropy: 0.9,
    coverage: 0.8,
    novelty: 0.7,
    voi: 0.5,
    ...overrides,
  };
}

function questionDiscriminator(overrides: Partial<QuestionPoolDiscriminator> = {}): QuestionPoolDiscriminator {
  return {
    label: "Hands-on builders vs advisors",
    questionSeed: "Do you want someone hands-on or advisory",
    sides: ["Hands-on builder", "Advisor"],
    sideCounts: { "Hands-on builder": 8, "Advisor": 6 },
    voi: 0.5,
    evidenceRate: 0.9,
    assignments: [{ opportunityId: "opp-1", side: "Hands-on builder" }],
    ...overrides,
  };
}

describe("toQuestionDiscriminator", () => {
  it("keeps only verified assignments and counts them per side", () => {
    const d = toQuestionDiscriminator(scored());
    expect(d.assignments).toEqual([
      { opportunityId: "opp-1", side: "Hands-on builder" },
      { opportunityId: "opp-2", side: "Advisor" },
    ]);
    expect(d.sideCounts).toEqual({ "Hands-on builder": 1, "Advisor": 1 });
  });
});

describe("selectQuestionDiscriminators", () => {
  it("filters by VoI and evidenceRate bars and caps the count", () => {
    const eligible1 = scored({ label: "a", voi: 0.5, evidenceRate: 0.9 });
    const lowVoi = scored({ label: "b", voi: 0.1, evidenceRate: 0.9 });
    const lowEvidence = scored({ label: "c", voi: 0.5, evidenceRate: 0.3 });
    const eligible2 = scored({ label: "d", voi: 0.3, evidenceRate: 0.7 });
    const eligible3 = scored({ label: "e", voi: 0.25, evidenceRate: 0.61 });
    const eligible4 = scored({ label: "f", voi: 0.21, evidenceRate: 0.99 });
    const out = selectQuestionDiscriminators([eligible1, lowVoi, lowEvidence, eligible2, eligible3, eligible4]);
    expect(out.map((d) => d.label)).toEqual(["a", "d", "e"]); // cap 3, bars enforced
  });
});

describe("synthesizePoolQuestion", () => {
  const base = {
    discriminator: questionDiscriminator(),
    alternates: [questionDiscriminator({ label: "alt-1" })],
    poolSize: 21,
    minedAt: "2026-07-14T14:00:00.000Z",
    runId: "run-1",
  };

  it("produces a schema-valid question: sides as chip options + Both matter", () => {
    const out = synthesizePoolQuestion(base);
    expect(out).not.toBeNull();
    const payload = out!.payload;
    expect(() => QuestionSchema.parse(payload)).not.toThrow();
    expect(payload.options.map((o) => o.label)).toEqual([
      "Hands-on builder",
      "Advisor",
      BOTH_MATTER_LABEL,
    ]);
    expect(payload.options[0].description).toBe("8 of your 21 current matches lean this way");
    expect(payload.options[1].description).toBe("6 of your 21 current matches lean this way");
    expect(payload.multiSelect).toBe(false);
    expect(payload.evidence).toBe("based on 21 people matching this intent");
    expect(payload.prompt.endsWith("?")).toBe(true);
  });

  it("stashes the pool snapshot with alternates for chaining", () => {
    const out = synthesizePoolQuestion(base)!;
    expect(out.pool.poolSize).toBe(21);
    expect(out.pool.runId).toBe("run-1");
    expect(out.pool.discriminator.label).toBe("Hands-on builders vs advisors");
    expect(out.pool.alternates.map((a) => a.label)).toEqual(["alt-1"]);
  });

  it("caps option labels at 5 words", () => {
    const out = synthesizePoolQuestion({
      ...base,
      discriminator: questionDiscriminator({
        sides: ["one two three four five six seven", "Advisor"],
        sideCounts: { "one two three four five six seven": 3, "Advisor": 2 },
      }),
    })!;
    expect(out.payload.options[0].label).toBe("one two three four five");
  });

  it("returns null below the k-anonymity pool floor", () => {
    expect(synthesizePoolQuestion({ ...base, poolSize: 4 })).toBeNull();
  });

  it("returns null for degenerate side counts", () => {
    expect(
      synthesizePoolQuestion({
        ...base,
        discriminator: questionDiscriminator({ sides: ["only-one"] }),
      }),
    ).toBeNull();
  });

  it("normalizes trailing punctuation on the seed into a single question mark", () => {
    const out = synthesizePoolQuestion({
      ...base,
      discriminator: questionDiscriminator({
        questionSeed: "Do you want someone hands-on builder style, or advisor style.",
      }),
    })!;
    expect(out.payload.prompt).toBe("Do you want someone hands-on builder style, or advisor style?");
  });

  it("rewrites third-person miner seeds ('the user') into second person", () => {
    const out = synthesizePoolQuestion({
      ...base,
      discriminator: questionDiscriminator({
        questionSeed: "Is the user primarily seeking a hands-on builder, or does the user prefer an advisor",
      }),
    })!;
    expect(out.payload.prompt).toBe(
      "Are you primarily seeking a hands-on builder, or do you prefer an advisor?",
    );
  });

  it("names the intent in the evidence chip and stores it in the snapshot for chaining", () => {
    const out = synthesizePoolQuestion({
      ...base,
      intentText: "Explore the use of LLMs for procedural video game narration",
    })!;
    expect(out.payload.evidence).toBe(
      "based on 21 people matching \u201cExplore the use of LLMs for procedural video game narration\u201d",
    );
    expect(out.pool.intentText).toBe("Explore the use of LLMs for procedural video game narration");
  });

  it("truncates long intent snippets and keeps evidence within the 160-char schema cap", () => {
    const long = "Collaborate with partners, advisors, technical professionals, agent builders, and protocol engineers on long-horizon coordination infrastructure for cities";
    const out = synthesizePoolQuestion({ ...base, intentText: long })!;
    expect(out.payload.evidence!.length).toBeLessThanOrEqual(160);
    expect(out.payload.evidence).toContain("\u2026\u201d");
    expect(() => QuestionSchema.parse(out.payload)).not.toThrow();
  });

  it("falls back to the generic evidence line without intentText", () => {
    const out = synthesizePoolQuestion(base)!;
    expect(out.payload.evidence).toBe("based on 21 people matching this intent");
    expect(out.pool.intentText).toBeUndefined();
  });

  it("rewrites 'this user' / 'the client' variants into second person", () => {
    const out = synthesizePoolQuestion({
      ...base,
      discriminator: questionDiscriminator({
        questionSeed: "Does this user want a hands-on builder, or is the client seeking an advisor",
      }),
    })!;
    expect(out.payload.prompt).toBe("Do you want a hands-on builder, or are you seeking an advisor?");
  });

  it("falls back to the two-sided template when a third-person reference survives normalization", () => {
    const out = synthesizePoolQuestion({
      ...base,
      discriminator: questionDiscriminator({
        // 'a user' is not rewritten — the catch-all must route to the template.
        questionSeed: "Would a user like this prefer a hands-on builder or an advisor",
      }),
    })!;
    expect(out.payload.prompt).toBe("Which matters more here: Hands-on builder or Advisor?");
  });

  it("rewrites first-person miner seeds into second person", () => {
    const out = synthesizePoolQuestion({
      ...base,
      discriminator: questionDiscriminator({
        questionSeed: "Do I prefer a hands-on builder, or am I open to an advisor for my intent",
      }),
    })!;
    expect(out.payload.prompt).toBe(
      "Do you prefer a hands-on builder, or are you open to an advisor for your intent?",
    );
  });

  it("falls back to the two-sided template when the seed names fewer than two sides", () => {
    const out = synthesizePoolQuestion({
      ...base,
      discriminator: questionDiscriminator({
        questionSeed: "Do you prefer hands-on builders", // never mentions 'Advisor'
      }),
    })!;
    expect(out.payload.prompt).toBe("Which matters more here: Hands-on builder or Advisor?");
  });

  it("uses the template with a comma list for 3-sided discriminators", () => {
    const out = synthesizePoolQuestion({
      ...base,
      discriminator: questionDiscriminator({
        sides: ["Builders", "Advisors", "Investors"],
        sideCounts: { Builders: 5, Advisors: 4, Investors: 3 },
        questionSeed: "What kind of person are you seeking",
      }),
    })!;
    expect(out.payload.prompt).toBe("Which matters more here: Builders, Advisors or Investors?");
  });

  it("keeps a seed that already names both sides untouched apart from the question mark", () => {
    const out = synthesizePoolQuestion({
      ...base,
      discriminator: questionDiscriminator({
        questionSeed: "Are you looking for a hands-on builder or a strategic advisor",
      }),
    })!;
    expect(out.payload.prompt).toBe("Are you looking for a hands-on builder or a strategic advisor?");
  });
});
