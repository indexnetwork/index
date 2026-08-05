import { describe, expect, it } from "bun:test";

import type { HistoricalQualityCase } from "../historical-quality.corpus.js";
import { historicalModelSafeProjection, validateHistoricalQualityCase } from "../historical-quality.corpus.js";

const claimTextByPath = {
  "/input/entities/0/profile/bio": "Commercial operator.",
  "/input/entities/0/profile/location": "West Coast",
  "/input/entities/0/profile/interests/0": "personal computing",
  "/input/entities/0/profile/skills/0": "sales",
  "/input/entities/0/profile/context": "Experienced at bringing technical products to market.",
  "/input/entities/0/intents/0/payload": "Find a hardware builder.",
  "/input/entities/0/intents/0/summary": "Seeking a technical collaborator.",
  "/input/entities/0/matchedVia": "commercialization experience",
  "/input/entities/0/evidence/0/payload": "Market-oriented premise.",
  "/input/entities/0/evidence/0/summary": "Commercialization evidence.",
  "/input/entities/0/evidence/0/assertionText": "Documented market experience.",
  "/input/entities/1/profile/bio": "Hardware builder.",
  "/input/entities/1/profile/location": "West Coast",
  "/input/entities/1/profile/interests/0": "personal computing",
  "/input/entities/1/profile/skills/0": "circuit design",
  "/input/entities/1/matchedVia": "personal-computer hardware",
  "/input/entities/2/profile/bio": "Sales operator.",
  "/input/entities/2/profile/location": "West Coast",
  "/input/entities/2/profile/skills/0": "sales",
  "/input/entities/2/matchedVia": "sales operations",
  "/input/entities/3/profile/bio": "Parts supplier.",
  "/input/entities/3/profile/location": "West Coast",
  "/input/entities/3/profile/skills/0": "procurement",
  "/input/entities/3/matchedVia": "computer parts supply",
  "/input/entities/4/profile/bio": "Weekend hobbyist.",
  "/input/entities/4/profile/location": "West Coast",
  "/input/entities/4/profile/skills/0": "soldering",
  "/input/entities/4/matchedVia": "personal-computer hobbyist",
  "/input/networkContexts/historical-v2-pool": "An interdisciplinary collaboration community.",
  "/triggerInputs/intent/text": "Find a hardware builder.",
  "/triggerInputs/enrichment/premises/0": "I can commercialize a personal-computing product.",
  "/triggerInputs/enrichment/premises/1": "I need complementary hardware expertise.",
  "/triggerInputs/enrichment/userContext": "Commercial operator seeking a complementary technical collaborator.",
} as const;

