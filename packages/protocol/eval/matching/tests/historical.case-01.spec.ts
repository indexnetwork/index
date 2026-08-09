import { describe, expect, it } from "bun:test";

import { historicalModelSafeProjection, validateHistoricalQualityCase } from "../../discovery-env-matrix/historical-quality.corpus.js";
import { MATCHING_MIN_SCORE } from "../matching.constants.js";
import { HISTORICAL_CASE_01 } from "../historical/historical.case-01.js";

const source = {
  bio: "Engineering-management graduate who had run a family manufacturing business and was participating with his spouse in their joint search for European home-goods design.",
  location: "",
  interests: ["European design in a joint home-goods search", "United States home-goods market in a joint design search"],
  skills: ["engineering management", "manufacturing operations"],
  intent: "Participate with a spouse in their joint search for European design for the United States home-goods market.",
};

const partner = {
  bio: "Product designer and son of a sculptor who had apprenticed with his father.",
  location: "",
  interests: ["product design"],
  skills: ["product design", "apprenticeship with a sculptor father"],
  intent: "Product-design work on a functional household object and apprenticeship with a sculptor father.",
};

const syntheticProfiles = [
  {
    bio: "Housewares retail buyer who curates contemporary product assortments for national stores.",
    location: "",
    interests: ["modern housewares", "consumer preferences"],
    skills: ["supplier sourcing", "retail merchandising"],
    intent: "Source a distinctive European-designed household collection for a national retail assortment.",
  },
  {
    bio: "Multidisciplinary visual designer who develops packaging systems and brand identities for household-product companies.",
    location: "",
    interests: ["packaging design", "visual identity"],
    skills: ["graphic design", "print production"],
    intent: "Develop a visual identity and packaging system for a new household-products collection.",
  },
  {
    bio: "Site-specific sculptor who develops commissioned installations for public plazas and civic buildings.",
    location: "",
    interests: ["public art", "architectural space"],
    skills: ["large-scale fabrication", "site planning"],
    intent: "Develop a permanent sculptural installation for a civic courtyard.",
  },
];

const expectedCitations = [
  {
    id: "new-yorker-dansk-history",
    url: "https://www.newyorker.com/culture/cultural-comment/dansk-and-the-promise-of-a-simple-scandinavian-life",
    title: "Dansk and the Promise of a Simple Scandinavian Life",
    publisher: "The New Yorker",
    excerpt: "In 1954, the Nierenbergs—Ted, an American entrepreneur; Martha, a biochemist and Hungarian Jewish refugee—were on a delayed honeymoon in Europe, seeking European design that might appeal to the burgeoning U.S. market for home goods. … They called him right from the center … the Nierenbergs showed up on his doorstep. ‘And that was the start of Dansk Designs. That afternoon,’ he told Guldberg. … He was the son of a sculptor, and he had dropped out of school and apprenticed with his father.",
  },
  {
    id: "latimes-nierenberg-obituary",
    url: "https://www.latimes.com/local/obituaries/la-me-theodore-nierenberg5-2009aug05-story.html",
    title: "Theodore D. Nierenberg dies at 86; founder of Dansk",
    publisher: "Los Angeles Times",
    excerpt: "Trained as an engineer, Nierenberg was visiting a Copenhagen museum in 1954 when he spotted hand-forged stainless steel flatware with teak handles, then an unusual combination. He tracked down its Danish designer, Jens Quistgaard, on a farm and convinced him it could be mass-produced. … In 1944, he earned a bachelor’s in engineering management from what is now Carnegie Mellon University. With a brother, he ran the family’s metal-fabrication business but started traveling the world, looking to do something ‘he could be proud of and enjoy.’",
  },
  {
    id: "moma-quistgaard-1953",
    url: "https://www.moma.org/collection/works/1190",
    title: "Jens H. Quistgaard. Fjord Flatware. 1953",
    publisher: "The Museum of Modern Art",
    excerpt: "Jens H. Quistgaard. Fjord Flatware. 1953.",
  },
  {
    id: "cooper-hewitt-quistgaard",
    url: "https://collection.cooperhewitt.org/people/18044007/",
    title: "Jens H. Quistgaard",
    publisher: "Smithsonian Institution",
    excerpt: "We have 40 objects that Jens H. Quistgaard has been involved with. … Jens H. Quistgaard has related object(s) with Dansk International Designs, Ltd.",
  },
];

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBeTrue();
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
}

