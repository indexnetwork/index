import { describe, expect, it } from "bun:test";

import { historicalModelSafeProjection, validateHistoricalQualityCase } from "../../discovery-env-matrix/historical-quality.corpus.js";
import { HISTORICAL_CASE_02 } from "../historical/historical.case-02.js";

const participantIds = ["h2-a", "h2-b", "h2-c", "h2-d", "h2-e"] as const;

const source = {
  bio: "Biologist trained in zoology and virus research who redirected his work toward the structural chemistry of biological macromolecules.",
  location: "Europe",
  interests: ["biological macromolecules", "structural chemistry", "virus research"],
  skills: ["biology", "experimental biology", "virus research"],
  intent: "Investigate biological macromolecular structure through structural chemistry.",
};

const partner = {
  bio: "Physics-trained researcher using crystallographic methods to study biological macromolecules.",
  location: "United Kingdom",
  interests: ["biological structure", "macromolecules", "structural chemistry"],
  skills: ["physical methods", "X-ray crystallography", "structural analysis"],
  intent: "Study biological structure using physical and crystallographic methods.",
};

const syntheticNegatives = [
  {
    userId: "h2-c",
    profile: {
      name: "Participant C",
      bio: "Experimental biologist studying biological structure through laboratory work and seeking complementary physical analysis.",
      location: "Southern England",
      interests: ["experimental biology", "biological structure"],
      skills: ["biology", "laboratory experimentation"],
    },
    intent: "Find a collaborator with physical and crystallographic methods for a biological structure problem.",
  },
  {
    userId: "h2-d",
    profile: {
      name: "Participant D",
      bio: "Laboratory administrator who manages funding, equipment, and scheduling but does not conduct scientific analysis.",
      location: "Southern England",
      interests: ["research administration", "laboratory operations"],
      skills: ["budgeting", "laboratory management"],
    },
    intent: "Support a research group through administration and operations rather than scientific collaboration.",
  },
  {
    userId: "h2-e",
    profile: {
      name: "Participant E",
      bio: "Chemist studying reactions of small industrial compounds rather than biological macromolecular structure.",
      location: "Southern England",
      interests: ["small-molecule chemistry", "reaction kinetics"],
      skills: ["organic synthesis", "kinetic analysis"],
    },
    intent: "Investigate synthesis and reaction rates for small industrial compounds.",
  },
];

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBeTrue();
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
}

