import type { MatchingCase } from "../matching/matching.types.js";

export type HistoricalDatePrecision = "day" | "month" | "year";
export type HistoricalRecognizability = "low" | "medium" | "high";
export type HistoricalParticipantKind = "historical" | "synthetic";

export interface HistoricalCitation {
  id: string;
  url: string;
  title: string;
  publisher: string;
  excerpt: string;
}

export interface HistoricalFactClaim {
  kind: "historical";
  id: string;
  text: string;
  citationIds: string[];
  preConnection: true;
}

export interface HistoricalDerivedClaim {
  kind: "derived";
  id: string;
  text: string;
  basisClaimIds: string[];
  rationale: string;
}

export interface HistoricalAuthoredClaim {
  kind: "authored";
  id: string;
  text: string;
  participantId: string;
  violatedRequirement: string;
}

export type HistoricalClaim = HistoricalFactClaim | HistoricalDerivedClaim | HistoricalAuthoredClaim;

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
  participantKinds: Record<string, HistoricalParticipantKind>;
  outcomeCitationIds: string[];
  anonymizationReview: {
    reviewer: string;
    reviewedAt: string;
    recognizability: HistoricalRecognizability;
    decision: "approved" | "pending" | "revise";
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
  description: string;
  input: MatchingCase["input"];
  triggerInputs: HistoricalQualityMetadata["triggerInputs"];
}

export function historicalModelSafeProjection(input: HistoricalQualityCase): HistoricalModelSafeProjection {
  return {
    description: input.description,
    input: structuredClone(input.input),
    triggerInputs: structuredClone(input.historicalQuality.triggerInputs),
  };
}

