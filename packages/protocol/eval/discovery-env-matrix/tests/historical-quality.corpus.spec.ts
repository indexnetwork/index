import { describe, expect, it } from "bun:test";

import type { HistoricalClaim, HistoricalDerivedClaim, HistoricalQualityCase } from "../historical-quality.corpus.js";
import { defineHistoricalQualityCase, historicalMatchingCaseProjection, historicalModelSafeProjection, validateHistoricalQualityCase } from "../historical-quality.corpus.js";

const semanticNegatives = {
  "p-negative-1": "Same-side operator; lacks the required builder role.",
  "p-negative-2": "Supplier relationship does not satisfy the co-builder requirement.",
  "p-negative-3": "No product-building commitment.",
} as const;

const claimTextByPath = {
  "/description": "An operator needs a complementary hardware builder.",
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

const participantIdForPath = (path: string): string | undefined => {
  const match = /^\/input\/entities\/(\d+)\//.exec(path);
  if (!match) return undefined;
  return ["p-source", "p-target", "p-negative-1", "p-negative-2", "p-negative-3"][Number(match[1])];
};

const validCase = (): HistoricalQualityCase => {
  const claimEntries = Object.entries(claimTextByPath);
  const claims: HistoricalClaim[] = claimEntries.map(([path, text], index) => {
    const id = `claim-${index + 1}`;
    const participantId = participantIdForPath(path);
    if (participantId && participantId in semanticNegatives) {
      return {
        kind: "authored",
        id,
        text,
        participantId,
        violatedRequirement: semanticNegatives[participantId as keyof typeof semanticNegatives],
      };
    }
    if (path === "/input/entities/0/profile/bio") {
      return { kind: "derived", id, text, basisClaimIds: ["claim-source-bio-basis"], rationale: "Generalized from the cited role." };
    }
    return { kind: "historical", id, text, citationIds: ["citation-pre"], preConnection: true };
  });
  claims.push({
    kind: "historical",
    id: "claim-source-bio-basis",
    text: "Commercial operator.",
    citationIds: ["citation-pre"],
    preConnection: true,
  });

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
        event: {
          id: "p-source-p-target-first-substantive-collaboration",
          description: "Immediately before the two historical participants began substantive collaboration.",
        },
        calendarProxy: { date: "1975-12-31", precision: "day" },
        confidence: "high",
        uncertaintyRationale: "The reviewed chronology supplies an exact day for the ordering boundary.",
        exclusive: true,
        orderingCitationIds: ["citation-pre"],
      },
      citations: [
        { id: "citation-pre", url: "https://example.org/pre", title: "Pre-connection source", publisher: "Archive", excerpt: "Documented facts before collaboration." },
        { id: "citation-outcome", url: "https://example.org/outcome", title: "Outcome source", publisher: "Archive", excerpt: "The collaboration produced a documented result." },
      ],
      claims,
      claimProvenance: Object.fromEntries(claimEntries.map(([path], index) => [path, [`claim-${index + 1}`]])),
      participantKinds: {
        "p-source": "historical",
        "p-target": "historical",
        "p-negative-1": "synthetic",
        "p-negative-2": "synthetic",
        "p-negative-3": "synthetic",
      },
      outcomeCitationIds: ["citation-outcome"],
      anonymizationReview: {
        reviewer: "independent-reviewer",
        reviewedAt: "2026-08-05",
        recognizability: "medium",
        decision: "approved",
        rationale: "Unique names and outcome terms are absent from model input.",
      },
      semanticNegatives: { ...semanticNegatives },
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

const claimAtPath = (input: HistoricalQualityCase, path: string): HistoricalClaim => {
  const claimId = input.historicalQuality.claimProvenance[path]![0]!;
  return input.historicalQuality.claims.find((claim) => claim.id === claimId)!;
};

describe("historical quality corpus contract", () => {
  it("accepts complete cited provenance with explicit historical and synthetic participants", () => {
    const input = validCase();
    expect(() => validateHistoricalQualityCase(input)).not.toThrow();
    expect(Object.values(input.historicalQuality.participantKinds).sort()).toEqual([
      "historical",
      "historical",
      "synthetic",
      "synthetic",
      "synthetic",
    ]);
  });

  it("rejects missing citations, non-exclusive cutoffs, unproved year ordering, and reused-only outcome citations", () => {
    const missing = validCase();
    const historical = missing.historicalQuality.claims.find((claim) => claim.kind === "historical")!;
    if (historical.kind === "historical") historical.citationIds = ["missing"];
    expect(() => validateHistoricalQualityCase(missing)).toThrow(/unknown citation missing/);

    const inclusive = validCase();
    inclusive.historicalQuality.cutoff.exclusive = false as true;
    expect(() => validateHistoricalQualityCase(inclusive)).toThrow(/cutoff must be exclusive/);

    const blankEventId = validCase();
    blankEventId.historicalQuality.cutoff.event.id = " ";
    expect(() => validateHistoricalQualityCase(blankEventId)).toThrow(/cutoff event id must be non-empty/);

    const blankDescription = validCase();
    blankDescription.historicalQuality.cutoff.event.description = " ";
    expect(() => validateHistoricalQualityCase(blankDescription)).toThrow(/cutoff event description must be non-empty/);

    const invalidConfidence = validCase();
    invalidConfidence.historicalQuality.cutoff.confidence = "certain" as "high";
    expect(() => validateHistoricalQualityCase(invalidConfidence)).toThrow(/cutoff confidence is invalid/);

    const blankUncertainty = validCase();
    blankUncertainty.historicalQuality.cutoff.uncertaintyRationale = " ";
    expect(() => validateHistoricalQualityCase(blankUncertainty)).toThrow(/cutoff uncertainty rationale must be non-empty/);

    const malformedProxy = validCase();
    malformedProxy.historicalQuality.cutoff.calendarProxy = { date: "1975-13-40", precision: "day" };
    expect(() => validateHistoricalQualityCase(malformedProxy)).toThrow(/cutoff calendar proxy does not match day precision/);

    const invalidPrecision = validCase();
    invalidPrecision.historicalQuality.cutoff.calendarProxy.precision = "century" as "day";
    expect(() => validateHistoricalQualityCase(invalidPrecision)).toThrow(
      "historical-v2/builder-operator: cutoff calendar proxy precision is invalid",
    );

    const yearWithoutOrdering = validCase();
    yearWithoutOrdering.historicalQuality.cutoff = {
      event: {
        id: "p-source-p-target-first-substantive-collaboration",
        description: "Immediately before the two historical participants began substantive collaboration.",
      },
      calendarProxy: { date: "1975", precision: "year" },
      confidence: "high",
      uncertaintyRationale: "The reviewed chronology establishes the year but not an exact date.",
      exclusive: true,
      orderingCitationIds: [],
    };
    expect(() => validateHistoricalQualityCase(yearWithoutOrdering)).toThrow(/year precision requires ordering evidence/);

    const overlappingOutcome = validCase();
    overlappingOutcome.historicalQuality.outcomeCitationIds = ["citation-pre"];
    expect(() => validateHistoricalQualityCase(overlappingOutcome)).toThrow(/outcome citations must be disjoint from pre-connection citations/);

    const mixedOverlapOutcome = validCase();
    mixedOverlapOutcome.historicalQuality.outcomeCitationIds = ["citation-pre", "citation-outcome"];
    expect(() => validateHistoricalQualityCase(mixedOverlapOutcome)).toThrow(/outcome citations must be disjoint from pre-connection citations/);
  });

  it("requires approved review by default but permits complete pending authoring cases explicitly", () => {
    const pending = validCase();
    pending.historicalQuality.anonymizationReview.decision = "pending";
    expect(() => validateHistoricalQualityCase(pending)).toThrow(/anonymization review must be approved/);
    expect(() => validateHistoricalQualityCase(pending, { requireApprovedReview: false })).not.toThrow();

    const high = validCase();
    high.historicalQuality.anonymizationReview.recognizability = "high";
    expect(() => validateHistoricalQualityCase(high)).toThrow(/approved historical cases cannot have high recognizability/);
    expect(() => validateHistoricalQualityCase(high, { requireApprovedReview: false })).not.toThrow();

    for (const recognizability of ["extreme", "HIGH"] as const) {
      const invalid = validCase();
      invalid.historicalQuality.anonymizationReview.recognizability = recognizability as "high";
      expect(() => validateHistoricalQualityCase(invalid)).toThrow(
        "historical-v2/builder-operator: anonymization recognizability is invalid",
      );
      expect(() => validateHistoricalQualityCase(invalid, { requireApprovedReview: false })).toThrow(
        "historical-v2/builder-operator: anonymization recognizability is invalid",
      );
    }
  });

  it("rejects authored claims for historical participants and historical claims for synthetic participants", () => {
    const authoredSource = validCase();
    const sourceClaim = claimAtPath(authoredSource, "/input/entities/0/profile/bio");
    const sourceIndex = authoredSource.historicalQuality.claims.indexOf(sourceClaim);
    authoredSource.historicalQuality.claims[sourceIndex] = {
      kind: "authored",
      id: sourceClaim.id,
      text: sourceClaim.text,
      participantId: "p-source",
      violatedRequirement: "Historical source text cannot be authored fixture text.",
    };
    expect(() => validateHistoricalQualityCase(authoredSource)).toThrow(/historical participant p-source.*authored/);

    const historicalNegative = validCase();
    const negativeClaim = claimAtPath(historicalNegative, "/input/entities/2/profile/bio");
    const negativeIndex = historicalNegative.historicalQuality.claims.indexOf(negativeClaim);
    historicalNegative.historicalQuality.claims[negativeIndex] = {
      kind: "historical",
      id: negativeClaim.id,
      text: negativeClaim.text,
      citationIds: ["citation-pre"],
      preConnection: true,
    };
    expect(() => validateHistoricalQualityCase(historicalNegative)).toThrow(/synthetic participant p-negative-1.*historical/);
  });

  it("rejects derived claims with authored roots or cycles", () => {
    const authoredBasis = validCase();
    const sourceDerived = claimAtPath(authoredBasis, "/input/entities/0/profile/bio") as HistoricalDerivedClaim;
    const negativeClaim = claimAtPath(authoredBasis, "/input/entities/2/profile/bio");
    sourceDerived.basisClaimIds = [negativeClaim.id];
    expect(() => validateHistoricalQualityCase(authoredBasis)).toThrow(/derived claim .* must terminate only in historical claims/);

    const cyclic = validCase();
    const cyclicDerived = claimAtPath(cyclic, "/input/entities/0/profile/bio") as HistoricalDerivedClaim;
    cyclicDerived.basisClaimIds = [cyclicDerived.id];
    expect(() => validateHistoricalQualityCase(cyclic)).toThrow(/derived claim cycle/);
  });

  it("requires five unique and exactly classified participants", () => {
    const duplicate = validCase();
    duplicate.input.entities[1]!.userId = duplicate.input.entities[0]!.userId;
    expect(() => validateHistoricalQualityCase(duplicate)).toThrow(/duplicate participant p-source/);

    const missing = validCase();
    delete missing.historicalQuality.participantKinds["p-target"];
    expect(() => validateHistoricalQualityCase(missing)).toThrow(/missing participant kind for p-target/);

    const unknown = validCase();
    unknown.historicalQuality.participantKinds.unknown = "synthetic";
    expect(() => validateHistoricalQualityCase(unknown)).toThrow(/unknown participant kind unknown/);

    const extra = validCase();
    extra.input.entities.push({
      userId: "p-extra",
      profile: { name: "Participant F", bio: "Extra participant.", interests: [], skills: [] },
      networkId: "historical-v2-pool",
    });
    extra.historicalQuality.participantKinds["p-extra"] = "historical";
    expect(() => validateHistoricalQualityCase(extra)).toThrow(/requires exactly five participants/);
  });

  it("requires a historical discoverer and sole positive plus exactly three rejected synthetic negatives", () => {
    const syntheticSource = validCase();
    syntheticSource.historicalQuality.participantKinds["p-source"] = "synthetic";
    expect(() => validateHistoricalQualityCase(syntheticSource)).toThrow(/discoverer p-source must be historical/);

    const syntheticPositive = validCase();
    syntheticPositive.historicalQuality.participantKinds["p-target"] = "synthetic";
    expect(() => validateHistoricalQualityCase(syntheticPositive)).toThrow(/positive participant p-target must be historical/);

    const missingNegative = validCase();
    delete missingNegative.historicalQuality.semanticNegatives["p-negative-3"];
    expect(() => validateHistoricalQualityCase(missingNegative)).toThrow(/semantic negatives must exactly cover rejected synthetic participants/);
  });

  it("binds authored negative claims and report names to synthetic participant policy", () => {
    const drifted = validCase();
    const negativeClaim = claimAtPath(drifted, "/input/entities/2/profile/bio");
    if (negativeClaim.kind === "authored") negativeClaim.violatedRequirement = "different reason";
    expect(() => validateHistoricalQualityCase(drifted)).toThrow(/violatedRequirement does not match semantic negative p-negative-1/);

    const namedSynthetic = validCase();
    namedSynthetic.reportNames!["p-negative-1"] = "Not a historical identity";
    expect(() => validateHistoricalQualityCase(namedSynthetic)).toThrow(/report name cannot identify synthetic participant p-negative-1/);

    const unknownReportName = validCase();
    unknownReportName.reportNames!.unknown = "Unknown identity";
    expect(() => validateHistoricalQualityCase(unknownReportName)).toThrow(/report name references unknown participant unknown/);
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

  it("rejects empty or unrelated claims and authored claims on non-participant model fields", () => {
    const empty = validCase();
    empty.historicalQuality.claims = [];
    expect(() => validateHistoricalQualityCase(empty)).toThrow(/references unknown claim claim-1/);

    const unrelated = validCase();
    unrelated.historicalQuality.claimProvenance["/input/entities/0/profile/bio"] = ["claim-1"];
    expect(() => validateHistoricalQualityCase(unrelated)).toThrow(/text does not match \/input\/entities\/0\/profile\/bio/);

    const authoredDescription = validCase();
    const descriptionClaim = claimAtPath(authoredDescription, "/description");
    const descriptionIndex = authoredDescription.historicalQuality.claims.indexOf(descriptionClaim);
    authoredDescription.historicalQuality.claims[descriptionIndex] = {
      kind: "authored",
      id: descriptionClaim.id,
      text: descriptionClaim.text,
      participantId: "p-negative-1",
      violatedRequirement: semanticNegatives["p-negative-1"],
    };
    expect(() => validateHistoricalQualityCase(authoredDescription)).toThrow(/non-participant path \/description.*authored/);

    const identifyingIntroduction = validCase();
    identifyingIntroduction.input.introductionMode = true;
    identifyingIntroduction.input.introducerName = "Real Source";
    expect(() => validateHistoricalQualityCase(identifyingIntroduction)).toThrow(/missing claim provenance for \/input\/introducerName/);
  });

  it("projects audited descriptions without descriptive control IDs or audit metadata", () => {
    const input = validCase();
    const projection = historicalModelSafeProjection(input);
    const serialized = JSON.stringify(projection);
    expect(Object.keys(projection).sort()).toEqual(["description", "input", "triggerInputs"]);
    expect(projection.description).toBe(input.description);
    for (const forbidden of [input.id, "reportNames", "historicalQuality", "citations", "claims", "anonymizationReview", "Real Source", "https://example.org/"]) {
      expect(serialized).not.toContain(forbidden);
    }

    const matchingProjection = historicalMatchingCaseProjection(input);
    expect(matchingProjection).toEqual({
      id: input.id,
      rule: input.rule,
      tier: input.tier,
      domains: input.domains,
      description: input.description,
      input: input.input,
      expect: input.expect,
      reportNames: input.reportNames,
    });
    expect(matchingProjection).not.toHaveProperty("historicalQuality");
    expect(matchingProjection.input).not.toBe(input.input);

    const leakedName = validCase();
    leakedName.input.entities[0]!.profile.name = "Real Source";
    expect(() => validateHistoricalQualityCase(leakedName)).toThrow(/report name Real Source is present in model-safe projection/);
  });

  it("defines authoring cases with validation and recursive freezing", () => {
    const pending = validCase();
    pending.historicalQuality.anonymizationReview.decision = "pending";
    const defined = defineHistoricalQualityCase(pending);
    expect(defined).toBe(pending);
    expect(Object.isFrozen(defined)).toBeTrue();
    expect(Object.isFrozen(defined.input.entities)).toBeTrue();
    expect(Object.isFrozen(defined.historicalQuality.triggerInputs.enrichment.premises)).toBeTrue();
  });

  it("recursively freezes mutable descendants of a shallow-frozen authoring case", () => {
    const shallowFrozen = validCase();
    Object.freeze(shallowFrozen);
    expect(Object.isFrozen(shallowFrozen.historicalQuality.triggerInputs.intent)).toBeFalse();
    const defined = defineHistoricalQualityCase(shallowFrozen);
    expect(Object.isFrozen(defined.historicalQuality.triggerInputs)).toBeTrue();
    expect(Object.isFrozen(defined.historicalQuality.triggerInputs.intent)).toBeTrue();
    expect(Object.isFrozen(defined.historicalQuality.triggerInputs.enrichment.premises)).toBeTrue();
  });
});
