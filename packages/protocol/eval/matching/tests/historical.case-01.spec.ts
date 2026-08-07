import { describe, expect, it } from "bun:test";

import { historicalModelSafeProjection, validateHistoricalQualityCase } from "../../discovery-env-matrix/historical-quality.corpus.js";
import { HISTORICAL_CASE_01 } from "../historical/historical.case-01.js";

const participantIds = ["h1-a", "h1-b", "h1-c", "h1-d", "h1-e"] as const;

const source = {
  bio: "Electronics hobbyist with basic hands-on kit experience and early computer exposure.",
  location: "",
  interests: ["electronics", "build-it-yourself devices", "computers"],
  skills: ["electronics fundamentals", "kit assembly", "hands-on construction"],
  intent: "Build and understand electronics devices through hands-on projects.",
};

const partner = {
  bio: "Electronics hobbyist with substantially deeper computer-circuit design and construction practice.",
  location: "",
  interests: ["electronics", "computer systems", "circuit design"],
  skills: ["computer-circuit design", "electronics construction", "technical experimentation"],
  intent: "Design and build computer circuits through repeated technical projects.",
};

const syntheticNegatives = [
  {
    userId: "h1-c",
    profile: {
      name: "Participant C",
      bio: "Local electronics beginner interested in joining a project but without advanced computer-circuit design experience.",
      location: "Northern California",
      interests: ["electronics", "build-it-yourself devices"],
      skills: ["kit assembly", "basic soldering"],
    },
    intent: "Find an experienced circuit designer to lead an electronics project.",
  },
  {
    userId: "h1-d",
    profile: {
      name: "Participant D",
      bio: "Local component seller who supplies materials for electronics projects but does not design circuits.",
      location: "Northern California",
      interests: ["electronic components", "retail"],
      skills: ["inventory management", "customer service"],
    },
    intent: "Supply components to local electronics hobbyists without participating in circuit design.",
  },
  {
    userId: "h1-e",
    profile: {
      name: "Participant E",
      bio: "Experienced local radio hobbyist who builds independently and is unwilling to collaborate on circuit construction.",
      location: "Northern California",
      interests: ["amateur radio", "electronics"],
      skills: ["radio assembly", "soldering"],
    },
    intent: "Continue independent radio projects without collaborating on another person's circuit construction.",
  },
];

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBeTrue();
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
}

