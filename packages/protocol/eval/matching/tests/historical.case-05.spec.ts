import { describe, expect, it } from "bun:test";

import { historicalModelSafeProjection, validateHistoricalQualityCase } from "../../discovery-env-matrix/historical-quality.corpus.js";
import { HISTORICAL_CASE_05 } from "../historical/historical.case-05.js";

const source = {
  bio: "Physician-scientist trained in immune and microbial research who studied antigen-presenting cells in viral disease and investigated ways to load those cells with antigen for vaccine research.",
  location: "U.S. East Coast",
  interests: ["antigen-presenting cells", "infectious disease", "vaccine research"],
  skills: ["clinical medicine", "immunology", "microbiology", "cellular immune methods"],
  intent: "Find a molecular researcher who can prepare an antigen-encoding RNA payload for evaluation in antigen-presenting cells.",
};

const partner = {
  bio: "Biochemist experienced in producing laboratory-made nucleic acids encoding therapeutic proteins and testing their expression in cells.",
  location: "U.S. East Coast",
  interests: ["nucleic-acid biology", "therapeutic protein research", "experimental methods"],
  skills: ["biochemistry", "nucleic-acid production", "laboratory transcription", "cell-based expression studies"],
  intent: "Develop laboratory-produced nucleic acids for therapeutic protein expression in cell-based experiments.",
};

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBeTrue();
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
}

