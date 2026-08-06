import { describe, expect, it } from "bun:test";

import { historicalModelSafeProjection, validateHistoricalQualityCase } from "../../discovery-env-matrix/historical-quality.corpus.js";
import { HISTORICAL_CASE_05 } from "../historical/historical.case-05.js";

const participantIds = ["h5-a", "h5-b", "h5-c", "h5-d", "h5-e"] as const;

const source = {
  bio: "Biochemist on the U.S. East Coast experienced in laboratory nucleic-acid production and cell-based protein-expression studies.",
  location: "U.S. East Coast",
  interests: ["nucleic-acid biology", "therapeutic protein research", "experimental methods"],
  skills: ["biochemistry", "nucleic-acid production", "laboratory transcription", "cell-based expression studies"],
  intent: "Develop laboratory-produced nucleic acids for therapeutic protein expression in cell-based experiments.",
};

const partner = {
  bio: "Physician-scientist on the U.S. East Coast trained in immune and microbial research, with experience studying host responses to viral disease.",
  location: "U.S. East Coast",
  interests: ["immune biology", "infectious disease", "vaccine research"],
  skills: ["clinical medicine", "immunology", "microbiology", "cellular immune methods"],
  intent: "Study immune responses in viral disease and investigate vaccine approaches.",
};

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBeTrue();
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
}