describe("historical case 02", () => {
  it("keeps the stable case and participant contract", () => {
    expect(HISTORICAL_CASE_02.id).toBe("historical/co-researchers-structure");
    expect(HISTORICAL_CASE_02.rule).toBe("historical");
    expect(HISTORICAL_CASE_02.tier).toBe(3);
    expect(HISTORICAL_CASE_02.input.discovererId).toBe("h2-a");
    expect(HISTORICAL_CASE_02.input.entities.map(({ userId }) => userId)).toEqual([...participantIds]);
    expect(HISTORICAL_CASE_02.expect.map(({ candidateId, match }) => ({ candidateId, match }))).toEqual([
      { candidateId: "h2-b", match: true },
      { candidateId: "h2-c", match: false },
      { candidateId: "h2-d", match: false },
      { candidateId: "h2-e", match: false },
    ]);
    expect(HISTORICAL_CASE_02.historicalQuality.participantKinds).toEqual({
      "h2-a": "historical",
      "h2-b": "historical",
      "h2-c": "synthetic",
      "h2-d": "synthetic",
      "h2-e": "synthetic",
    });
  });

  it("uses the approved pre-connection profiles and October 1951 boundary", () => {
    expect(HISTORICAL_CASE_02.historicalQuality.cutoff).toEqual({
      event: {
        id: "h2-first-substantive-collaboration",
        description: "Immediately before James Watson and Francis Crick began substantive collaboration in October 1951.",
      },
      calendarProxy: { date: "1951-10", precision: "month" },
      confidence: "high",
      uncertaintyRationale: "Independent histories place collaboration in October 1951, while the exact first working day is not established.",
      exclusive: true,
      orderingCitationIds: ["nobel-watson-biographical", "asu-1953-paper-history"],
    });

    const [sourceEntity, partnerEntity] = HISTORICAL_CASE_02.input.entities;
    expect(sourceEntity!.profile).toMatchObject({
      bio: source.bio,
      location: source.location,
      interests: source.interests,
      skills: source.skills,
    });
    expect(sourceEntity!.intents?.[0]?.payload).toBe(source.intent);
    expect(partnerEntity!.profile).toMatchObject({
      bio: partner.bio,
      location: partner.location,
      interests: partner.interests,
      skills: partner.skills,
    });
    expect(partnerEntity!.intents?.[0]?.payload).toBe(partner.intent);

    const citations = new Map(HISTORICAL_CASE_02.historicalQuality.citations.map((citation) => [citation.id, citation]));
    expect(citations.get("nobel-watson-biographical")).toMatchObject({
      url: "https://www.nobelprize.org/prizes/medicine/1962/watson/biographical/",
      publisher: "Nobel Foundation",
    });
    expect(citations.get("nobel-watson-biographical")?.excerpt).toContain("started work in early October 1951. He soon met Crick");
    expect(citations.get("wellcome-crick-archives")?.url).toBe("https://wellcomecollection.org/works/hz43r7re");
    expect(citations.get("wellcome-crick-archives")?.excerpt).toContain("June 1949");
    expect(citations.get("asu-1953-paper-history")).toMatchObject({
      title: "“Molecular Structure of Nucleic Acids: A Structure for Deoxyribose Nucleic Acid” (1953), by James Watson and Francis Crick",
      excerpt: "The collaboration … began in October 1951 soon after Watson arrived…",
    });
    expect(citations.get("science-history-biographies")?.excerpt).toContain("saw some of the X-ray images");
    expect(HISTORICAL_CASE_02.historicalQuality.outcomeCitationIds).toEqual(["nobel-1962-summary"]);

    const claims = new Map(HISTORICAL_CASE_02.historicalQuality.claims.map((claim) => [claim.id, claim]));
    const modelCitationIds = new Set<string>();
    const collectCitations = (claimId: string): void => {
      const claim = claims.get(claimId)!;
      if (claim.kind === "historical") {
        for (const citationId of claim.citationIds) modelCitationIds.add(citationId);
      } else if (claim.kind === "derived") {
        for (const basisClaimId of claim.basisClaimIds) collectCitations(basisClaimId);
      }
    };
    for (const claimIds of Object.values(HISTORICAL_CASE_02.historicalQuality.claimProvenance)) {
      for (const claimId of claimIds) collectCitations(claimId);
    }
    expect([...modelCitationIds].sort()).toEqual([
      "nobel-watson-biographical",
      "science-history-biographies",
      "wellcome-crick-archives",
    ]);
    expect(modelCitationIds.has("asu-1953-paper-history")).toBeFalse();
    expect(modelCitationIds.has("nobel-1962-summary")).toBeFalse();
  });

  it("records independent approval while preserving explicit authoring-mode mutations", () => {
    expect(HISTORICAL_CASE_02.historicalQuality.anonymizationReview).toEqual({
      reviewer: "pi-reviewer:5e071b82",
      reviewedAt: "2026-08-06",
      recognizability: "medium",
      decision: "approved",
      rationale:
        "The reviewer approved the generalized macromolecular and physical-methods complement after confirming exact citation metadata, pre-October provenance, independent activity intents, distinct negatives, and safe current projections.",
    });
    expect(() => validateHistoricalQualityCase(HISTORICAL_CASE_02)).not.toThrow();

    for (const decision of ["pending", "revise"] as const) {
      const mutation = structuredClone(HISTORICAL_CASE_02);
      mutation.historicalQuality.anonymizationReview.decision = decision;
      expect(() => validateHistoricalQualityCase(mutation)).toThrow(/anonymization review must be approved/);
      expect(() => validateHistoricalQualityCase(mutation, { requireApprovedReview: false })).not.toThrow();
    }
  });

  it("keeps diffraction-data possession, outcome hindsight, and post-meeting work out of model-facing text", () => {
    const modelText = JSON.stringify(historicalModelSafeProjection(HISTORICAL_CASE_02));
    const forbidden = /access to (?:x-ray )?diffraction data|(?:his|her|their|own) diffraction data|possess(?:es|ed|ion)?[^.]*data|franklin|gosling|photo(?:graph)?\s*51|double helix|landmark|nobel|award|certain[^.]*solv|within reach|crack(?:ed|ing)?[^.]*shape|started work|soon met|collaboration began|builds? structural models?|restless|scientific meeting|x-ray images|experimental interpretation|physical modeling|\byoung\b|nucleic acids|genetic material/i;
    expect(modelText).not.toMatch(forbidden);
  });

  it("authors three distinct synthetic negatives with exact reasons", () => {
    const negativeIds = participantIds.slice(2);
    const negatives = HISTORICAL_CASE_02.historicalQuality.semanticNegatives;
    expect(Object.keys(negatives)).toEqual(negativeIds);
    expect(new Set(Object.values(negatives)).size).toBe(3);
    const modelFacingNegatives = historicalModelSafeProjection(HISTORICAL_CASE_02).input.entities.slice(2);
    for (const [index, expectedNegative] of syntheticNegatives.entries()) {
      expect(modelFacingNegatives[index]!.userId).toBe(expectedNegative.userId);
      expect(modelFacingNegatives[index]!.profile).toEqual(expectedNegative.profile);
      expect(modelFacingNegatives[index]!.intents?.[0]?.payload).toBe(expectedNegative.intent);
    }
    for (const participantId of negativeIds) {
      expect(negatives[participantId].trim().length).toBeGreaterThan(0);
      const participantClaims = HISTORICAL_CASE_02.historicalQuality.claims.filter(
        (claim) => claim.kind === "authored" && claim.participantId === participantId,
      );
      expect(participantClaims.length).toBeGreaterThan(0);
      expect(participantClaims.every((claim) => claim.kind === "authored" && claim.violatedRequirement === negatives[participantId])).toBeTrue();
    }
  });

  it("has complete path-level provenance and is recursively frozen", () => {
    expect(() => validateHistoricalQualityCase(HISTORICAL_CASE_02, { requireApprovedReview: false })).not.toThrow();
    expectDeeplyFrozen(HISTORICAL_CASE_02);
  });
});
