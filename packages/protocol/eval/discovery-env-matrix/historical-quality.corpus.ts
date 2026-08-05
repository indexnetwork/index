import type { MatchingCase } from "../matching/matching.types.js";

export type HistoricalDatePrecision = "day" | "month" | "year";
export type HistoricalRecognizability = "low" | "medium" | "high";

export interface HistoricalCitation {
  id: string;
  url: string;
  title: string;
  publisher: string;
  excerpt: string;
}

export interface HistoricalClaim {
  id: string;
  text: string;
  citationIds: string[];
  preConnection: true;
}

export interface HistoricalQualityMetadata {
  cutoff: {
    date: string;
    precision: HistoricalDatePrecision;
    exclusive: true;
    orderingCitationIds: string[];
  };
  citations: HistoricalCitation[];
  claims: HistoricalClaim[];
  outcomeCitationIds: string[];
  anonymizationReview: {
    reviewer: string;
    reviewedAt: string;
    recognizability: HistoricalRecognizability;
    decision: "approved" | "revise";
    rationale: string;
  };
  semanticNegatives: Record<string, string>;
  triggerInputs: {
    intent: { text: string };
    enrichment: { premises: string[]; userContext: string };
  };
}

export interface HistoricalQualityCase extends MatchingCase {
  historicalQuality: HistoricalQualityMetadata;
}

export interface HistoricalModelSafeProjection {
  id: string;
  input: MatchingCase["input"];
  triggerInputs: HistoricalQualityMetadata["triggerInputs"];
}

export function historicalModelSafeProjection(input: HistoricalQualityCase): HistoricalModelSafeProjection {
  return {
    id: input.id,
    input: structuredClone(input.input),
    triggerInputs: structuredClone(input.historicalQuality.triggerInputs),
  };
}

export function validateHistoricalQualityCase(input: HistoricalQualityCase): void {
  const fail = (message: string): never => { throw new Error(`${input.id}: ${message}`); };
  const nonblank = (value: string, field: string): void => {
    if (value.trim() === "") fail(`${field} must be non-empty`);
  };

  const ids = new Set(input.input.entities.map((entity) => entity.userId));
  if (!ids.has(input.input.discovererId)) fail("discoverer must reference an entity");
  const positives = input.expect.filter((expectation) => expectation.match);
  if (positives.length !== 1) fail("requires exactly one positive partner");

  const citations = new Map<string, HistoricalCitation>();
  for (const citation of input.historicalQuality.citations) {
    nonblank(citation.id, "citation id");
    if (citations.has(citation.id)) fail(`duplicate citation ${citation.id}`);
    let url!: URL;
    try { url = new URL(citation.url); } catch { fail(`citation ${citation.id} URL is invalid`); }
    if (url.protocol !== "https:" && url.protocol !== "http:") fail(`citation ${citation.id} URL must be HTTP(S)`);
    nonblank(citation.title, `citation ${citation.id} title`);
    nonblank(citation.publisher, `citation ${citation.id} publisher`);
    nonblank(citation.excerpt, `citation ${citation.id} excerpt`);
    citations.set(citation.id, citation);
  }
  const assertCitationIds = (values: readonly string[], field: string): void => {
    if (values.length === 0) fail(`${field} requires at least one citation`);
    for (const id of values) if (!citations.has(id)) fail(`${field} references unknown citation ${id}`);
  };

  if (input.historicalQuality.cutoff.exclusive !== true) fail("cutoff must be exclusive");
  const cutoffPatterns: Record<HistoricalDatePrecision, RegExp> = {
    day: /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/,
    month: /^\d{4}-(0[1-9]|1[0-2])$/,
    year: /^\d{4}$/,
  };
  if (!cutoffPatterns[input.historicalQuality.cutoff.precision].test(input.historicalQuality.cutoff.date)) {
    fail(`cutoff date does not match ${input.historicalQuality.cutoff.precision} precision`);
  }
  if (input.historicalQuality.cutoff.precision === "day") {
    const [year, month, day] = input.historicalQuality.cutoff.date.split("-").map(Number);
    const normalized = new Date(Date.UTC(year!, month! - 1, day!)).toISOString().slice(0, 10);
    if (normalized !== input.historicalQuality.cutoff.date) fail("cutoff day is not a valid calendar date");
  }
  if (input.historicalQuality.cutoff.precision === "year" && input.historicalQuality.cutoff.orderingCitationIds.length === 0) {
    fail("year precision requires ordering evidence");
  }
  assertCitationIds(input.historicalQuality.cutoff.orderingCitationIds, "cutoff ordering");
  assertCitationIds(input.historicalQuality.outcomeCitationIds, "outcome");
  const claimIds = new Set<string>();
  const preConnectionCitationIds = new Set(input.historicalQuality.cutoff.orderingCitationIds);
  for (const claim of input.historicalQuality.claims) {
    nonblank(claim.id, "claim id");
    if (claimIds.has(claim.id)) fail(`duplicate claim ${claim.id}`);
    claimIds.add(claim.id);
    nonblank(claim.text, `claim ${claim.id} text`);
    if (claim.preConnection !== true) fail(`claim ${claim.id} must attest preConnection`);
    assertCitationIds(claim.citationIds, `claim ${claim.id}`);
    for (const citationId of claim.citationIds) preConnectionCitationIds.add(citationId);
  }
  if (input.historicalQuality.outcomeCitationIds.every((citationId) => preConnectionCitationIds.has(citationId))) {
    fail("outcome requires an independent citation");
  }

  const review = input.historicalQuality.anonymizationReview;
  if (review.decision !== "approved") fail("anonymization review must be approved");
  nonblank(review.reviewer, "anonymization reviewer");
  nonblank(review.reviewedAt, "anonymization reviewedAt");
  nonblank(review.rationale, "anonymization rationale");

  const negativeEntries = Object.entries(input.historicalQuality.semanticNegatives);
  if (negativeEntries.length < 3) fail("requires at least three semantic negatives");
  const rejected = new Set(input.expect.filter((expectation) => !expectation.match).map((expectation) => expectation.candidateId));
  for (const [participantId, reason] of negativeEntries) {
    if (!ids.has(participantId)) fail(`semantic negative ${participantId} is not a participant`);
    if (!rejected.has(participantId)) fail(`semantic negative ${participantId} must reference a rejected candidate`);
    nonblank(reason, `semantic negative ${participantId} reason`);
  }

  nonblank(input.historicalQuality.triggerInputs.intent.text, "intent trigger text");
  if (input.historicalQuality.triggerInputs.enrichment.premises.length === 0) fail("enrichment requires at least one premise");
  for (const premise of input.historicalQuality.triggerInputs.enrichment.premises) nonblank(premise, "enrichment premise");
  nonblank(input.historicalQuality.triggerInputs.enrichment.userContext, "enrichment user context");

  const serializedProjection = JSON.stringify(historicalModelSafeProjection(input));
  for (const reportName of Object.values(input.reportNames ?? {})) {
    if (reportName.trim() !== "" && serializedProjection.includes(reportName)) {
      fail(`report name ${reportName} is present in model-safe projection`);
    }
  }
}
