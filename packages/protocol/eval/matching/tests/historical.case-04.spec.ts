import { describe, expect, it } from "bun:test";

import { historicalModelSafeProjection, validateHistoricalQualityCase } from "../../discovery-env-matrix/historical-quality.corpus.js";
import { HISTORICAL_CASE_04 } from "../historical/historical.case-04.js";

const participantIds = ["h4-a", "h4-b", "h4-c", "h4-d", "h4-e"] as const;

const source = {
  bio: "Graduate researcher developing a working large-scale information-retrieval prototype with another researcher as the team considered a company transition.",
  location: "Northern California",
  interests: ["information retrieval", "scalable systems", "system quality"],
  skills: ["ranking methods", "systems design", "data collection and indexing"],
  intent: "Find a technically fluent outside evaluator willing to assess a working information-retrieval prototype during a possible company transition.",
};

const partner = {
  bio: "Computer-systems engineer and repeat technical-company founder with experience building and commercializing computing and networking systems. A technical contact has invited him to evaluate a graduate team’s working information-retrieval demonstration.",
  location: "Northern California",
  interests: ["computer systems", "technical systems", "technical ventures"],
  skills: ["systems design", "computer engineering", "technical company building"],
  intent: "Evaluate an interesting technical demonstration introduced through a technical contact.",
};

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBeTrue();
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
}

