import { createHash } from "node:crypto";

import { z } from "zod";

import { fingerprintCanonicalJson } from "../shared/index.js";
import { validateHistoricalQualityCase, type HistoricalQualityCase } from "./historical-quality.corpus.js";

const QUALITY_ID_NAMESPACE = "index:historical-quality:v1";
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, "expected a SHA-256 hex fingerprint");

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedById<T>(rows: readonly T[], id: (row: T) => string): T[] {
  return [...rows].sort((left, right) => compareAscii(id(left), id(right)));
}

export function stableQualityId(kind: string, sourceId: string): string {
  if (kind.trim() === "" || sourceId.trim() === "") throw new Error("stable quality ID inputs must be non-empty");
  const suffix = createHash("sha256")
    .update(`${QUALITY_ID_NAMESPACE}:${kind}:${sourceId}`)
    .digest("hex")
    .slice(0, 24);
  return `eval-discovery-quality-${kind}-${suffix}`;
}

export type HistoricalCandidateRole = "target" | "semantic-negative" | "background";

export interface HistoricalSharedPoolEnrichmentRow {
  readonly participantId: string;
  readonly premises: readonly string[];
  readonly premiseSourcePaths: readonly string[];
  readonly userContext: string;
  readonly contextSourcePaths: readonly string[];
}

export interface HistoricalSharedPoolRetrievalDocument {
  readonly documentId: string;
  readonly participantId: string;
  readonly sourceRowId: string;
  readonly sourceType: "premise" | "context";
  readonly strategy: string;
  readonly targetCorpus: string;
  readonly targetFrame: string;
  readonly text: string;
  readonly sourcePaths: readonly string[];
  readonly contentFingerprint: string;
}

export interface HistoricalQualitySeedUser { readonly id: string }
export interface HistoricalQualitySeedNetwork { readonly id: string; readonly title: string; readonly prompt: string }
export interface HistoricalQualitySeedMembership { readonly networkId: string; readonly userId: string }
export interface HistoricalQualitySeedIntent { readonly id: string; readonly userId: string; readonly text: string }
export interface HistoricalQualitySeedIntentNetworkAssignment { readonly networkId: string; readonly intentId: string }
export interface HistoricalQualitySeedPremise {
  readonly id: string;
  readonly participantId: string;
  readonly userId: string;
  readonly intentId: string;
  readonly text: string;
  readonly sourcePath: string;
}
export interface HistoricalQualitySeedContext {
  readonly id: string;
  readonly participantId: string;
  readonly userId: string;
  readonly text: string;
  readonly sourcePaths: readonly string[];
}
export type HistoricalQualitySeedDocument = HistoricalSharedPoolRetrievalDocument;

export interface HistoricalSharedPoolSeedProjection {
  readonly users: readonly HistoricalQualitySeedUser[];
  readonly networks: readonly [HistoricalQualitySeedNetwork];
  readonly memberships: readonly HistoricalQualitySeedMembership[];
  readonly intents: readonly HistoricalQualitySeedIntent[];
  readonly intentNetworkAssignments: readonly HistoricalQualitySeedIntentNetworkAssignment[];
  readonly premises: readonly HistoricalQualitySeedPremise[];
  readonly contexts: readonly HistoricalQualitySeedContext[];
  readonly documents: readonly HistoricalQualitySeedDocument[];
}

export interface HistoricalSharedPoolPlan {
  corpusVersion: string;
  network: { id: string; title: string; prompt: string };
  participants: Array<{
    participantId: string;
    userId: string;
    intentId: string;
    premiseIds: string[];
    contextId: string;
    retrievalDocumentIds: string[];
  }>;
  cases: Array<{
    caseId: string;
    sourceParticipantId: string;
    targetParticipantId: string;
    candidates: Array<{
      participantId: string;
      role: HistoricalCandidateRole;
      semanticNegativeReasonId?: string;
    }>;
  }>;
  seedProjection: HistoricalSharedPoolSeedProjection;
}

