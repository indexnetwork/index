import { describe, expect, it } from "bun:test";

import { historicalModelSafeProjection, validateHistoricalQualityCase } from "../../discovery-env-matrix/historical-quality.corpus.js";
import { HISTORICAL_CASE_03 } from "../historical/historical.case-03.js";

const participantIds = ["h3-a", "h3-b", "h3-c", "h3-d", "h3-e"] as const;

const source = {
  bio: "Teenage guitarist leading an amateur popular-music group and seeking stronger instrumental capability for the group.",
  location: "",
  interests: ["popular music", "guitar", "group performance"],
  skills: ["guitar", "group performance", "group leadership"],
  intent: "Find a capable guitarist to strengthen an amateur performance group.",
};

const partner = {
  bio: "Teenage popular-music player with demonstrated guitar ability.",
  location: "",
  interests: ["popular music", "guitar"],
  skills: ["guitar playing"],
  intent: "Perform popular music on guitar.",
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

  it("uses the approved profiles, first-substantive-collaboration cutoff, and guitarist-recruitment trigger", () => {
    expect(HISTORICAL_CASE_03.historicalQuality.cutoff).toEqual({
      date: "1957-07",
      precision: "month",
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
      "A teenage amateur-group leader seeking stronger guitar capability is paired with a teenage popular-music player with demonstrated guitar ability.",
    );

    expect(HISTORICAL_CASE_03.historicalQuality.citations).toEqual([
      {
        id: "nml-first-meeting",
        url: "https://www.liverpoolmuseums.org.uk/stories/when-paul-mccartney-met-john-lennon",
        title: "When Paul McCartney met John Lennon",
        publisher: "National Museums Liverpool",
        excerpt:
          "But for me, it really all began the day John met Paul at St Peter’s Church Hall fete in Woolton on 6 July 1957. … He correctly re-tuned it, turned it upside to be able to play it left-handed and treated the gang to an impromptu, word perfect, virtuoso performance of Eddie Cochran’s minor hit, 'Twenty Flight Rock'. … A few weeks after that fateful meeting, John asked him to join his group.",
      },
      {
        id: "john-lennon-mother",
        url: "https://www.johnlennon.com/news/mother-%E2%86%92-watch-the-4k-remastered-video-discover-more-about-johns-childhood/",
        title: "MOTHER. → Watch the 4K Remastered Video & discover more about John's childhood.",
        publisher: "JohnLennon.com",
        excerpt:
          "She first taught me how to play banjo chords – that’s why in very early photos of the group I’m playing funny chords – and from that I progressed to guitar. I used to borrow a guitar at first. I couldn’t play, but my mother bought me one from one of those mail-order firms. It was a bit crummy, but I played it all the time and got a lot of practice.",
      },
      {
        id: "mccartney-lyrics-special",
        url: "https://www.paulmccartney.com/news/you-gave-me-the-answer-the-lyrics-1956-to-the-present-special",
        title: "You Gave Me The Answer - 'The Lyrics: 1956 to the Present' Special",
        publisher: "PaulMcCartney.com",
        excerpt:
          "It wasn’t really a forgotten memory, but revisiting the first song I ever wrote ‘I Lost My Little Girl’ was interesting. It kind of turned into a therapy session, because I thought I was happily writing a little pop song when I was fourteen, but if you look at the timing of it I had just lost my mother.",
      },
      {
        id: "national-trust-history",
        url: "https://www.nationaltrust.org.uk/visit/liverpool-lancashire/the-beatles-childhood-homes/history-of-the-beatles-childhood-homes",
        title: "History of the Beatles' Childhood Homes",
        publisher: "National Trust",
        excerpt:
          "John was not easily impressed, but he'd been looking for a better guitarist for his group and here was someone who could really tune and play the instrument. John asked Paul to join The Quarrymen, and their musical partnership was born.",
      },
      {
        id: "guinness-songwriter-number-ones",
        url: "https://www.guinnessworldrecords.com/world-records/69695-most-number-one-singles-by-a-songwriter",
        title: "Most US No.1 singles by a songwriter",
        publisher: "Guinness World Records",
        excerpt:
          "Sir Paul McCartney (UK) has achieved 32 No.1 singles on the US Billboard Hot 100 as a songwriter, including 20 as a member of The Beatles (in collaboration with John Lennon) and six with Wings.",
      },
    ]);
    expect(HISTORICAL_CASE_03.historicalQuality.claimProvenance).not.toHaveProperty("/input/entities/0/profile/location");
    expect(HISTORICAL_CASE_03.historicalQuality.claimProvenance).not.toHaveProperty("/input/entities/1/profile/location");
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
    expect([...modelCitationIds].sort()).toEqual(["john-lennon-mother", "national-trust-history", "nml-first-meeting"]);
    expect(modelCitationIds.has("guinness-songwriter-number-ones")).toBeFalse();
  });

  it("records independent approval while preserving explicit authoring-mode mutations", () => {
    expect(HISTORICAL_CASE_03.historicalQuality.anonymizationReview).toEqual({
      reviewer: "pi-reviewer:a091da6e",
      reviewedAt: "2026-08-06",
      recognizability: "medium",
      decision: "approved",
      rationale:
        "The reviewer approved the generalized guitarist-recruitment complement after confirming exact citations, the first-substantive month boundary, complete provenance, distinct negatives, outcome isolation, and removal of regional, event, tuning, recall, and invitation clues from current projections.",
    });
    expect(() => validateHistoricalQualityCase(HISTORICAL_CASE_03)).not.toThrow();

    for (const decision of ["pending", "revise"] as const) {
      const mutation = structuredClone(HISTORICAL_CASE_03);
      mutation.historicalQuality.anonymizationReview.decision = decision;
      expect(() => validateHistoricalQualityCase(mutation)).toThrow(/anonymization review must be approved/);
      expect(() => validateHistoricalQualityCase(mutation, { requireApprovedReview: false })).not.toThrow();
    }
  });

  it("generalizes unique identities and removes the speculative co-writing frame from model-facing text", () => {
    const modelText = JSON.stringify(historicalModelSafeProjection(HISTORICAL_CASE_03));
    const forbidden = /bass|half-finished|melodically gifted|co-writer|john|lennon|paul|mccartney|julia|mimi|ivan vaughan|eric griffiths|pete shotton|colin hanton|rod davis|len garry|eddie cochran|gene vincent|little richard|quarry\s*men|beatles|liverpool|lancashire|woolton|st\.? peter|mendips|forthlin|menlove|cavern|twenty flight rock|be-bop-a-lula|i lost my little girl|long tall sally|that(?:’|'|’)ll be the day|mother|port city|club circuit|harmony|arrangement|edgy|melodic/i;
    expect(modelText).not.toMatch(forbidden);
    expect(modelText).not.toMatch(
      /northern england|\blocal\b|\bevents?\b|instrument tuning|musical memory|performance from memory|song recall|early songwriting|before being invited|invitation sequence|few weeks|1957/i,
    );
    expect(HISTORICAL_CASE_03.input.networkContexts?.["h3-music"]).toBe(
      "An amateur popular-music setting connecting a group leader with other guitar players.",
    );
  });

  it("authors three distinct guitarist-recruitment negatives with exact reasons", () => {
    const negativeIds = participantIds.slice(2);
    const negatives = HISTORICAL_CASE_03.historicalQuality.semanticNegatives;
    expect(Object.keys(negatives)).toEqual(negativeIds);
    expect(new Set(Object.values(negatives)).size).toBe(3);
    expect(negatives).toEqual({
      "h3-c": "Same-side group leader seeks another guitarist but is not available to join and strengthen the source participant’s group.",
      "h3-d": "Non-performing promoter can arrange performances but cannot provide the required guitar performance skill.",
      "h3-e": "Technically trained musician has strong instrumental skill but is uninterested in popular group performance.",
    });
    for (const [index, participantId] of negativeIds.entries()) {
      const participantClaims = HISTORICAL_CASE_03.historicalQuality.claims.filter(
        (claim) => claim.kind === "authored" && claim.participantId === participantId,
      );
      expect(participantClaims.length).toBeGreaterThan(0);
      expect(participantClaims.every((claim) => claim.kind === "authored" && claim.violatedRequirement === negatives[participantId])).toBeTrue();
      expect(JSON.stringify(participantClaims)).not.toMatch(/northern england|\blocal\b|\bevents?\b/i);
      expect(HISTORICAL_CASE_03.input.entities[index + 2]!.profile.location).toBe("");
      expect(HISTORICAL_CASE_03.historicalQuality.claimProvenance).not.toHaveProperty(`/input/entities/${index + 2}/profile/location`);
    }
  });

  it("has complete provenance and recursively frozen text", () => {
    expect(() => validateHistoricalQualityCase(HISTORICAL_CASE_03, { requireApprovedReview: false })).not.toThrow();
    expectDeeplyFrozen(HISTORICAL_CASE_03);
  });
});
