import { HISTORICAL_QUALITY_CASES } from "../matching/matching.historical.js";
import { fingerprintCanonicalJson } from "../shared/index.js";
import { buildHistoricalSharedPoolPlan, historicalRetrievalDocumentFingerprint, historicalSharedPoolPlanFingerprint, historicalSharedPoolSeedFingerprint, stableQualityId, type HistoricalSharedPoolEnrichmentRow, type HistoricalSharedPoolFixture, type HistoricalSharedPoolPendingApproval, type HistoricalSharedPoolRetrievalDocument } from "./historical-quality.shared-pool.js";

const CORPUS_VERSION = "historical-shared-pool-v1";
const AUTHOR_ID = "yanki@index.network";
const DOCUMENT_STRATEGY = "historical-quality-fixture";
const DOCUMENT_TARGET_FRAME = "discovery";

export const HISTORICAL_SHARED_NETWORK = Object.freeze({
  id: stableQualityId("network", "shared-pool-v1"),
  title: "Interdisciplinary collaboration community",
  prompt:
    "A private community where people describe what they are working on, what they can contribute, and the kinds of collaboration they are open to.",
});

const expectedSourceByCaseId = new Map<string, string>([
  ["historical/builder-and-operator", "h1-a"],
  ["historical/co-researchers-structure", "h2-a"],
  ["historical/songwriting-duo", "h3-a"],
  ["historical/first-check-investor", "h4-a"],
  ["historical/domain-expert-and-ml", "h5-a"],
] as const);

function sourcePath(caseId: string, participantId: string, fieldPath: string): string {
  return `case:${caseId}/participant:${participantId}/${fieldPath}`;
}

const enrichmentRows: HistoricalSharedPoolEnrichmentRow[] = [];
for (const historicalCase of HISTORICAL_QUALITY_CASES) {
  const expectedSourceId = expectedSourceByCaseId.get(historicalCase.id);
  if (expectedSourceId === undefined || historicalCase.input.discovererId !== expectedSourceId) {
    throw new Error(`${historicalCase.id}: unexpected historical shared-pool source`);
  }

  for (const entity of historicalCase.input.entities) {
    const participantId = entity.userId;
    if (participantId === expectedSourceId) {
      const source = historicalCase.historicalQuality.triggerInputs.enrichment;
      enrichmentRows.push(Object.freeze({
        participantId,
        premises: Object.freeze([...source.premises]),
        premiseSourcePaths: Object.freeze(source.premises.map((_, index) =>
          sourcePath(historicalCase.id, participantId, `triggerInputs/enrichment/premises:${index}`))),
        userContext: source.userContext,
        contextSourcePaths: Object.freeze([
          sourcePath(historicalCase.id, participantId, "triggerInputs/enrichment/userContext"),
        ]),
      }));
      continue;
    }

    const intentPayload = entity.intents?.[0]?.payload;
    if (entity.intents?.length !== 1 || intentPayload === undefined) {
      throw new Error(`${participantId}: expected exactly one intent for shared-pool enrichment`);
    }
    const bio = entity.profile.bio ?? "";
    const location = entity.profile.location ?? "";
    const interests = entity.profile.interests ?? [];
    const skills = entity.profile.skills ?? [];
    enrichmentRows.push(Object.freeze({
      participantId,
      premises: Object.freeze([intentPayload]),
      premiseSourcePaths: Object.freeze([
        sourcePath(historicalCase.id, participantId, "intent:0/payload"),
      ]),
      userContext: [
        `Bio: ${bio}`,
        `Location: ${location}`,
        `Interests: ${interests.join(", ")}`,
        `Skills: ${skills.join(", ")}`,
        `Intent: ${intentPayload}`,
      ].join("\n"),
      contextSourcePaths: Object.freeze([
        sourcePath(historicalCase.id, participantId, "profile/bio"),
        sourcePath(historicalCase.id, participantId, "profile/location"),
        sourcePath(historicalCase.id, participantId, "profile/interests"),
        sourcePath(historicalCase.id, participantId, "profile/skills"),
        sourcePath(historicalCase.id, participantId, "intent:0/payload"),
      ]),
    }));
  }
}