export const HistoricalSharedPoolApprovalReceiptSchema = z.object({
  status: z.literal("approved"),
  authorId: z.string().trim().min(1),
  reviewerId: z.string().trim().min(1),
  contentRevision: z.string().regex(/^[a-f0-9]{40,64}$/i),
  reviewedAt: z.string().datetime({ offset: true }),
  decision: z.literal("approved"),
  independenceAttested: z.literal(true),
  recognizability: z.enum(["low", "medium"]),
  rationale: z.string().trim().min(1),
  corpusVersion: z.string().trim().min(1),
  planFingerprint: sha256Schema,
  seedProjectionFingerprint: sha256Schema,
  retrievalDocumentFingerprint: sha256Schema,
}).strict();

export type HistoricalSharedPoolApprovalReceipt = z.infer<typeof HistoricalSharedPoolApprovalReceiptSchema>;

export interface HistoricalSharedPoolPendingApproval {
  status: "pending";
  authorId: string;
  corpusVersion: string;
  planFingerprint: string;
  seedProjectionFingerprint: string;
  retrievalDocumentFingerprint: string;
}

export type HistoricalSharedPoolApproval = HistoricalSharedPoolPendingApproval | HistoricalSharedPoolApprovalReceipt;

export interface HistoricalSharedPoolFixture {
  readonly corpusVersion: string;
  readonly network: { readonly id: string; readonly title: string; readonly prompt: string };
  readonly enrichmentRows: readonly HistoricalSharedPoolEnrichmentRow[];
  readonly retrievalDocuments: readonly HistoricalSharedPoolRetrievalDocument[];
  readonly approval: HistoricalSharedPoolApproval;
}

export interface HistoricalSharedPoolApprovalCurrent {
  authorId: string;
  contentRevision: string;
  corpusVersion: string;
  planFingerprint: string;
  seedProjectionFingerprint: string;
  retrievalDocumentFingerprint: string;
}

export function verifyHistoricalSharedPoolApprovalReceipt(
  input: HistoricalSharedPoolApprovalReceipt,
  current: HistoricalSharedPoolApprovalCurrent,
): void {
  const receipt = HistoricalSharedPoolApprovalReceiptSchema.parse(input);
  if (receipt.authorId !== current.authorId) throw new Error("approval author does not match content author");
  if (receipt.reviewerId === receipt.authorId) throw new Error("reviewer must be independent");
  if (receipt.contentRevision !== current.contentRevision) throw new Error("receipt does not bind the content revision");
  if (receipt.corpusVersion !== current.corpusVersion) throw new Error("receipt does not bind the current corpus version");
  if (receipt.planFingerprint !== current.planFingerprint) throw new Error("receipt does not bind the current plan fingerprint");
  if (receipt.seedProjectionFingerprint !== current.seedProjectionFingerprint) throw new Error("receipt does not bind the current seed projection fingerprint");
  if (receipt.retrievalDocumentFingerprint !== current.retrievalDocumentFingerprint) throw new Error("receipt does not bind the current retrieval document fingerprint");
}

export function assertHistoricalSharedPoolApproval(
  approval: HistoricalSharedPoolApproval,
  current: HistoricalSharedPoolApprovalCurrent,
): asserts approval is HistoricalSharedPoolApprovalReceipt {
  if (approval.status !== "approved") throw new Error("shared pool pending approval");
  verifyHistoricalSharedPoolApprovalReceipt(approval, current);
}

