import { describe, expect, it } from "bun:test";

import { historicalModelSafeProjection, validateHistoricalQualityCase } from "../../discovery-env-matrix/historical-quality.corpus.js";
import { HISTORICAL_CASE_01 } from "../historical/historical.case-01.js";

const participantIds = ["h1-a", "h1-b", "h1-c", "h1-d", "h1-e"] as const;

const source = {
  bio: "Teenage Northern California electronics hobbyist who learned basic electronics from family and a nearby engineer, assembled build-it-yourself electronics kits, and had early exposure to computers.",
  location: "Northern California",
  interests: ["electronics", "build-it-yourself devices", "computers"],
  skills: ["electronics fundamentals", "kit assembly", "hands-on construction"],
  intent: "Explore an electronics project with another hobbyist who has deeper circuit-design experience.",
};

const partner = {
  bio: "Young electronics hobbyist with extensive practice designing computer circuits and building computer and radio projects. Had already built a computer project with a school friend.",
  location: "",
  interests: ["electronics", "computer design", "amateur radio"],
  skills: ["computer-circuit design", "electronics construction", "technical experimentation"],
  intent: "Apply prior circuit-design experience in an electronics project with another hobbyist.",
};

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
      orderingCitationIds: ["esquire-1971", "npr-wozniak-2006", "computerworld-jobs-1995", "npr-wozniak-transcript"],
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
      "Two young electronics hobbyists brought complementary pre-project experience: one had hands-on electronics familiarity, while the other had extensive computer-circuit design practice.",
    );
    expect(HISTORICAL_CASE_01.description).not.toMatch(/three|negative|synthetic|participant/i);
    expect(HISTORICAL_CASE_01.input.networkContexts?.["h1-electronics"]).toBe(
      "Two electronics hobbyists introduced by a mutual friend in 1971.",
    );
    expect(HISTORICAL_CASE_01.input.networkContexts?.["h1-electronics"]).not.toMatch(/community|Northern California/i);
    expect(HISTORICAL_CASE_01.historicalQuality.claimProvenance).not.toHaveProperty("/input/entities/1/profile/location");

    const citations = new Map(HISTORICAL_CASE_01.historicalQuality.citations.map((citation) => [citation.id, citation]));
    expect(citations.get("esquire-1971")?.url).toBe("https://classic.esquire.com/secrets-of-the-blue-box/");
    expect(citations.get("esquire-1971")?.excerpt).toContain("October 1 1971");
    expect(citations.get("npr-wozniak-2006")?.excerpt).toContain("I first found out about blue boxes in an article in Esquire magazine");
    expect(citations.get("npr-wozniak-2006")?.excerpt).toContain(
      "I had designed -in high school designed hundreds and hundreds of computers over and over and over, so I developed these skills without ever thinking I’d do it in life as job.",
    );
    expect(citations.get("computerworld-jobs-1995")?.excerpt).toContain("He showed me the rudiments of electronics and I got very interested in that");
    expect(citations.get("computerworld-jobs-1995")?.excerpt).toContain(
      "I grew up in Silicon Valley. My parents moved from San Francisco to Mountain View when I was five. My dad got transferred and that was right in the heart of Silicon Valley so there were engineers all around.",
    );
    expect(citations.get("npr-wozniak-transcript")?.excerpt).toContain("I had built a computer");
    expect(citations.get("computer-history-museum-jobs")).toMatchObject({
      url: "https://computerhistory.org/blog/steve-jobs/",
      title: "Steve Jobs: From Garage to World’s Most Valuable Company",
      excerpt: "Jobs and Wozniak had been friends for some time. They met in 1971 when their mutual friend, Bill Fernandez, introduced then 21-year-old Wozniak to 16-year-old Jobs.",
    });
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

    const dependsOnClaim = (claimId: string, requiredClaimId: string): boolean => {
      if (claimId === requiredClaimId) return true;
      const claim = claims.get(claimId)!;
      return claim.kind === "derived" && claim.basisClaimIds.some((basisClaimId) => dependsOnClaim(basisClaimId, requiredClaimId));
    };
    for (const path of [
      "/description",
      "/input/entities/0/intents/0/payload",
      "/input/entities/1/profile/bio",
      "/input/entities/1/profile/interests/1",
      "/input/entities/1/profile/skills/0",
      "/input/entities/1/intents/0/payload",
    ]) {
      const claimIds = HISTORICAL_CASE_01.historicalQuality.claimProvenance[path]!;
      expect(claimIds.some((claimId) => dependsOnClaim(claimId, "fact-wozniak-design-practice")), path).toBeTrue();
    }
  });

  it("remains pending independent review while passing authoring validation", () => {
    expect(HISTORICAL_CASE_01.historicalQuality.anonymizationReview.decision).toBe("pending");
    expect(() => validateHistoricalQualityCase(HISTORICAL_CASE_01)).toThrow(/anonymization review must be approved/);
    expect(() => validateHistoricalQualityCase(HISTORICAL_CASE_01, { requireApprovedReview: false })).not.toThrow();
  });

  it("keeps post-collaboration and project-trigger terms out of model-facing text", () => {
    const modelText = JSON.stringify(historicalModelSafeProjection(HISTORICAL_CASE_01));
    const forbidden = /personal computers?|homebrew|selling|persuasion|parts sourcing|apple|blue boxes?|telephone tones?|co-?found(?:er|ing)?|commercial(?:ize|ization)?|sales|marketing|business role/i;
    expect(modelText).not.toMatch(forbidden);
  });

  it("authors three distinct generic electronics negatives with exact reasons", () => {
    const negativeIds = participantIds.slice(2);
    const negatives = HISTORICAL_CASE_01.historicalQuality.semanticNegatives;
    expect(Object.keys(negatives)).toEqual(negativeIds);
    expect(new Set(Object.values(negatives)).size).toBe(3);
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