describe("historical case 04", () => {
  it("keeps one historical source identity and the stable participant contract", () => {
    expect(HISTORICAL_CASE_04.id).toBe("historical/first-check-investor");
    expect(HISTORICAL_CASE_04.rule).toBe("historical");
    expect(HISTORICAL_CASE_04.tier).toBe(3);
    expect(HISTORICAL_CASE_04.input.discovererId).toBe("h4-a");
    expect(HISTORICAL_CASE_04.input.entities.map(({ userId }) => userId)).toEqual([...participantIds]);
    expect(HISTORICAL_CASE_04.expect.map(({ candidateId, match }) => ({ candidateId, match }))).toEqual([
      { candidateId: "h4-b", match: true },
      { candidateId: "h4-c", match: false },
      { candidateId: "h4-d", match: false },
      { candidateId: "h4-e", match: false },
    ]);
    expect(HISTORICAL_CASE_04.reportNames).toEqual({
      "h4-a": "Larry Page",
      "h4-b": "Andy Bechtolsheim",
    });
    expect(HISTORICAL_CASE_04.historicalQuality.participantKinds).toEqual({
      "h4-a": "historical",
      "h4-b": "historical",
      "h4-c": "synthetic",
      "h4-d": "synthetic",
      "h4-e": "synthetic",
    });
  });

  it("uses the approved profiles and exclusive August 1998 cutoff", () => {
    expect(HISTORICAL_CASE_04.historicalQuality.cutoff).toEqual({
      date: "1998-08",
      precision: "month",
      exclusive: true,
      orderingCitationIds: ["stanford-otl-uniquely-google", "stanford-engineering-hero-talk"],
    });

    const [sourceEntity, partnerEntity] = HISTORICAL_CASE_04.input.entities;
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

    const citations = new Map(HISTORICAL_CASE_04.historicalQuality.citations.map((citation) => [citation.id, citation]));
    expect(citations.get("stanford-search-paper")).toMatchObject({
      url: "http://infolab.stanford.edu/~backrub/google.html",
      title: "The Anatomy of a Large-Scale Hypertextual Web Search Engine",
      publisher: "Stanford University",
    });
    expect(citations.get("stanford-search-paper")?.excerpt).toContain("working prototype");
    expect(citations.get("stanford-search-paper")?.excerpt).toContain("full text and hyperlinks");
    expect(citations.get("stanford-search-paper")?.excerpt).toContain("improved search quality");
    expect(citations.get("nsf-origins-context")?.url).toBe("https://www.nsf.gov/news/origins-google");
    expect(citations.get("nsf-origins-context")?.excerpt).toContain("another graduate researcher joined him");
    expect(citations.get("stanford-otl-uniquely-google")?.url).toBe("http://infolab.stanford.edu/pub/voy/museum/google.htm");
    expect(citations.get("stanford-otl-uniquely-google")?.excerpt).toContain("decided to form a company");
    expect(citations.get("stanford-otl-uniquely-google")?.excerpt).toContain("After the demonstration and discussion");
    expect(citations.get("stanford-otl-uniquely-google")?.excerpt).toContain("wrote a check");
    expect(citations.get("stanford-otl-uniquely-google")?.excerpt).toContain("incorporated afterward");
    expect(citations.get("stanford-engineering-hero-talk")?.url).toBe(
      "https://engineering.stanford.edu/news/andy-bechtolsheim-hero-talks-innovation-success-and-engineering",
    );
    expect(citations.get("stanford-engineering-hero-talk")?.excerpt).toBe(
      "In 1998, Stanford professor David Cheriton invited Bechtolsheim to meet two students who had an interesting product to demonstrate; the account places the check after the demonstration.",
    );
    expect(citations.get("stanford-engineering-bechtolsheim")?.url).toBe(
      "https://engineering.stanford.edu/about/history/heroes/2012-heroes/andreas-bechtolsheim",
    );
    expect(citations.get("stanford-engineering-bechtolsheim")?.excerpt).toContain(
      "Andreas ‘Andy’ Bechtolsheim built the path-breaking SUN workstation while working as a doctoral student at Stanford in computer science and electrical engineering. He later became co-founder and chief system architect at Sun Microsystems.",
    );
    expect(citations.get("stanford-engineering-bechtolsheim")?.excerpt).toContain(
      "He also was CEO and a founder of Granite Systems, a gigabit Ethernet switching company, from 1995 to 1996, when it was acquired by Cisco Systems.",
    );
    expect(HISTORICAL_CASE_04.historicalQuality.outcomeCitationIds).toEqual(["nsf-origins-outcome"]);
  });

  it("grounds every repeat-founding abstraction in both pre-1998 founding facts", () => {
    const claims = new Map(HISTORICAL_CASE_04.historicalQuality.claims.map((claim) => [claim.id, claim]));
    for (const claimId of ["model-partner-bio", "model-partner-ventures", "model-partner-company-building"]) {
      const claim = claims.get(claimId)!;
      expect(claim.kind).toBe("derived");
      if (claim.kind !== "derived") throw new Error(`${claimId} must be derived`);
      expect(claim.basisClaimIds).toContain("fact-partner-systems-background");
      expect(claim.basisClaimIds).toContain("fact-partner-networking-ventures");
      expect(claim.rationale).toMatch(/both separate documented pre-1998 founding roles/i);
    }
  });

  it("keeps the collaborator unnamed, separate, and citation-derived", () => {
    const claims = new Map(HISTORICAL_CASE_04.historicalQuality.claims.map((claim) => [claim.id, claim]));
    const sourceBioClaims = HISTORICAL_CASE_04.historicalQuality.claimProvenance["/input/entities/0/profile/bio"]!;
    const collaboratorClaim = claims.get("fact-page-link-ranking-collaboration")!;
    const dependsOnClaim = (claimId: string, requiredClaimId: string): boolean => {
      if (claimId === requiredClaimId) return true;
      const claim = claims.get(claimId)!;
      return claim.kind === "derived" && claim.basisClaimIds.some((basisClaimId) => dependsOnClaim(basisClaimId, requiredClaimId));
    };
    expect(collaboratorClaim).toMatchObject({ kind: "historical", citationIds: ["nsf-origins-context"] });
    expect(collaboratorClaim.text).toContain("another graduate researcher");
    expect(sourceBioClaims).toContain("model-source-bio");
    expect(sourceBioClaims.some((claimId) => dependsOnClaim(claimId, "fact-page-link-ranking-collaboration"))).toBeTrue();
    expect(JSON.stringify(HISTORICAL_CASE_04.historicalQuality.claims)).not.toMatch(/sergey|brin|page\s*(?:\/|and|&|,)\s*brin/i);
  });

  it("records independent approval while preserving explicit authoring-mode mutations", () => {
    expect(HISTORICAL_CASE_04.historicalQuality.anonymizationReview).toEqual({
      reviewer: "pi-reviewer:ba43fe8c",
      reviewedAt: "2026-08-06",
      recognizability: "medium",
      decision: "approved",
      rationale:
        "The reviewer approved the evaluator-focused prototype and repeat-founder abstractions after confirming corrected citations, pre-demonstration provenance, authored negatives, outcome isolation, and safe module-level projections; matrix integration remains pending Task 8.",
    });
    expect(() => validateHistoricalQualityCase(HISTORICAL_CASE_04)).not.toThrow();

    for (const decision of ["pending", "revise"] as const) {
      const mutation = structuredClone(HISTORICAL_CASE_04);
      mutation.historicalQuality.anonymizationReview.decision = decision;
      expect(() => validateHistoricalQualityCase(mutation)).toThrow(/anonymization review must be approved/);
      expect(() => validateHistoricalQualityCase(mutation, { requireApprovedReview: false })).not.toThrow();
    }
  });

  it("excludes composite identity, unsupported support patterns, and exact identifying transaction details from model text", () => {
    const modelText = JSON.stringify(historicalModelSafeProjection(HISTORICAL_CASE_04));
    const forbidden = /larry|\bpage\b|sergey|brin|andy|bechtolsheim|google|backrub|pagerank|stanford|sun microsystems|\$100,?000|check|cheque|first believer|no business network|no money|before anyone else|first-check|writes? first|roll(?:ing|s)? up (?:his |their )?sleeves|hands-on coach|founder coaching|recurring prototype|habitual/i;
    const postDemonstrationForbidden = /incorporat(?:e|ed|ion)|funding decision|investment decision|post[- ]demonstration|after (?:the )?demonstration|after (?:he|they) saw|decided to (?:fund|invest)|immediate(?:ly)? (?:fund|invest|decision)|funding enabled|(?:funding|investment) sequence|relocat(?:e|ed|ion)|deposit(?:ed)?|payee|\$100\s*k|\b100,?000\b/i;
    expect(modelText).not.toMatch(forbidden);
    expect(modelText).not.toMatch(postDemonstrationForbidden);
    const historicalProfiles = JSON.stringify(HISTORICAL_CASE_04.input.entities.slice(0, 2));
    expect(historicalProfiles).not.toMatch(/trusted|outside backer|consider funding|millions of pages|web.{0,20}link|workstation|high-speed|gigabit|acquired/i);
  });

  it("authors three distinct negatives for capital direction, stage, and technical relevance", () => {
    const negativeIds = participantIds.slice(2);
    const negatives = HISTORICAL_CASE_04.historicalQuality.semanticNegatives;
    expect(Object.keys(negatives)).toEqual(negativeIds);
    expect(new Set(Object.values(negatives)).size).toBe(3);
    expect(negatives).toEqual({
      "h4-c": "Same-side technical founder is seeking capital rather than able to provide it.",
      "h4-d": "Later-stage capital provider does not evaluate or fund working prototypes at this transition stage.",
      "h4-e": "Early capital provider lacks the computer-systems background needed for technically fluent evaluation of this prototype.",
    });
    for (const participantId of negativeIds) {
      const participantClaims = HISTORICAL_CASE_04.historicalQuality.claims.filter(
        (claim) => claim.kind === "authored" && claim.participantId === participantId,
      );
      expect(participantClaims.length).toBeGreaterThan(0);
      expect(participantClaims.every((claim) => claim.kind === "authored" && claim.violatedRequirement === negatives[participantId])).toBeTrue();
    }
  });

  it("has complete field provenance and recursively frozen content", () => {
    expect(() => validateHistoricalQualityCase(HISTORICAL_CASE_04, { requireApprovedReview: false })).not.toThrow();
    expectDeeplyFrozen(HISTORICAL_CASE_04);
  });
});