function assertFiveCanonicalCases(cases: readonly HistoricalQualityCase[]): HistoricalQualityCase[] {
  if (cases.length !== 5) throw new Error("historical shared pool requires exactly five cases");
  const orderedCases = sortedById(cases, (historicalCase) => historicalCase.id);
  if (new Set(orderedCases.map((historicalCase) => historicalCase.id)).size !== orderedCases.length) {
    throw new Error("historical shared pool case IDs must be unique");
  }

  const participants = new Map<string, string>();
  for (const historicalCase of orderedCases) {
    for (const entity of historicalCase.input.entities) {
      const canonical = JSON.stringify(entity);
      const prior = participants.get(entity.userId);
      if (prior !== undefined) {
        if (prior === canonical) throw new Error(`duplicate participant ${entity.userId}`);
        throw new Error(`inconsistent duplicate participant ${entity.userId}`);
      }
      participants.set(entity.userId, canonical);
    }
  }
  if (participants.size !== 25) throw new Error("historical shared pool requires exactly 25 unique participants");
  const requiredParticipantIds = Array.from({ length: 5 }, (_, index) =>
    ["a", "b", "c", "d", "e"].map((suffix) => `h${index + 1}-${suffix}`),
  ).flat();
  if (requiredParticipantIds.some((participantId) => !participants.has(participantId))) {
    throw new Error("historical shared pool participants must be exactly h1-a through h5-e");
  }

  const sourceGroups = new Set<string>();
  for (const historicalCase of orderedCases) {
    validateHistoricalQualityCase(historicalCase);
    const sourceMatch = /^h([1-5])-a$/.exec(historicalCase.input.discovererId);
    if (!sourceMatch) throw new Error(`${historicalCase.id}: source must be hN-a`);
    const group = sourceMatch[1]!;
    if (sourceGroups.has(group)) throw new Error(`duplicate historical source group h${group}`);
    sourceGroups.add(group);
    const target = historicalCase.expect.find((expectation) => expectation.match)?.candidateId;
    if (target !== `h${group}-b`) throw new Error(`${historicalCase.id}: target must be h${group}-b`);
    const negatives = Object.keys(historicalCase.historicalQuality.semanticNegatives).sort(compareAscii);
    if (JSON.stringify(negatives) !== JSON.stringify([`h${group}-c`, `h${group}-d`, `h${group}-e`])) {
      throw new Error(`${historicalCase.id}: semantic negatives must be h${group}-c through h${group}-e`);
    }
  }
  return orderedCases;
}

function assertNonblank(value: string, field: string): void {
  if (value.trim() === "") throw new Error(`${field} must be non-empty`);
}

function canonicalPremises(row: HistoricalSharedPoolEnrichmentRow): Array<{ text: string; sourcePath: string }> {
  return row.premises
    .map((text, index) => ({ text, sourcePath: row.premiseSourcePaths[index]! }))
    .sort((left, right) => compareAscii(left.sourcePath, right.sourcePath));
}