const validCase = (): HistoricalQualityCase => {
  const claimEntries = Object.entries(claimTextByPath);
  const claims = claimEntries.map(([, text], index) => ({
    id: `claim-${index + 1}`,
    text,
    citationIds: ["citation-pre"],
    preConnection: true as const,
  }));

  return {
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
          profile: {
            name: "(source user)",
            bio: "Commercial operator.",
            location: "West Coast",
            interests: ["personal computing"],
            skills: ["sales"],
            context: "Experienced at bringing technical products to market.",
          },
          intents: [{
            intentId: "i-source",
            payload: "Find a hardware builder.",
            summary: "Seeking a technical collaborator.",
          }],
          networkId: "historical-v2-pool",
          evidenceKey: "profile:p-source",
          ragScore: 100,
          matchedVia: "commercialization experience",
          evidence: [{
            kind: "premise_similarity",
            networkId: "historical-v2-pool",
            score: 0.9,
            lens: "premise_match",
            discoverySource: "premise-similarity",
            matchedStrategies: ["premise-similarity"],
            sourcePremiseId: "premise:p-source",
            candidatePremiseId: "premise:p-target",
            payload: "Market-oriented premise.",
            summary: "Commercialization evidence.",
            assertionText: "Documented market experience.",
          }],
        },
        {
          userId: "p-target",
          profile: {
            name: "Participant B",
            bio: "Hardware builder.",
            location: "West Coast",
            interests: ["personal computing"],
            skills: ["circuit design"],
          },
          networkId: "historical-v2-pool",
          ragScore: 92,
          matchedVia: "personal-computer hardware",
        },
        {
          userId: "p-negative-1",
          profile: { name: "Participant C", bio: "Sales operator.", location: "West Coast", interests: [], skills: ["sales"] },
          networkId: "historical-v2-pool",
          matchedVia: "sales operations",
        },
        {
          userId: "p-negative-2",
          profile: { name: "Participant D", bio: "Parts supplier.", location: "West Coast", interests: [], skills: ["procurement"] },
          networkId: "historical-v2-pool",
          matchedVia: "computer parts supply",
        },
        {
          userId: "p-negative-3",
          profile: { name: "Participant E", bio: "Weekend hobbyist.", location: "West Coast", interests: [], skills: ["soldering"] },
          networkId: "historical-v2-pool",
          matchedVia: "personal-computer hobbyist",
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
        { id: "citation-pre", url: "https://example.org/pre", title: "Pre-connection source", publisher: "Archive", excerpt: "Documented facts before collaboration." },
        { id: "citation-outcome", url: "https://example.org/outcome", title: "Outcome source", publisher: "Archive", excerpt: "The collaboration produced a documented result." },
      ],
      claims,
      claimProvenance: Object.fromEntries(claimEntries.map(([path], index) => [path, [`claim-${index + 1}`]])),
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
          premises: [
            "I can commercialize a personal-computing product.",
            "I need complementary hardware expertise.",
          ],
          userContext: "Commercial operator seeking a complementary technical collaborator.",
        },
      },
    },
  };
};

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

  it("requires exact field-level provenance for every projected claim-bearing string", () => {
    expect(Object.keys(validCase().historicalQuality.claimProvenance).sort()).toEqual(Object.keys(claimTextByPath).sort());

    for (const path of Object.keys(claimTextByPath)) {
      const missing = validCase();
      delete missing.historicalQuality.claimProvenance[path];
      expect(() => validateHistoricalQualityCase(missing), path).toThrow(new RegExp(`missing claim provenance for ${path}`));
    }

    const unknown = validCase();
    unknown.historicalQuality.claimProvenance["/input/entities/0/profile/name"] = ["claim-1"];
    expect(() => validateHistoricalQualityCase(unknown)).toThrow(/unknown claim provenance path \/input\/entities\/0\/profile\/name/);
  });

  it("rejects empty or unrelated claims for projected fields", () => {
    const empty = validCase();
    empty.historicalQuality.claims = [];
    expect(() => validateHistoricalQualityCase(empty)).toThrow(/references unknown claim claim-1/);

    const unrelated = validCase();
    unrelated.historicalQuality.claimProvenance["/input/entities/0/profile/bio"] = ["claim-2"];
    expect(() => validateHistoricalQualityCase(unrelated)).toThrow(/claim-2 text does not match \/input\/entities\/0\/profile\/bio/);

    const uncitedChange = validCase();
    uncitedChange.input.entities[0]!.profile.bio = "Uncited new biography.";
    expect(() => validateHistoricalQualityCase(uncitedChange)).toThrow(/claim-1 text does not match \/input\/entities\/0\/profile\/bio/);
  });

  it("projects only model-safe matching and trigger inputs while exempting structural fields", () => {
    const input = validCase();
    const projection = historicalModelSafeProjection(input);
    const serialized = JSON.stringify(projection);
    expect(Object.keys(projection).sort()).toEqual(["id", "input", "triggerInputs"]);
    for (const forbidden of ["reportNames", "historicalQuality", "citations", "claims", "anonymizationReview", "Real Source", "https://example.org/"]) {
      expect(serialized).not.toContain(forbidden);
    }

    for (const exemptPath of ["/id", "/input/discovererId", "/input/entities/0/userId", "/input/entities/0/profile/name", "/input/entities/0/networkId", "/input/entities/0/evidenceKey", "/input/entities/0/ragScore", "/input/entities/0/evidence/0/lens", "/input/entities/0/evidence/0/matchedStrategies/0"]) {
      expect(input.historicalQuality.claimProvenance).not.toHaveProperty(exemptPath);
    }

    const leakedName = validCase();
    leakedName.input.entities[0]!.profile.name = "Real Source";
    expect(() => validateHistoricalQualityCase(leakedName)).toThrow(/report name Real Source is present in model-safe projection/);
  });
});