enrichmentRows.sort((left, right) => left.participantId < right.participantId ? -1 : left.participantId > right.participantId ? 1 : 0);
export const HISTORICAL_SHARED_POOL_ENRICHMENT_ROWS = Object.freeze(enrichmentRows);

const retrievalDocuments: HistoricalSharedPoolRetrievalDocument[] = HISTORICAL_SHARED_POOL_ENRICHMENT_ROWS.flatMap((row) => {
  const premiseDocuments = row.premises.map((text, index): HistoricalSharedPoolRetrievalDocument => {
    const sourcePaths = Object.freeze([row.premiseSourcePaths[index]!]);
    const sourceRowId = stableQualityId("premise", `${row.participantId}:${sourcePaths[0]}`);
    return Object.freeze({
      documentId: stableQualityId("document", `premise:${sourceRowId}`),
      participantId: row.participantId,
      sourceRowId,
      sourceType: "premise",
      strategy: DOCUMENT_STRATEGY,
      targetCorpus: "premise",
      targetFrame: DOCUMENT_TARGET_FRAME,
      text,
      sourcePaths,
      contentFingerprint: fingerprintCanonicalJson(text),
    });
  });
  const contextSourceRowId = stableQualityId("context", row.participantId);
  const contextDocument: HistoricalSharedPoolRetrievalDocument = Object.freeze({
    documentId: stableQualityId("document", `context:${contextSourceRowId}`),
    participantId: row.participantId,
    sourceRowId: contextSourceRowId,
    sourceType: "context",
    strategy: DOCUMENT_STRATEGY,
    targetCorpus: "context",
    targetFrame: DOCUMENT_TARGET_FRAME,
    text: row.userContext,
    sourcePaths: Object.freeze([...row.contextSourcePaths]),
    contentFingerprint: fingerprintCanonicalJson(row.userContext),
  });
  return [...premiseDocuments, contextDocument];
});
retrievalDocuments.sort((left, right) => left.documentId < right.documentId ? -1 : left.documentId > right.documentId ? 1 : 0);
export const HISTORICAL_SHARED_POOL_RETRIEVAL_DOCUMENTS = Object.freeze(retrievalDocuments);

const pendingFingerprintPlaceholder: HistoricalSharedPoolPendingApproval = {
  status: "pending",
  authorId: AUTHOR_ID,
  corpusVersion: CORPUS_VERSION,
  planFingerprint: "0".repeat(64),
  seedProjectionFingerprint: "0".repeat(64),
  retrievalDocumentFingerprint: "0".repeat(64),
};
const pendingFixture: HistoricalSharedPoolFixture = {
  corpusVersion: CORPUS_VERSION,
  network: HISTORICAL_SHARED_NETWORK,
  enrichmentRows: HISTORICAL_SHARED_POOL_ENRICHMENT_ROWS,
  retrievalDocuments: HISTORICAL_SHARED_POOL_RETRIEVAL_DOCUMENTS,
  approval: pendingFingerprintPlaceholder,
};
const pendingPlan = buildHistoricalSharedPoolPlan({
  cases: HISTORICAL_QUALITY_CASES,
  fixture: pendingFixture,
});

export const HISTORICAL_SHARED_POOL_APPROVAL_RECORD = Object.freeze({
  status: "pending",
  authorId: AUTHOR_ID,
  corpusVersion: CORPUS_VERSION,
  planFingerprint: historicalSharedPoolPlanFingerprint(pendingPlan),
  seedProjectionFingerprint: historicalSharedPoolSeedFingerprint(pendingPlan.seedProjection),
  retrievalDocumentFingerprint: historicalRetrievalDocumentFingerprint(pendingPlan.seedProjection.documents),
} satisfies HistoricalSharedPoolPendingApproval);

export const HISTORICAL_SHARED_POOL_FIXTURE = Object.freeze({
  corpusVersion: CORPUS_VERSION,
  network: HISTORICAL_SHARED_NETWORK,
  enrichmentRows: HISTORICAL_SHARED_POOL_ENRICHMENT_ROWS,
  retrievalDocuments: HISTORICAL_SHARED_POOL_RETRIEVAL_DOCUMENTS,
  approval: HISTORICAL_SHARED_POOL_APPROVAL_RECORD,
} satisfies HistoricalSharedPoolFixture);