function buildSeedProjection(
  orderedCases: readonly HistoricalQualityCase[],
  fixture: HistoricalSharedPoolFixture,
): HistoricalSharedPoolSeedProjection {
  assertNonblank(fixture.corpusVersion, "corpus version");
  assertNonblank(fixture.network.id, "network id");
  assertNonblank(fixture.network.title, "network title");
  assertNonblank(fixture.network.prompt, "network prompt");

  const entities = sortedById(
    orderedCases.flatMap((historicalCase) => historicalCase.input.entities),
    (entity) => entity.userId,
  );
  const participantIds = new Set(entities.map((entity) => entity.userId));
  const rows = sortedById(fixture.enrichmentRows, (row) => row.participantId);
  const rowIds = new Set<string>();
  for (const row of rows) {
    if (rowIds.has(row.participantId)) throw new Error(`duplicate enrichment row ${row.participantId}`);
    rowIds.add(row.participantId);
    if (!participantIds.has(row.participantId)) throw new Error(`unknown enrichment row ${row.participantId}`);
    if (row.premises.length === 0) throw new Error(`${row.participantId}: requires at least one premise`);
    if (row.premiseSourcePaths.length !== row.premises.length) throw new Error(`${row.participantId}: each premise requires one source path`);
    assertNonblank(row.userContext, `${row.participantId} context`);
    if (row.contextSourcePaths.length === 0) throw new Error(`${row.participantId}: context requires source paths`);
    for (const premise of canonicalPremises(row)) {
      assertNonblank(premise.text, `${row.participantId} premise`);
      assertNonblank(premise.sourcePath, `${row.participantId} premise source path`);
    }
  }
  for (const participantId of participantIds) {
    if (!rowIds.has(participantId)) throw new Error(`missing enrichment row for ${participantId}`);
  }

  const users = entities.map((entity) => ({ id: stableQualityId("user", entity.userId) }));
  const userIdByParticipant = new Map(entities.map((entity) => [entity.userId, stableQualityId("user", entity.userId)]));
  const intents = entities.map((entity) => {
    if (entity.intents?.length !== 1) throw new Error(`${entity.userId}: expected exactly one intent`);
    return {
      id: stableQualityId("intent", entity.userId),
      userId: userIdByParticipant.get(entity.userId)!,
      text: entity.intents[0]!.payload,
    };
  });
  const premises = rows.flatMap((row) => canonicalPremises(row).map((premise) => ({
    id: stableQualityId("premise", `${row.participantId}:${premise.sourcePath}`),
    participantId: row.participantId,
    userId: userIdByParticipant.get(row.participantId)!,
    intentId: stableQualityId("intent", row.participantId),
    text: premise.text,
    sourcePath: premise.sourcePath,
  })));
  const contexts = rows.map((row) => ({
    id: stableQualityId("context", row.participantId),
    participantId: row.participantId,
    userId: userIdByParticipant.get(row.participantId)!,
    text: row.userContext,
    sourcePaths: [...row.contextSourcePaths].sort(compareAscii),
  }));

  const sourceRows = new Map<string, { participantId: string; text: string; sourcePaths: string[]; sourceType: "premise" | "context"; expectedDocumentId: string }>();
  for (const row of rows) {
    for (const rowPremise of canonicalPremises(row)) {
      const premiseId = stableQualityId("premise", `${row.participantId}:${rowPremise.sourcePath}`);
      sourceRows.set(premiseId, {
        participantId: row.participantId,
        text: rowPremise.text,
        sourcePaths: [rowPremise.sourcePath],
        sourceType: "premise",
        expectedDocumentId: stableQualityId("document", `premise:${premiseId}`),
      });
    }
  }
  for (const context of contexts) sourceRows.set(context.id, {
    participantId: context.participantId,
    text: context.text,
    sourcePaths: [...context.sourcePaths],
    sourceType: "context",
    expectedDocumentId: stableQualityId("document", `context:${context.id}`),
  });

  const documents = sortedById(fixture.retrievalDocuments, (document) => document.documentId).map((document) => {
    const source = sourceRows.get(document.sourceRowId);
    if (!source) throw new Error(`${document.documentId}: unknown retrieval source row ${document.sourceRowId}`);
    if (document.documentId !== source.expectedDocumentId) throw new Error(`${document.documentId}: retrieval document ID does not match its stable source identity`);
    if (source.participantId !== document.participantId) throw new Error(`${document.documentId}: retrieval participant does not own source row`);
    if (source.sourceType !== document.sourceType) throw new Error(`${document.documentId}: retrieval source type mismatch`);
    if (source.text !== document.text) throw new Error(`${document.documentId}: retrieval text differs from source row`);
    if (document.contentFingerprint !== fingerprintCanonicalJson(document.text)) throw new Error(`${document.documentId}: invalid content fingerprint`);
    const sourcePaths = [...document.sourcePaths].sort(compareAscii);
    if (JSON.stringify(sourcePaths) !== JSON.stringify(source.sourcePaths)) throw new Error(`${document.documentId}: retrieval source paths mismatch`);
    assertNonblank(document.strategy, `${document.documentId} strategy`);
    assertNonblank(document.targetCorpus, `${document.documentId} target corpus`);
    assertNonblank(document.targetFrame, `${document.documentId} target frame`);
    return { ...document, sourcePaths };
  });
  if (new Set(documents.map((document) => document.documentId)).size !== documents.length) throw new Error("duplicate retrieval document ID");
  if (documents.length !== sourceRows.size) throw new Error("requires exactly one retrieval document per premise and context");
  for (const sourceRowId of sourceRows.keys()) {
    const linked = documents.filter((document) => document.sourceRowId === sourceRowId);
    if (linked.length !== 1) throw new Error(`source row ${sourceRowId} requires exactly one retrieval document`);
  }

  return {
    users: sortedById(users, (row) => row.id),
    networks: [{ ...fixture.network }],
    memberships: sortedById(users.map((user) => ({ networkId: fixture.network.id, userId: user.id })), (row) => `${row.networkId}\0${row.userId}`),
    intents: sortedById(intents, (row) => row.id),
    intentNetworkAssignments: sortedById(intents.map((intent) => ({ networkId: fixture.network.id, intentId: intent.id })), (row) => `${row.networkId}\0${row.intentId}`),
    premises: sortedById(premises, (row) => row.id),
    contexts: sortedById(contexts, (row) => row.id),
    documents,
  };
}