describe("historical case 01", () => {
  it("keeps stable IDs while repairing the Ted Nierenberg to Jens Quistgaard direction", () => {
    expect(HISTORICAL_CASE_01.id).toBe("historical/builder-and-operator");
    expect(HISTORICAL_CASE_01.input.discovererId).toBe("h1-a");
    expect(HISTORICAL_CASE_01.input.entities.map(({ userId }) => userId)).toEqual(["h1-a", "h1-b", "h1-c", "h1-d", "h1-e"]);
    expect(HISTORICAL_CASE_01.reportNames).toEqual({
      "h1-a": "Ted Nierenberg",
      "h1-b": "Jens Quistgaard",
    });
    expect(HISTORICAL_CASE_01.expect).toEqual([
      { candidateId: "h1-b", match: true, scoreBand: [60, 100] },
      { candidateId: "h1-c", match: false, scoreBand: [0, 29] },
      { candidateId: "h1-d", match: false, scoreBand: [0, 29] },
      { candidateId: "h1-e", match: false, scoreBand: [0, 29] },
    ]);
  });

  it("keeps every negative score band feasible under the matching scorer contract", () => {
    const effectiveAbsentScore = 0;
    const negativeExpectations = HISTORICAL_CASE_01.expect.filter(({ match }) => !match);
    expect(negativeExpectations.map(({ candidateId }) => candidateId)).toEqual(["h1-c", "h1-d", "h1-e"]);
    for (const expectation of negativeExpectations) {
      expect(expectation.scoreBand).toBeDefined();
      const [minimum, maximum] = expectation.scoreBand!;
      expect(maximum).toBeLessThan(MATCHING_MIN_SCORE);
      expect(minimum).toBeLessThanOrEqual(effectiveAbsentScore);
      expect(maximum).toBeGreaterThanOrEqual(effectiveAbsentScore);
    }
  });

  it("pins the repaired historical profiles and event-relative cutoff", () => {
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
      "An engineering-management graduate participating in a joint search for European home-goods design is paired with a product designer who apprenticed with a sculptor father.",
    );
    expect(HISTORICAL_CASE_01.historicalQuality.cutoff).toEqual({
      event: {
        id: "h1-nierenberg-quistgaard-first-contact",
        description: "Immediately before Ted and Martha Nierenberg telephoned Jens Quistgaard during their 1954 European design-sourcing trip.",
      },
      calendarProxy: { date: "1954", precision: "year" },
      confidence: "medium",
      uncertaintyRationale: "Independent accounts agree on first contact and company formation in 1954 but differ on the discovery location and do not establish an exact day.",
      exclusive: true,
      orderingCitationIds: ["new-yorker-dansk-history", "latimes-nierenberg-obituary"],
    });
    expect(HISTORICAL_CASE_01.historicalQuality.citations).toEqual(expectedCitations);
    expect(HISTORICAL_CASE_01.historicalQuality.claims).toContainEqual({
      kind: "historical",
      id: "fact-quistgaard-craft",
      text: "Before the documented telephone contact, Jens Quistgaard was a sculptor's son, had apprenticed with his father, worked as a product designer, and had designed a functional household object.",
      citationIds: ["new-yorker-dansk-history", "latimes-nierenberg-obituary"],
      preConnection: true,
    });
    expect(HISTORICAL_CASE_01.historicalQuality.claimProvenance["/input/entities/1/intents/0/payload"]).toEqual(["model-partner-intent"]);
    expect(HISTORICAL_CASE_01.historicalQuality.outcomeCitationIds).toEqual(["cooper-hewitt-quistgaard"]);
  });

  it("keeps every model-facing field cited and blocks identifying combination leakage", () => {
    expect(() => validateHistoricalQualityCase(HISTORICAL_CASE_01, { requireApprovedReview: false })).not.toThrow();
    const modelText = JSON.stringify(historicalModelSafeProjection(HISTORICAL_CASE_01));
    expect(modelText).not.toMatch(/nierenberg|quistgaard|martha|dansk|fjord|denmark|danish|copenhagen|long island|great neck|flatware|teak|stainless steel|honeymoon|museum|doorstep|farm|garage|fashion award|food52|metal[- ]fabrication|scaled|reliable industrial production|commercialization|hand-forged|mixed[- ]material|prototype/i);
    expect(HISTORICAL_CASE_01.historicalQuality.claimProvenance).not.toHaveProperty("/input/entities/0/profile/location");
    expect(HISTORICAL_CASE_01.historicalQuality.claimProvenance).not.toHaveProperty("/input/entities/1/profile/location");
  });

  it("uses exact semantic negatives whose authored profiles encode each failure", () => {
    expect(HISTORICAL_CASE_01.historicalQuality.semanticNegatives).toEqual({
      "h1-c": "National retail assortment curation and supplier sourcing represent buyer-side merchandising activity.",
      "h1-d": "Packaging and brand identity represent visual-communications design for household-product companies.",
      "h1-e": "Commissioned public architectural sculpture represents a site-specific civic-art application domain.",
    });
    const negatives = historicalModelSafeProjection(HISTORICAL_CASE_01).input.entities.slice(2);
    expect(negatives.map(({ profile, intents }) => ({
      bio: profile.bio,
      location: profile.location,
      interests: profile.interests,
      skills: profile.skills,
      intent: intents?.[0]?.payload,
    }))).toEqual(syntheticProfiles);
    expect(JSON.stringify(negatives)).not.toMatch(/unable|without|rather than|\blacks?\b|cannot|can't|does not|do not|\bno\b|instead of|excluding|failure|wrong fit|functional ceramics?|table objects?/i);
    expect(HISTORICAL_CASE_01.input.entities.slice(1).map(({ ragScore }) => ragScore)).toEqual([70, 70, 70, 70]);
    for (const participantId of ["h1-c", "h1-d", "h1-e"] as const) {
      const reason = HISTORICAL_CASE_01.historicalQuality.semanticNegatives[participantId];
      const authored = HISTORICAL_CASE_01.historicalQuality.claims.filter((claim) => claim.kind === "authored" && claim.participantId === participantId);
      expect(authored.length).toBeGreaterThan(0);
      expect(authored.every((claim) => claim.kind === "authored" && claim.violatedRequirement === reason)).toBeTrue();
    }
  });

  it("records independent approval while preserving explicit authoring-mode mutations", () => {
    expect(HISTORICAL_CASE_01.historicalQuality.anonymizationReview).toEqual({
      reviewer: "ind637.source-auditor:56c4419b",
      reviewedAt: "2026-08-07",
      recognizability: "medium",
      decision: "approved",
      rationale:
        "The reviewer approved H1 at checkpoint 6c20448cc20387953c0bf22b7d17f3249d47e391 after verifying source metadata, Ted→Jens and joint-spouse attribution, pre-telephone chronology, exact provenance, neutral feasible negatives, outcome isolation, all four serialization boundaries, and medium combination recognizability.",
    });
    expect(() => validateHistoricalQualityCase(HISTORICAL_CASE_01)).not.toThrow();

    for (const decision of ["pending", "revise"] as const) {
      const mutation = structuredClone(HISTORICAL_CASE_01);
      mutation.historicalQuality.anonymizationReview.decision = decision;
      expect(() => validateHistoricalQualityCase(mutation)).toThrow(/anonymization review must be approved/);
      expect(() => validateHistoricalQualityCase(mutation, { requireApprovedReview: false })).not.toThrow();
    }
    expectDeeplyFrozen(HISTORICAL_CASE_01);
  });
});