describe("historical case 05", () => {
  it("keeps stable IDs while repairing the Drew Weissman to Katalin Karikó direction", () => {
    expect(HISTORICAL_CASE_05.id).toBe("historical/domain-expert-and-ml");
    expect(HISTORICAL_CASE_05.input.discovererId).toBe("h5-a");
    expect(HISTORICAL_CASE_05.input.entities.map(({ userId }) => userId)).toEqual(["h5-a", "h5-b", "h5-c", "h5-d", "h5-e"]);
    expect(HISTORICAL_CASE_05.reportNames).toEqual({
      "h5-a": "Drew Weissman",
      "h5-b": "Katalin Karikó",
    });
    expect(HISTORICAL_CASE_05.expect).toEqual([
      { candidateId: "h5-b", match: true, scoreBand: [60, 100] },
      { candidateId: "h5-c", match: false, scoreBand: [0, 29] },
      { candidateId: "h5-d", match: false, scoreBand: [0, 29] },
      { candidateId: "h5-e", match: false, scoreBand: [0, 29] },
    ]);
  });

  it("pins Weissman's source triggers, Karikó's partner capability, and the event-relative cutoff", () => {
    const [sourceEntity, partnerEntity] = HISTORICAL_CASE_05.input.entities;
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
    expect(HISTORICAL_CASE_05.description).toBe(
      "A vaccine-focused immunologist who needs an antigen-encoding RNA payload is paired with a biochemist experienced in producing therapeutic-protein nucleic acids.",
    );
    expect(HISTORICAL_CASE_05.historicalQuality.triggerInputs).toEqual({
      intent: { text: source.intent },
      enrichment: { premises: [source.bio, source.intent], userContext: source.bio },
    });
    expect(HISTORICAL_CASE_05.historicalQuality.cutoff).toEqual({
      event: {
        id: "h5-weissman-kariko-first-substantive-conversation",
        description: "Immediately before Drew Weissman and Katalin Karikó's first substantive conversation and joint work.",
      },
      calendarProxy: { date: "1997", precision: "year" },
      confidence: "medium",
      uncertaintyRationale: "First-person and institutional accounts place the encounter around 1997, one secondary account uses 1998, and no exact date is established.",
      exclusive: true,
      orderingCitationIds: ["cell-persistent-progress", "nobel-kariko-banquet-speech"],
    });
  });

  it("records the exact pre-connection RNA need without using later joint facts in model provenance", () => {
    const citations = new Map(HISTORICAL_CASE_05.historicalQuality.citations.map((citation) => [citation.id, citation]));
    expect(citations.get("cell-persistent-progress")?.url).toBe("https://pmc.ncbi.nlm.nih.gov/articles/PMC8462135/");
    expect(citations.get("cell-persistent-progress")?.excerpt).toBe(
      "I did my fellowship at NIH in Tony Fauci’s lab. While I was there, I started a new research program studying dendritic cells and their role in HIV pathogenesis. … So when I came to Penn … the first thing I wanted to do was vaccine research. I started to investigate ways of loading dendritic cells with antigen … I didn’t have access to RNA, and I didn’t know how to make it, so I looked at everything else. And that’s when I met Kati … Katalin Karikó: I started at the University of Pennsylvania in ‘89 and started to get interested in making mRNA coding for therapeutic protein.",
    );
    expect(HISTORICAL_CASE_05.historicalQuality.outcomeCitationIds).toEqual(["pnas-kariko-weissman-profile"]);

    const claims = new Map(HISTORICAL_CASE_05.historicalQuality.claims.map((claim) => [claim.id, claim]));
    const modelCitationIds = new Set<string>();
    const collectCitations = (claimId: string): void => {
      const claim = claims.get(claimId)!;
      if (claim.kind === "historical") {
        for (const citationId of claim.citationIds) modelCitationIds.add(citationId);
      } else if (claim.kind === "derived") {
        for (const basisClaimId of claim.basisClaimIds) collectCitations(basisClaimId);
      }
    };
    for (const claimIds of Object.values(HISTORICAL_CASE_05.historicalQuality.claimProvenance)) {
      for (const claimId of claimIds) collectCitations(claimId);
    }
    expect(modelCitationIds.has("nobel-kariko-banquet-speech")).toBeFalse();
    expect(modelCitationIds.has("pnas-kariko-weissman-profile")).toBeFalse();

    const modelText = JSON.stringify(historicalModelSafeProjection(HISTORICAL_CASE_05));
    expect(modelText).not.toMatch(/karik[oó]|weissman|katalin|drew|inflammator|modified nucleoside|pseudouridine|toll-like|covid|pandemic|biontech|moderna|nobel|prize|award|company|companies|joint work|worked together/i);
  });

  it("uses exact negatives encoding same-side, method, and domain failures", () => {
    expect(HISTORICAL_CASE_05.historicalQuality.semanticNegatives).toEqual({
      "h5-c": "Same-side vaccine immunologist also lacks the required RNA preparation capability.",
      "h5-d": "Computational RNA analyst lacks wet-lab nucleic-acid production and cell-expression capability.",
      "h5-e": "Plant RNA researcher works in the wrong biological domain for human antigen-delivery research.",
    });
    const negatives = historicalModelSafeProjection(HISTORICAL_CASE_05).input.entities.slice(2);
    expect(negatives[0]?.profile.bio).toContain("Vaccine immunologist");
    expect(negatives[1]?.profile.bio).toContain("Computational RNA analyst");
    expect(negatives[2]?.profile.bio).toContain("Plant RNA researcher");
    for (const participantId of ["h5-c", "h5-d", "h5-e"] as const) {
      const reason = HISTORICAL_CASE_05.historicalQuality.semanticNegatives[participantId];
      const authored = HISTORICAL_CASE_05.historicalQuality.claims.filter((claim) => claim.kind === "authored" && claim.participantId === participantId);
      expect(authored.length).toBeGreaterThan(0);
      expect(authored.every((claim) => claim.kind === "authored" && claim.violatedRequirement === reason)).toBeTrue();
    }
  });

  it("is review-pending and strict validation fails only on that decision", () => {
    expect(HISTORICAL_CASE_05.historicalQuality.anonymizationReview).toEqual({
      reviewer: "independent-review-pending",
      reviewedAt: "2026-08-06",
      recognizability: "medium",
      decision: "pending",
      rationale: "Pending independent verification of the reversed seeker direction, event-relative ordering, field-level provenance, semantic negatives, and exact serialized boundaries.",
    });
    expect(() => validateHistoricalQualityCase(HISTORICAL_CASE_05, { requireApprovedReview: false })).not.toThrow();
    expect(() => validateHistoricalQualityCase(HISTORICAL_CASE_05)).toThrow(/anonymization review must be approved/);
    const approved = structuredClone(HISTORICAL_CASE_05);
    approved.historicalQuality.anonymizationReview.decision = "approved";
    expect(() => validateHistoricalQualityCase(approved)).not.toThrow();
    expectDeeplyFrozen(HISTORICAL_CASE_05);
  });
});
