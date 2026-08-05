import { describe, expect, it } from "bun:test";
import type { HistoricalQualityCase } from "../historical-quality.corpus.js";
import { historicalModelSafeProjection, validateHistoricalQualityCase } from "../historical-quality.corpus.js";

const validCase = (): HistoricalQualityCase => ({
  id: "historical-v2/builder-operator",
  rule: "historical",
  tier: 3,
  domains: ["technology"],
  description: "An operator needs a complementary hardware builder.",
  input: {
    discovererId: "p-source",
    entities: [
      {
        userId: "p-source",
        profile: { name: "(source user)", bio: "Commercial operator.", location: "West Coast", interests: [], skills: ["sales"] },
        intents: [{ intentId: "i-source", payload: "Find a hardware builder." }],
        networkId: "historical-v2-pool",
      },
      {
        userId: "p-target",
        profile: { name: "Participant B", bio: "Hardware builder.", location: "West Coast", interests: [], skills: ["circuit design"] },
        networkId: "historical-v2-pool",
      },
      {
        userId: "p-negative-1",
        profile: { name: "Participant C", bio: "Sales operator.", location: "West Coast", interests: [], skills: ["sales"] },
        networkId: "historical-v2-pool",
      },
      {
        userId: "p-negative-2",
        profile: { name: "Participant D", bio: "Parts supplier.", location: "West Coast", interests: [], skills: ["procurement"] },
        networkId: "historical-v2-pool",
      },
      {
        userId: "p-negative-3",
        profile: { name: "Participant E", bio: "Weekend hobbyist.", location: "West Coast", interests: [], skills: ["soldering"] },
        networkId: "historical-v2-pool",
      },
    ],
    networkContexts: { "historical-v2-pool": "An interdisciplinary collaboration community." },
  },
  expect: [
    { candidateId: "p-target", match: true },
    { candidateId: "p-negative-1", match: false },
    { candidateId: "p-negative-2", match: false },
    { candidateId: "p-negative-3", match: false },
  ],
  reportNames: { "p-source": "Real Source", "p-target": "Real Target" },
  historicalQuality: {
    cutoff: {
      date: "1975-12-31",
      precision: "day",
      exclusive: true,
      orderingCitationIds: ["citation-pre"],
    },
    citations: [
      { id: "citation-pre", url: "https://example.org/pre", title: "Pre-connection source", publisher: "Archive", excerpt: "Commercial operator before collaboration." },
      { id: "citation-outcome", url: "https://example.org/outcome", title: "Outcome source", publisher: "Archive", excerpt: "The collaboration produced a documented result." },
    ],
    claims: [
      { id: "claim-source", text: "Commercial operator.", citationIds: ["citation-pre"], preConnection: true },
    ],
    outcomeCitationIds: ["citation-outcome"],
    anonymizationReview: {
      reviewer: "independent-reviewer",
      reviewedAt: "2026-08-05",
      recognizability: "medium",
      decision: "approved",
      rationale: "Unique names and outcome terms are absent from model input.",
    },
    semanticNegatives: {
      "p-negative-1": "Same-side operator; lacks the required builder role.",
      "p-negative-2": "Supplier relationship does not satisfy the co-builder requirement.",
      "p-negative-3": "No product-building commitment.",
    },
    triggerInputs: {
      intent: { text: "Find a hardware builder." },
      enrichment: {
        premises: ["I can commercialize a personal-computing product."],
        userContext: "Commercial operator seeking a complementary technical collaborator.",
      },
    },
  },
});

describe("historical quality corpus contract", () => {
  it("accepts complete cited pre-connection evidence", () => {
    expect(() => validateHistoricalQualityCase(validCase())).not.toThrow();
  });

  it("rejects missing citations, non-exclusive cutoffs, unproved year ordering, and unapproved anonymization", () => {
    const missing = validCase();
    missing.historicalQuality.claims[0]!.citationIds = ["missing"];
    expect(() => validateHistoricalQualityCase(missing)).toThrow(/unknown citation missing/);

    const inclusive = validCase();
    inclusive.historicalQuality.cutoff.exclusive = false as true;
    expect(() => validateHistoricalQualityCase(inclusive)).toThrow(/cutoff must be exclusive/);

    const invalidDate = validCase();
    invalidDate.historicalQuality.cutoff.date = "1975-13-40";
    expect(() => validateHistoricalQualityCase(invalidDate)).toThrow(/cutoff date does not match day precision/);

    const yearWithoutOrdering = validCase();
    yearWithoutOrdering.historicalQuality.cutoff = {
      date: "1975",
      precision: "year",
      exclusive: true,
      orderingCitationIds: [],
    };
    expect(() => validateHistoricalQualityCase(yearWithoutOrdering)).toThrow(/year precision requires ordering evidence/);

    const overlappingOutcome = validCase();
    overlappingOutcome.historicalQuality.outcomeCitationIds = ["citation-pre"];
    expect(() => validateHistoricalQualityCase(overlappingOutcome)).toThrow(/outcome requires an independent citation/);

    const unapproved = validCase();
    unapproved.historicalQuality.anonymizationReview.decision = "revise";
    expect(() => validateHistoricalQualityCase(unapproved)).toThrow(/anonymization review must be approved/);
  });

  it("requires one positive and at least three authored semantic negatives that reference rejected candidates", () => {
    const tooFew = validCase();
    delete tooFew.historicalQuality.semanticNegatives["p-negative-3"];
    expect(() => validateHistoricalQualityCase(tooFew)).toThrow(/at least three semantic negatives/);

    const positiveAsNegative = validCase();
    positiveAsNegative.historicalQuality.semanticNegatives["p-target"] = "invalid";
    expect(() => validateHistoricalQualityCase(positiveAsNegative)).toThrow(/must reference a rejected candidate/);
  });

  it("projects only model-safe matching and trigger inputs", () => {
    const input = validCase();
    const projection = historicalModelSafeProjection(input);
    const serialized = JSON.stringify(projection);
    expect(Object.keys(projection).sort()).toEqual(["id", "input", "triggerInputs"]);
    for (const forbidden of ["reportNames", "historicalQuality", "citations", "claims", "anonymizationReview", "Real Source", "https://example.org/"]) {
      expect(serialized).not.toContain(forbidden);
    }

    const leakedName = validCase();
    leakedName.input.entities[0]!.profile.name = "Real Source";
    expect(() => validateHistoricalQualityCase(leakedName)).toThrow(/report name Real Source is present in model-safe projection/);
  });
});