describe("historical case 01", () => {
  it("keeps the stable case and participant contract", () => {
    expect(HISTORICAL_CASE_01.id).toBe("historical/builder-and-operator");
    expect(HISTORICAL_CASE_01.rule).toBe("historical");
    expect(HISTORICAL_CASE_01.tier).toBe(3);
    expect(HISTORICAL_CASE_01.input.discovererId).toBe("h1-a");
    expect(HISTORICAL_CASE_01.input.entities.map(({ userId }) => userId)).toEqual([...participantIds]);
    expect(HISTORICAL_CASE_01.expect.map(({ candidateId, match }) => ({ candidateId, match }))).toEqual([
      { candidateId: "h1-b", match: true },
      { candidateId: "h1-c", match: false },
      { candidateId: "h1-d", match: false },
      { candidateId: "h1-e", match: false },
    ]);
    expect(HISTORICAL_CASE_01.historicalQuality.participantKinds).toEqual({
      "h1-a": "historical",
      "h1-b": "historical",
      "h1-c": "synthetic",
      "h1-d": "synthetic",
      "h1-e": "synthetic",
    });
  });

  it("uses the approved pre-1971 historical profiles and ordering evidence", () => {
    expect(HISTORICAL_CASE_01.historicalQuality.cutoff).toEqual({
      date: "1971",
      precision: "year",
      exclusive: true,
      orderingCitationIds: ["esquire-1971", "npr-jobs-lost-interview", "computerworld-jobs-1995", "npr-wozniak-transcript"],
    });

    const [sourceEntity, partnerEntity] = HISTORICAL_CASE_01.input.entities;
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
    expect(HISTORICAL_CASE_01.description).toBe(
      "An electronics hobbyist with basic hands-on construction experience is paired with another hobbyist bringing substantially deeper circuit-design practice.",
    );
    expect(HISTORICAL_CASE_01.description).not.toMatch(/three|negative|synthetic|participant/i);
    expect(HISTORICAL_CASE_01.input.networkContexts?.["h1-electronics"]).toBe(
      "An electronics setting connecting hobbyists with unequal circuit-design and construction experience.",
    );
    expect(HISTORICAL_CASE_01.input.networkContexts?.["h1-electronics"]).not.toMatch(/friend|1971|community|Northern California/i);
    expect(HISTORICAL_CASE_01.historicalQuality.claimProvenance).not.toHaveProperty("/input/entities/0/profile/location");
    expect(HISTORICAL_CASE_01.historicalQuality.claimProvenance).not.toHaveProperty("/input/entities/1/profile/location");

    const citations = new Map(HISTORICAL_CASE_01.historicalQuality.citations.map((citation) => [citation.id, citation]));
    expect(citations.get("esquire-1971")?.url).toBe("https://classic.esquire.com/secrets-of-the-blue-box/");
    expect(citations.get("esquire-1971")?.excerpt).toContain("October 1 1971");
    expect(citations.get("npr-wozniak-2006")?.excerpt).toContain("I first found out about blue boxes in an article in Esquire magazine");
    expect(citations.get("npr-wozniak-2006")?.excerpt).toContain(
      "I had designed -in high school designed hundreds and hundreds of computers over and over and over, so I developed these skills without ever thinking I’d do it in life as job.",
    );
    expect(citations.get("computerworld-jobs-1995")?.excerpt).toContain("He showed me the rudiments of electronics and I got very interested in that");
    expect(citations.get("computerworld-jobs-1995")?.excerpt).toContain("I’ve built two other Heathkits so I could build that");
    expect(citations.get("computerworld-jobs-1995")?.excerpt).toContain("When I was ten or eleven I saw my first computer");
    expect(citations.get("npr-jobs-lost-interview")).toMatchObject({
      title: "Steve Jobs Dishes On The Tech Business In 'Lost Interview' From 1995",
      publisher: "NPR",
    });
    expect(citations.get("npr-jobs-lost-interview")?.excerpt).toContain("The first big project by the men");
    expect(citations.get("npr-wozniak-transcript")?.excerpt).toContain("I had built a computer");
    expect(citations.get("computer-history-museum-jobs")).toMatchObject({
      url: "https://computerhistory.org/blog/steve-jobs/",
      title: "Steve Jobs: From Garage to World’s Most Valuable Company",
      excerpt: "Jobs and Wozniak had been friends for some time. They met in 1971 when their mutual friend, Bill Fernandez, introduced then 21-year-old Wozniak to 16-year-old Jobs.",
    });
    expect(citations.get("loc-apple-founding")?.excerpt).toContain("by college dropouts Steve Jobs and Steve Wozniak");
    expect(HISTORICAL_CASE_01.historicalQuality.outcomeCitationIds).toEqual(["loc-apple-founding"]);

    const claims = new Map(HISTORICAL_CASE_01.historicalQuality.claims.map((claim) => [claim.id, claim]));
    const modelCitationIds = new Set<string>();
    const collectCitations = (claimId: string): void => {
      const claim = claims.get(claimId)!;
      if (claim.kind === "historical") {
        for (const citationId of claim.citationIds) modelCitationIds.add(citationId);
      } else if (claim.kind === "derived") {
        for (const basisClaimId of claim.basisClaimIds) collectCitations(basisClaimId);
      }
    };
    for (const claimIds of Object.values(HISTORICAL_CASE_01.historicalQuality.claimProvenance)) {
      for (const claimId of claimIds) collectCitations(claimId);
    }
    expect(modelCitationIds.has("esquire-1971")).toBeFalse();
    expect(modelCitationIds.has("npr-jobs-lost-interview")).toBeFalse();

    const dependsOnClaim = (claimId: string, requiredClaimId: string): boolean => {
      if (claimId === requiredClaimId) return true;
      const claim = claims.get(claimId)!;
      return claim.kind === "derived" && claim.basisClaimIds.some((basisClaimId) => dependsOnClaim(basisClaimId, requiredClaimId));
    };
    for (const path of [
      "/description",
      "/input/entities/1/profile/bio",
      "/input/entities/1/profile/interests/1",
      "/input/entities/1/profile/skills/0",
      "/input/entities/1/intents/0/payload",
    ]) {
      const claimIds = HISTORICAL_CASE_01.historicalQuality.claimProvenance[path]!;
      expect(claimIds.some((claimId) => dependsOnClaim(claimId, "fact-wozniak-design-practice")), path).toBeTrue();
    }
    const sourceIntentClaims = HISTORICAL_CASE_01.historicalQuality.claimProvenance["/input/entities/0/intents/0/payload"]!;
    expect(sourceIntentClaims.some((claimId) => dependsOnClaim(claimId, "fact-jobs-childhood-electronics"))).toBeTrue();
    expect(sourceIntentClaims.some((claimId) => dependsOnClaim(claimId, "fact-wozniak-design-practice"))).toBeFalse();
  });

  it("records independent approval while preserving explicit authoring-mode mutations", () => {
    expect(HISTORICAL_CASE_01.historicalQuality.anonymizationReview).toEqual({
      reviewer: "pi-reviewer:e8085cfa",
      reviewedAt: "2026-08-06",
      recognizability: "medium",
      decision: "approved",
      rationale:
        "The reviewer approved the generalized capability complement after confirming exact citations, first-big-project ordering, participant-only activity intents, outcome isolation, distinct negatives, and current projection safety.",
    });
    expect(() => validateHistoricalQualityCase(HISTORICAL_CASE_01)).not.toThrow();

    for (const decision of ["pending", "revise"] as const) {
      const mutation = structuredClone(HISTORICAL_CASE_01);
      mutation.historicalQuality.anonymizationReview.decision = decision;
      expect(() => validateHistoricalQualityCase(mutation)).toThrow(/anonymization review must be approved/);
      expect(() => validateHistoricalQualityCase(mutation, { requireApprovedReview: false })).not.toThrow();
    }
  });

  it("keeps post-collaboration and project-trigger terms out of model-facing text", () => {
    const modelText = JSON.stringify(historicalModelSafeProjection(HISTORICAL_CASE_01));
    const forbidden = /personal computers?|homebrew|selling|persuasion|parts sourcing|apple|blue boxes?|telephone tones?|co-?found(?:er|ing)?|commercial(?:ize|ization)?|sales|marketing|business role/i;
    expect(modelText).not.toMatch(forbidden);
    const historicalProfiles = JSON.stringify(HISTORICAL_CASE_01.input.entities.slice(0, 2));
    expect(historicalProfiles).not.toMatch(/school friend|mutual friend|ham radio|nearby engineer|1971/i);
  });

  it("authors three distinct generic electronics negatives with exact reasons", () => {
    const negativeIds = participantIds.slice(2);
    const negatives = HISTORICAL_CASE_01.historicalQuality.semanticNegatives;
    expect(Object.keys(negatives)).toEqual(negativeIds);
    expect(new Set(Object.values(negatives)).size).toBe(3);
    const modelFacingNegatives = historicalModelSafeProjection(HISTORICAL_CASE_01).input.entities.slice(2);
    for (const [index, expectedNegative] of syntheticNegatives.entries()) {
      expect(modelFacingNegatives[index]!.userId).toBe(expectedNegative.userId);
      expect(modelFacingNegatives[index]!.profile).toEqual(expectedNegative.profile);
      expect(modelFacingNegatives[index]!.intents?.[0]?.payload).toBe(expectedNegative.intent);
    }
    for (const participantId of negativeIds) {
      expect(negatives[participantId].trim().length).toBeGreaterThan(0);
      const participantClaims = HISTORICAL_CASE_01.historicalQuality.claims.filter(
        (claim) => claim.kind === "authored" && claim.participantId === participantId,
      );
      expect(participantClaims.length).toBeGreaterThan(0);
      expect(participantClaims.every((claim) => claim.kind === "authored" && claim.violatedRequirement === negatives[participantId])).toBeTrue();
    }
  });

  it("is recursively frozen", () => {
    expectDeeplyFrozen(HISTORICAL_CASE_01);
  });
});