export function historicalMatchingCaseProjection(input: HistoricalQualityCase): MatchingCase {
  return {
    id: input.id,
    rule: input.rule,
    tier: input.tier,
    domains: structuredClone(input.domains),
    description: input.description,
    input: structuredClone(input.input),
    expect: structuredClone(input.expect),
    reportNames: input.reportNames ? structuredClone(input.reportNames) : undefined,
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

  add("/description", input.description);
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
  add("/input/introducerName", input.input.introducerName);
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

export interface HistoricalValidationOptions {
  requireApprovedReview?: boolean;
}

export function validateHistoricalQualityCase(
  input: HistoricalQualityCase,
  options: HistoricalValidationOptions = {},
): void {
  const fail = (message: string): never => { throw new Error(`${input.id}: ${message}`); };
  const nonblank = (value: string, field: string): void => {
    if (value.trim() === "") fail(`${field} must be non-empty`);
  };

  const ids = new Set<string>();
  for (const entity of input.input.entities) {
    if (ids.has(entity.userId)) fail(`duplicate participant ${entity.userId}`);
    ids.add(entity.userId);
  }
  if (input.input.entities.length !== 5) fail("requires exactly five participants");

  const participantKinds = input.historicalQuality.participantKinds;
  for (const participantId of ids) {
    if (!Object.prototype.hasOwnProperty.call(participantKinds, participantId)) {
      fail(`missing participant kind for ${participantId}`);
    }
  }
  for (const participantId of Object.keys(participantKinds)) {
    if (!ids.has(participantId)) fail(`unknown participant kind ${participantId}`);
  }

  if (!ids.has(input.input.discovererId)) fail("discoverer must reference an entity");
  if (participantKinds[input.input.discovererId] !== "historical") {
    fail(`discoverer ${input.input.discovererId} must be historical`);
  }

  const positives = input.expect.filter((expectation) => expectation.match);
  if (positives.length !== 1) fail("requires exactly one positive partner");
  const positiveId = positives[0]!.candidateId;
  if (!ids.has(positiveId)) fail(`positive participant ${positiveId} is not a participant`);
  if (participantKinds[positiveId] !== "historical") fail(`positive participant ${positiveId} must be historical`);

  const rejectedIds = input.expect.filter((expectation) => !expectation.match).map((expectation) => expectation.candidateId);
  const rejected = new Set(rejectedIds);
  if (rejected.size !== 3 || rejectedIds.length !== 3) fail("requires exactly three rejected participants");
  for (const participantId of rejected) {
    if (!ids.has(participantId)) fail(`rejected participant ${participantId} is not a participant`);
    if (participantKinds[participantId] !== "synthetic") fail(`rejected participant ${participantId} must be synthetic`);
  }
  const expectedParticipants = new Set([input.input.discovererId, positiveId, ...rejected]);
  if (expectedParticipants.size !== ids.size || [...ids].some((participantId) => !expectedParticipants.has(participantId))) {
    fail("expectations must cover every participant other than the discoverer");
  }

  const negativeEntries = Object.entries(input.historicalQuality.semanticNegatives);
  const negativeIds = new Set(negativeEntries.map(([participantId]) => participantId));
  if (negativeIds.size !== rejected.size || [...rejected].some((participantId) => !negativeIds.has(participantId))) {
    fail("semantic negatives must exactly cover rejected synthetic participants");
  }
  for (const [participantId, reason] of negativeEntries) {
    if (!ids.has(participantId) || participantKinds[participantId] !== "synthetic" || !rejected.has(participantId)) {
      fail(`semantic negative ${participantId} must reference a rejected synthetic participant`);
    }
    nonblank(reason, `semantic negative ${participantId} reason`);
  }

  for (const participantId of Object.keys(input.reportNames ?? {})) {
    if (!ids.has(participantId)) fail(`report name references unknown participant ${participantId}`);
    if (participantKinds[participantId] === "synthetic") {
      fail(`report name cannot identify synthetic participant ${participantId}`);
    }
  }

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
    if (claim.kind === "historical") {
      if (claim.preConnection !== true) fail(`claim ${claim.id} must attest preConnection`);
      assertCitationIds(claim.citationIds, `claim ${claim.id}`);
      for (const citationId of claim.citationIds) preConnectionCitationIds.add(citationId);
    } else if (claim.kind === "derived") {
      if (claim.basisClaimIds.length === 0) fail(`derived claim ${claim.id} requires at least one basis claim`);
      nonblank(claim.rationale, `derived claim ${claim.id} rationale`);
    } else {
      if (!ids.has(claim.participantId)) fail(`authored claim ${claim.id} references unknown participant ${claim.participantId}`);
      nonblank(claim.violatedRequirement, `authored claim ${claim.id} violatedRequirement`);
    }
  }

  const derivedState = new Map<string, "visiting" | "historical">();
  const terminatesInHistoricalClaims = (claim: HistoricalClaim): boolean => {
    if (claim.kind === "historical") return true;
    if (claim.kind === "authored") return false;
    const state = derivedState.get(claim.id);
    if (state === "visiting") fail(`derived claim cycle at ${claim.id}`);
    if (state === "historical") return true;
    derivedState.set(claim.id, "visiting");
    for (const basisClaimId of claim.basisClaimIds) {
      const basis = claims.get(basisClaimId) ?? fail(`derived claim ${claim.id} references unknown basis claim ${basisClaimId}`);
      if (!terminatesInHistoricalClaims(basis)) {
        fail(`derived claim ${claim.id} must terminate only in historical claims`);
      }
    }
    derivedState.set(claim.id, "historical");
    return true;
  };
  for (const claim of claims.values()) {
    if (claim.kind === "derived") terminatesInHistoricalClaims(claim);
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
    const entityMatch = /^\/input\/entities\/(\d+)(?:\/|$)/.exec(path);
    const participantId = entityMatch ? input.input.entities[Number(entityMatch[1])]?.userId : undefined;
    for (const claimId of mappedClaimIds) {
      const claim = claims.get(claimId) ?? fail(`claim provenance for ${path} references unknown claim ${claimId}`);
      if (claim.text !== fieldText) fail(`claim ${claimId} text does not match ${path}`);
      if (participantId !== undefined) {
        if (participantKinds[participantId] === "historical") {
          if (claim.kind === "authored") fail(`historical participant ${participantId} path ${path} cannot use authored claim ${claim.id}`);
          terminatesInHistoricalClaims(claim);
        } else if (claim.kind === "authored") {
          if (claim.participantId !== participantId) {
            fail(`authored claim ${claim.id} participantId does not match synthetic participant ${participantId}`);
          }
          if (claim.violatedRequirement !== input.historicalQuality.semanticNegatives[participantId]) {
            fail(`authored claim ${claim.id} violatedRequirement does not match semantic negative ${participantId}`);
          }
        } else {
          fail(`synthetic participant ${participantId} path ${path} cannot use ${claim.kind} claim ${claim.id}`);
        }
      } else {
        if (claim.kind === "authored") fail(`non-participant path ${path} cannot use authored claim ${claim.id}`);
        terminatesInHistoricalClaims(claim);
      }
    }
  }

  if (input.historicalQuality.outcomeCitationIds.some((citationId) => preConnectionCitationIds.has(citationId))) {
    fail("outcome citations must be disjoint from pre-connection citations");
  }

  const review = input.historicalQuality.anonymizationReview;
  if ((options.requireApprovedReview ?? true) && review.decision !== "approved") {
    fail("anonymization review must be approved");
  }
  nonblank(review.reviewer, "anonymization reviewer");
  nonblank(review.reviewedAt, "anonymization reviewedAt");
  nonblank(review.rationale, "anonymization rationale");

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

function deepFreeze<T>(input: T): T {
  if (input !== null && typeof input === "object") {
    for (const value of Object.values(input)) deepFreeze(value);
    if (!Object.isFrozen(input)) Object.freeze(input);
  }
  return input;
}

export function defineHistoricalQualityCase(input: HistoricalQualityCase): HistoricalQualityCase {
  validateHistoricalQualityCase(input, { requireApprovedReview: false });
  return deepFreeze(input);
}
