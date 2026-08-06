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
  /** JSON-pointer field paths in the model-safe projection mapped to supporting claim IDs. */
  claimProvenance: Record<string, string[]>;
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

function escapeJsonPointerSegment(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function claimBearingProjectionFields(input: HistoricalQualityCase): Map<string, string> {
  const fields = new Map<string, string>();
  const add = (path: string, value: string | undefined): void => {
    if (value !== undefined && value.trim() !== "") fields.set(path, value);
  };

  for (const [entityIndex, entity] of input.input.entities.entries()) {
    const entityPath = `/input/entities/${entityIndex}`;
    add(`${entityPath}/profile/bio`, entity.profile.bio);
    add(`${entityPath}/profile/location`, entity.profile.location);
    for (const [interestIndex, interest] of (entity.profile.interests ?? []).entries()) {
      add(`${entityPath}/profile/interests/${interestIndex}`, interest);
    }
    for (const [skillIndex, skill] of (entity.profile.skills ?? []).entries()) {
      add(`${entityPath}/profile/skills/${skillIndex}`, skill);
    }
    add(`${entityPath}/profile/context`, entity.profile.context);
    for (const [intentIndex, intent] of (entity.intents ?? []).entries()) {
      const intentPath = `${entityPath}/intents/${intentIndex}`;
      add(`${intentPath}/payload`, intent.payload);
      add(`${intentPath}/summary`, intent.summary);
    }
    add(`${entityPath}/matchedVia`, entity.matchedVia);
    for (const [evidenceIndex, evidence] of (entity.evidence ?? []).entries()) {
      const evidencePath = `${entityPath}/evidence/${evidenceIndex}`;
      add(`${evidencePath}/payload`, evidence.payload);
      add(`${evidencePath}/summary`, evidence.summary);
      add(`${evidencePath}/assertionText`, evidence.assertionText);
    }
  }

  add("/input/existingOpportunities", input.input.existingOpportunities);
  add("/input/introductionHint", input.input.introductionHint);
  add("/input/discoveryQuery", input.input.discoveryQuery);
  for (const [networkId, context] of Object.entries(input.input.networkContexts ?? {})) {
    add(`/input/networkContexts/${escapeJsonPointerSegment(networkId)}`, context);
  }
  add("/triggerInputs/intent/text", input.historicalQuality.triggerInputs.intent.text);
  for (const [premiseIndex, premise] of input.historicalQuality.triggerInputs.enrichment.premises.entries()) {
    add(`/triggerInputs/enrichment/premises/${premiseIndex}`, premise);
  }
  add("/triggerInputs/enrichment/userContext", input.historicalQuality.triggerInputs.enrichment.userContext);

  return fields;
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
  const claims = new Map<string, HistoricalClaim>();
  const preConnectionCitationIds = new Set(input.historicalQuality.cutoff.orderingCitationIds);
  for (const claim of input.historicalQuality.claims) {
    nonblank(claim.id, "claim id");
    if (claims.has(claim.id)) fail(`duplicate claim ${claim.id}`);
    claims.set(claim.id, claim);
    nonblank(claim.text, `claim ${claim.id} text`);
    if (claim.preConnection !== true) fail(`claim ${claim.id} must attest preConnection`);
    assertCitationIds(claim.citationIds, `claim ${claim.id}`);
    for (const citationId of claim.citationIds) preConnectionCitationIds.add(citationId);
  }

  const requiredClaimFields = claimBearingProjectionFields(input);
  const claimProvenance = input.historicalQuality.claimProvenance;
  for (const path of requiredClaimFields.keys()) {
    if (!Object.prototype.hasOwnProperty.call(claimProvenance, path)) fail(`missing claim provenance for ${path}`);
  }
  for (const path of Object.keys(claimProvenance)) {
    const fieldText = requiredClaimFields.get(path);
    if (fieldText === undefined) fail(`unknown claim provenance path ${path}`);
    const mappedClaimIds = claimProvenance[path]!;
    if (mappedClaimIds.length === 0) fail(`claim provenance for ${path} requires at least one claim`);
    for (const claimId of mappedClaimIds) {
      const claim = claims.get(claimId) ?? fail(`claim provenance for ${path} references unknown claim ${claimId}`);
      if (claim.text !== fieldText) fail(`claim ${claimId} text does not match ${path}`);
    }
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