export function buildHistoricalSharedPoolPlan(input: {
  cases: readonly HistoricalQualityCase[];
  fixture: HistoricalSharedPoolFixture;
}): HistoricalSharedPoolPlan {
  const orderedCases = assertFiveCanonicalCases(input.cases);
  const seedProjection = buildSeedProjection(orderedCases, input.fixture);
  const allParticipantIds = seedProjection.contexts.map((context) => context.participantId).sort(compareAscii);
  const documentsByParticipant = new Map<string, string[]>();
  for (const document of seedProjection.documents) {
    const ids = documentsByParticipant.get(document.participantId) ?? [];
    ids.push(document.documentId);
    documentsByParticipant.set(document.participantId, ids);
  }

  const participants = allParticipantIds.map((participantId) => ({
    participantId,
    userId: stableQualityId("user", participantId),
    intentId: stableQualityId("intent", participantId),
    premiseIds: seedProjection.premises.filter((premise) => premise.participantId === participantId).map((premise) => premise.id),
    contextId: stableQualityId("context", participantId),
    retrievalDocumentIds: (documentsByParticipant.get(participantId) ?? []).sort(compareAscii),
  }));

  const cases = orderedCases.map((historicalCase) => {
    const target = historicalCase.expect.find((expectation) => expectation.match);
    if (!target) throw new Error(`${historicalCase.id}: missing target`);
    const negativeIds = new Set(Object.keys(historicalCase.historicalQuality.semanticNegatives));
    const excluded = new Set([historicalCase.input.discovererId, target.candidateId, ...negativeIds]);
    const candidates = allParticipantIds
      .filter((participantId) => participantId !== historicalCase.input.discovererId)
      .map((participantId) => {
        if (participantId === target.candidateId) return { participantId, role: "target" as const };
        if (negativeIds.has(participantId)) return {
          participantId,
          role: "semantic-negative" as const,
          semanticNegativeReasonId: stableQualityId("semantic-negative-reason", `${historicalCase.id}:${participantId}`),
        };
        if (excluded.has(participantId)) throw new Error(`${historicalCase.id}: invalid candidate role coverage`);
        return { participantId, role: "background" as const };
      });
    if (candidates.filter((candidate) => candidate.role === "target").length !== 1
      || candidates.filter((candidate) => candidate.role === "semantic-negative").length !== 3
      || candidates.filter((candidate) => candidate.role === "background").length !== 20) {
      throw new Error(`${historicalCase.id}: requires exactly 1 target, 3 semantic negatives, and 20 backgrounds`);
    }
    return {
      caseId: historicalCase.id,
      sourceParticipantId: historicalCase.input.discovererId,
      targetParticipantId: target.candidateId,
      candidates,
    };
  });

  return {
    corpusVersion: input.fixture.corpusVersion,
    network: { ...input.fixture.network },
    participants,
    cases,
    seedProjection,
  };
}

export function historicalSharedPoolPlanFingerprint(plan: HistoricalSharedPoolPlan): string {
  const { seedProjection: _seedProjection, ...canonicalPlan } = plan;
  return fingerprintCanonicalJson(canonicalPlan);
}

export function historicalSharedPoolSeedFingerprint(projection: HistoricalSharedPoolSeedProjection): string {
  return fingerprintCanonicalJson(projection);
}

export function historicalRetrievalDocumentFingerprint(documents: readonly HistoricalQualitySeedDocument[]): string {
  return fingerprintCanonicalJson(sortedById(documents, (document) => document.documentId));
}

export function admitHistoricalSharedPool(input: {
  cases: readonly HistoricalQualityCase[];
  fixture: HistoricalSharedPoolFixture;
  current: { authorId: string; contentRevision: string };
}): HistoricalSharedPoolPlan {
  const plan = buildHistoricalSharedPoolPlan(input);
  assertHistoricalSharedPoolApproval(input.fixture.approval, {
    ...input.current,
    corpusVersion: plan.corpusVersion,
    planFingerprint: historicalSharedPoolPlanFingerprint(plan),
    seedProjectionFingerprint: historicalSharedPoolSeedFingerprint(plan.seedProjection),
    retrievalDocumentFingerprint: historicalRetrievalDocumentFingerprint(plan.seedProjection.documents),
  });
  return plan;
}
