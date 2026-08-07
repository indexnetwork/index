import { describe, expect, it } from "bun:test";

import { historicalModelSafeProjection, validateHistoricalQualityCase } from "../../discovery-env-matrix/historical-quality.corpus.js";
import { HISTORICAL_CASE_01 } from "../historical/historical.case-01.js";

const source = {
  bio: "Engineering-trained manufacturer with metal-fabrication experience seeking modern household products suitable for scaled production and a broad consumer market.",
  location: "North America",
  interests: ["modern household products", "industrial production", "consumer design"],
  skills: ["engineering management", "metal fabrication", "product commercialization"],
  intent: "Find original household-product designs that can be adapted for reliable industrial production and a broad consumer market.",
};

const partner = {
  bio: "European sculptor and product designer trained in metal craft who had created a hand-forged functional household prototype before first contact.",
  location: "Europe",
  interests: ["functional household objects", "sculptural product design", "material experimentation"],
  skills: ["product design", "metal craft", "prototype making", "material combination"],
  intent: "Develop functional household objects that combine sculptural form, traditional craft, and practical daily use.",
};

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
    publisher: "Cooper Hewitt, Smithsonian Design Museum",
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
      "An engineering-trained manufacturer seeking modern household products is paired with a sculptor-product designer whose existing prototype and craft expertise can anchor scaled production.",
    );
    expect(HISTORICAL_CASE_01.historicalQuality.cutoff).toEqual({
      event: {
        id: "h1-nierenberg-quistgaard-first-contact",
        description: "Immediately before Ted and Martha Nierenberg first contacted and met Jens Quistgaard during their 1954 European design-sourcing trip.",
      },
      calendarProxy: { date: "1954", precision: "year" },
      confidence: "medium",
      uncertaintyRationale: "Independent accounts agree on first contact and company formation in 1954 but differ on the discovery location and do not establish an exact day.",
      exclusive: true,
      orderingCitationIds: ["new-yorker-dansk-history", "latimes-nierenberg-obituary"],
    });
    expect(HISTORICAL_CASE_01.historicalQuality.citations).toEqual(expectedCitations);
    expect(HISTORICAL_CASE_01.historicalQuality.outcomeCitationIds).toEqual(["cooper-hewitt-quistgaard"]);
  });

  it("keeps every model-facing field cited and blocks identifying combination leakage", () => {
    expect(() => validateHistoricalQualityCase(HISTORICAL_CASE_01, { requireApprovedReview: false })).not.toThrow();
    const modelText = JSON.stringify(historicalModelSafeProjection(HISTORICAL_CASE_01));
    expect(modelText).not.toMatch(/nierenberg|quistgaard|martha|dansk|fjord|denmark|danish|copenhagen|long island|great neck|flatware|teak|stainless steel|honeymoon|museum|doorstep|farm|garage|fashion award|food52/i);
  });

  it("uses exact semantic negatives whose authored profiles encode each failure", () => {
    expect(HISTORICAL_CASE_01.historicalQuality.semanticNegatives).toEqual({
      "h1-c": "Same-side retail and market operator lacks original product-design capability.",
      "h1-d": "Print and graphic designer lacks three-dimensional household-product and material-prototype capability.",
      "h1-e": "One-off sculptural craft practitioner lacks functional-product and repeatable-production orientation.",
    });
    const negatives = historicalModelSafeProjection(HISTORICAL_CASE_01).input.entities.slice(2);
    expect(negatives[0]?.profile.bio).toContain("Retail assortment manager");
    expect(negatives[1]?.profile.bio).toContain("Print and graphic designer");
    expect(negatives[2]?.profile.bio).toContain("one-off decorative objects");
    for (const participantId of ["h1-c", "h1-d", "h1-e"] as const) {
      const reason = HISTORICAL_CASE_01.historicalQuality.semanticNegatives[participantId];
      const authored = HISTORICAL_CASE_01.historicalQuality.claims.filter((claim) => claim.kind === "authored" && claim.participantId === participantId);
      expect(authored.length).toBeGreaterThan(0);
      expect(authored.every((claim) => claim.kind === "authored" && claim.violatedRequirement === reason)).toBeTrue();
    }
  });

  it("is review-pending and strict validation fails only on that decision", () => {
    expect(HISTORICAL_CASE_01.historicalQuality.anonymizationReview).toEqual({
      reviewer: "independent-review-pending",
      reviewedAt: "2026-08-06",
      recognizability: "medium",
      decision: "pending",
      rationale: "Pending independent verification of first-contact chronology, field-level provenance, combination leakage, and exact matching, matrix, and seed serializations.",
    });
    expect(() => validateHistoricalQualityCase(HISTORICAL_CASE_01)).toThrow(/anonymization review must be approved/);
    const approved = structuredClone(HISTORICAL_CASE_01);
    approved.historicalQuality.anonymizationReview.decision = "approved";
    expect(() => validateHistoricalQualityCase(approved)).not.toThrow();
    expectDeeplyFrozen(HISTORICAL_CASE_01);
  });
});