describe("historical case 05", () => {
  it("keeps the stable case contract and explicit participant kinds", () => {
    expect(HISTORICAL_CASE_05.id).toBe("historical/domain-expert-and-ml");
    expect(HISTORICAL_CASE_05.rule).toBe("historical");
    expect(HISTORICAL_CASE_05.tier).toBe(3);
    expect(HISTORICAL_CASE_05.input.discovererId).toBe("h5-a");
    expect(HISTORICAL_CASE_05.input.entities.map(({ userId }) => userId)).toEqual([...participantIds]);
    expect(HISTORICAL_CASE_05.expect.map(({ candidateId, match }) => ({ candidateId, match }))).toEqual([
      { candidateId: "h5-b", match: true },
      { candidateId: "h5-c", match: false },
      { candidateId: "h5-d", match: false },
      { candidateId: "h5-e", match: false },
    ]);
    expect(HISTORICAL_CASE_05.reportNames).toEqual({ "h5-a": "Katalin Karikó", "h5-b": "Drew Weissman" });
    expect(HISTORICAL_CASE_05.historicalQuality.participantKinds).toEqual({
      "h5-a": "historical",
      "h5-b": "historical",
      "h5-c": "synthetic",
      "h5-d": "synthetic",
      "h5-e": "synthetic",
    });
  });

  it("uses the exact source-centered profiles and conservative exclusive 1997 cutoff", () => {
    expect(HISTORICAL_CASE_05.historicalQuality.cutoff).toEqual({
      date: "1997",
      precision: "year",
      exclusive: true,
      orderingCitationIds: ["nobel-kariko-banquet-speech", "cell-persistent-progress"],
    });

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
      "A biochemist developing nucleic-acid methods is paired with a physician-scientist bringing complementary immune-system expertise.",
    );

    const citations = new Map(HISTORICAL_CASE_05.historicalQuality.citations.map((citation) => [citation.id, citation]));
    expect(citations.get("nobel-kariko-banquet-speech")).toMatchObject({
      url: "https://www.nobelprize.org/prizes/medicine/2023/kariko/speech/",
      title: "Katalin Karikó – Banquet speech",
      publisher: "Nobel Foundation",
    });
    expect(citations.get("nobel-kariko-banquet-speech")?.excerpt).toContain("we met at a xerox machine");
    expect(citations.get("nobel-kariko-banquet-speech")?.excerpt).toContain("in 1997");
    expect(citations.get("nobel-kariko-banquet-speech")?.excerpt).toContain("Drew and I started to work together");
    expect(citations.get("cell-persistent-progress")?.url).toBe("https://pmc.ncbi.nlm.nih.gov/articles/PMC8462135/");
    expect(citations.get("cell-persistent-progress")?.excerpt).toContain("I started at the University of Pennsylvania in ‘89");
    expect(citations.get("cell-persistent-progress")?.excerpt).not.toContain("didn’t have access to RNA");
    expect(citations.get("nobel-medicine-2023-press-release")).toMatchObject({
      url: "https://www.nobelprize.org/prizes/medicine/2023/press-release/",
      title: "Press release: The Nobel Prize in Physiology or Medicine 2023",
    });
    expect(citations.get("nobel-medicine-2023-advanced-information")?.url).toBe(
      "https://www.nobelprize.org/prizes/medicine/2023/advanced-information/",
    );
    expect(citations.get("pnas-kariko-weissman-profile")).toMatchObject({
      url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC10907315/",
      title: "Profile of Katalin Karikó and Drew Weissman: 2023 Nobel laureates in Physiology or Medicine",
    });
    expect(HISTORICAL_CASE_05.historicalQuality.outcomeCitationIds).toEqual(["pnas-kariko-weissman-profile"]);
  });

  it("keeps outcome evidence independent from all model-facing provenance", () => {
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
    expect(modelCitationIds.has("pnas-kariko-weissman-profile")).toBeFalse();
    expect([...modelCitationIds].sort()).toEqual([
      "cell-persistent-progress",
      "nobel-medicine-2023-advanced-information",
      "nobel-medicine-2023-press-release",
    ]);
  });

  it("excludes meeting, shared-institution, joint-work, and later-outcome leakage from model text", () => {
    const modelText = JSON.stringify(historicalModelSafeProjection(HISTORICAL_CASE_05));
    const forbidden = /karik[oó]|weissman|drew|katalin|xerox|copier|copy machine|photocop|university of pennsylvania|penn medicine|philadelphia|shared institution|met at|meeting|template exchange|exchang(?:e|ed|ing) templates?|joint experiments?|work(?:ed|ing)? together|collaboration began|immune reaction that blocks|modified nucleosides?|pseudouridine|nucleoside modification|later (?:finding|discovery)|covid|pandemic|vaccines? saved|millions of lives|biotech|company|companies|biontech|moderna|nobel|prize|award|messenger rna|dendritic|\bhiv\b|antigen delivery|molecular payload/i;
    expect(modelText).not.toMatch(forbidden);
  });

  it("authors three distinct role, method, and domain negatives", () => {
    const negativeIds = participantIds.slice(2);
    const negatives = HISTORICAL_CASE_05.historicalQuality.semanticNegatives;
    expect(Object.keys(negatives)).toEqual(negativeIds);
    expect(new Set(Object.values(negatives)).size).toBe(3);
    expect(negatives).toEqual({
      "h5-c": "Same-side nucleic-acid researcher lacks the complementary immune-system expertise.",
      "h5-d": "Population-level infectious-disease analyst lacks laboratory cellular-immunity methods.",
      "h5-e": "Plant immune-signaling researcher works in the wrong biological domain for human immune research.",
    });
    for (const participantId of negativeIds) {
      const participantClaims = HISTORICAL_CASE_05.historicalQuality.claims.filter(
        (claim) => claim.kind === "authored" && claim.participantId === participantId,
      );
      expect(participantClaims.length).toBeGreaterThan(0);
      expect(participantClaims.every((claim) => claim.kind === "authored" && claim.violatedRequirement === negatives[participantId])).toBeTrue();
    }
  });

  it("records independent approval while preserving explicit authoring-mode mutations and freezing", () => {
    expect(HISTORICAL_CASE_05.historicalQuality.anonymizationReview).toEqual({
      reviewer: "pi-reviewer:07908e5e",
      reviewedAt: "2026-08-06",
      recognizability: "medium",
      decision: "approved",
      rationale:
        "The reviewer approved the nucleic-acid-methods and immune-system complement after confirming verbatim citations, pre-1997 provenance, independent activity intents, authored negatives, outcome isolation, and removal of the uniquely identifying biomedical cluster from current projections.",
    });
    expect(() => validateHistoricalQualityCase(HISTORICAL_CASE_05)).not.toThrow();

    for (const decision of ["pending", "revise"] as const) {
      const mutation = structuredClone(HISTORICAL_CASE_05);
      mutation.historicalQuality.anonymizationReview.decision = decision;
      expect(() => validateHistoricalQualityCase(mutation)).toThrow(/anonymization review must be approved/);
      expect(() => validateHistoricalQualityCase(mutation, { requireApprovedReview: false })).not.toThrow();
    }
    expectDeeplyFrozen(HISTORICAL_CASE_05);
  });
});
