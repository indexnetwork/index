import { describe, expect, it } from "bun:test";

import { historicalModelSafeProjection, validateHistoricalQualityCase } from "../../discovery-env-matrix/historical-quality.corpus.js";
import { HISTORICAL_CASE_03 } from "../historical/historical.case-03.js";

const participantIds = ["h3-a", "h3-b", "h3-c", "h3-d", "h3-e"] as const;

const source = {
  bio: "Teenage guitarist in northern England who leads an amateur popular-music group and performs at community events. Interested in improving the group’s musicianship.",
  location: "Northern England",
  interests: ["popular music", "guitar", "live performance"],
  skills: ["guitar", "live performance", "group leadership"],
  intent: "Find a capable local guitarist to strengthen an amateur performance group.",
};

const partner = {
  bio: "Teenage popular-music enthusiast in northern England who plays guitar, can tune it, remembers songs accurately, and had already tried writing a song.",
  location: "Northern England",
  interests: ["popular music", "guitar", "early songwriting"],
  skills: ["guitar playing", "instrument tuning", "song recall"],
  intent: "Play and improve at contemporary popular music, including guitar and early songwriting.",
};

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBeTrue();
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
}

describe("historical case 03", () => {
  it("keeps the stable case and participant contract", () => {
    expect(HISTORICAL_CASE_03.id).toBe("historical/songwriting-duo");
    expect(HISTORICAL_CASE_03.rule).toBe("historical");
    expect(HISTORICAL_CASE_03.tier).toBe(3);
    expect(HISTORICAL_CASE_03.input.discovererId).toBe("h3-a");
    expect(HISTORICAL_CASE_03.input.entities.map(({ userId }) => userId)).toEqual([...participantIds]);
    expect(HISTORICAL_CASE_03.expect.map(({ candidateId, match }) => ({ candidateId, match }))).toEqual([
      { candidateId: "h3-b", match: true },
      { candidateId: "h3-c", match: false },
      { candidateId: "h3-d", match: false },
      { candidateId: "h3-e", match: false },
    ]);
    expect(HISTORICAL_CASE_03.historicalQuality.participantKinds).toEqual({
      "h3-a": "historical",
      "h3-b": "historical",
      "h3-c": "synthetic",
      "h3-d": "synthetic",
      "h3-e": "synthetic",
    });
  });

  it("uses the approved profiles, exclusive meeting-day cutoff, and guitarist-recruitment trigger", () => {
    expect(HISTORICAL_CASE_03.historicalQuality.cutoff).toEqual({
      date: "1957-07-06",
      precision: "day",
      exclusive: true,
      orderingCitationIds: ["nml-first-meeting", "national-trust-history"],
    });

    const [sourceEntity, partnerEntity] = HISTORICAL_CASE_03.input.entities;
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
    expect(HISTORICAL_CASE_03.description).toBe(
      "A teenage group leader seeking a better guitarist encountered a local player who demonstrated relevant guitar skills and had already begun exploring songwriting.",
    );

    const citations = new Map(HISTORICAL_CASE_03.historicalQuality.citations.map((citation) => [citation.id, citation]));
    expect(citations.get("nml-first-meeting")).toMatchObject({
      url: "https://www.liverpoolmuseums.org.uk/stories/when-paul-mccartney-met-john-lennon",
      title: "When Paul McCartney met John Lennon",
      publisher: "National Museums Liverpool",
    });
    expect(citations.get("nml-first-meeting")?.excerpt).toContain("6 July 1957");
    expect(citations.get("nml-first-meeting")?.excerpt).toContain("improvised words");
    expect(citations.get("nml-first-meeting")?.excerpt).toContain("tune a guitar");
    expect(citations.get("john-lennon-mother")?.url).toBe(
      "https://www.johnlennon.com/news/mother-%E2%86%92-watch-the-4k-remastered-video-discover-more-about-johns-childhood/",
    );
    expect(citations.get("john-lennon-mother")?.excerpt).toContain("banjo chords");
    expect(citations.get("mccartney-lyrics-special")?.excerpt).toContain("the first song I ever wrote");
    expect(citations.get("mccartney-lyrics-special")?.excerpt).toContain("when I was fourteen");
    expect(citations.get("national-trust-history")?.excerpt).toContain("he'd been looking for a better guitarist for his group");
    expect(HISTORICAL_CASE_03.historicalQuality.outcomeCitationIds).toEqual(["guinness-songwriter-number-ones"]);

    const claims = new Map(HISTORICAL_CASE_03.historicalQuality.claims.map((claim) => [claim.id, claim]));
    const dependsOnClaim = (claimId: string, requiredClaimId: string): boolean => {
      if (claimId === requiredClaimId) return true;
      const claim = claims.get(claimId)!;
      return claim.kind === "derived" && claim.basisClaimIds.some((basisClaimId) => dependsOnClaim(basisClaimId, requiredClaimId));
    };
    for (const path of ["/description", "/input/entities/0/intents/0/payload", "/triggerInputs/intent/text"]) {
      const claimIds = HISTORICAL_CASE_03.historicalQuality.claimProvenance[path]!;
      expect(claimIds.some((claimId) => dependsOnClaim(claimId, "fact-guitarist-recruitment")), path).toBeTrue();
    }

    const modelCitationIds = new Set<string>();
    const collectCitations = (claimId: string): void => {
      const claim = claims.get(claimId)!;
      if (claim.kind === "historical") {
        for (const citationId of claim.citationIds) modelCitationIds.add(citationId);
      } else if (claim.kind === "derived") {
        for (const basisClaimId of claim.basisClaimIds) collectCitations(basisClaimId);
      }
    };
    for (const claimIds of Object.values(HISTORICAL_CASE_03.historicalQuality.claimProvenance)) {
      for (const claimId of claimIds) collectCitations(claimId);
    }
    expect([...modelCitationIds].sort()).toEqual([
      "john-lennon-mother",
      "mccartney-lyrics-special",
      "national-trust-history",
      "nml-first-meeting",
    ]);
    expect(modelCitationIds.has("guinness-songwriter-number-ones")).toBeFalse();
  });

  it("remains pending independent review while passing authoring validation", () => {
    expect(HISTORICAL_CASE_03.historicalQuality.anonymizationReview.decision).toBe("pending");
    expect(() => validateHistoricalQualityCase(HISTORICAL_CASE_03)).toThrow(/anonymization review must be approved/);
    expect(() => validateHistoricalQualityCase(HISTORICAL_CASE_03, { requireApprovedReview: false })).not.toThrow();
  });

  it("generalizes unique identities and removes the speculative co-writing frame from model-facing text", () => {
    const modelText = JSON.stringify(historicalModelSafeProjection(HISTORICAL_CASE_03));
    const forbidden = /bass|half-finished|melodically gifted|co-writer|john|lennon|paul|mccartney|julia|mimi|ivan vaughan|eric griffiths|pete shotton|colin hanton|rod davis|len garry|eddie cochran|gene vincent|little richard|quarry\s*men|beatles|liverpool|lancashire|woolton|st\.? peter|mendips|forthlin|menlove|cavern|twenty flight rock|be-bop-a-lula|i lost my little girl|long tall sally|that(?:’|'|’)ll be the day|mother|port city|club circuit|harmony|arrangement|edgy|melodic/i;
    expect(modelText).not.toMatch(forbidden);
  });

  it("authors three distinct guitarist-recruitment negatives with exact reasons", () => {
    const negativeIds = participantIds.slice(2);
    const negatives = HISTORICAL_CASE_03.historicalQuality.semanticNegatives;
    expect(Object.keys(negatives)).toEqual(negativeIds);
    expect(new Set(Object.values(negatives)).size).toBe(3);
    expect(negatives).toEqual({
      "h3-c": "Same-side group leader seeks another guitarist but is not available to join and strengthen the source participant’s group.",
      "h3-d": "Non-performing promoter can arrange events but cannot provide the required guitar performance skill.",
      "h3-e": "Technically trained musician has strong instrumental skill but is uninterested in popular group performance.",
    });
    for (const participantId of negativeIds) {
      const participantClaims = HISTORICAL_CASE_03.historicalQuality.claims.filter(
        (claim) => claim.kind === "authored" && claim.participantId === participantId,
      );
      expect(participantClaims.length).toBeGreaterThan(0);
      expect(participantClaims.every((claim) => claim.kind === "authored" && claim.violatedRequirement === negatives[participantId])).toBeTrue();
    }
  });

  it("has complete provenance and recursively frozen text", () => {
    expect(() => validateHistoricalQualityCase(HISTORICAL_CASE_03, { requireApprovedReview: false })).not.toThrow();
    expectDeeplyFrozen(HISTORICAL_CASE_03);
  });
});
