import { HISTORICAL_QUALITY_CASES } from "../matching/matching.historical.js";
import { fingerprintCanonicalJson } from "../shared/index.js";
import { admitHistoricalSharedPool, stableQualityId, type HistoricalSharedPoolApprovalReceipt, type HistoricalSharedPoolEnrichmentRow, type HistoricalSharedPoolFixture, type HistoricalSharedPoolRetrievalDocument } from "./historical-quality.shared-pool.js";

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

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export const HISTORICAL_SHARED_POOL_APPROVAL_RECORD = deepFreeze({
  status: "approved",
  authorId: AUTHOR_ID,
  reviewerId: "ind638.pool-auditor@index.network",
  contentRevision: "0dfb578845697aa8f2773695a4a02ab2a5d3be2d",
  reviewedAt: "2026-08-09T19:02:56Z",
  decision: "approved",
  independenceAttested: true,
  recognizability: "medium",
  rationale: "Independently reviewed the exact content revision's neutral shared prompt, five byte-exact source enrichments, twenty mechanical model-safe projections, all fifty-five retrieval documents and source identities, twenty-five participant mappings, direct 1/3/20 roles, anonymization, leakage boundaries, and recomputed corpus and fingerprints. Residual pooled recognizability is medium because domain-specific attribute combinations can still suggest well-known historical pairs despite anonymized identifiers and exclusion of names, dates, institutions, products, outcomes, and audit data from the shared prompt and pooled model-safe projection.",
  corpusVersion: CORPUS_VERSION,
  planFingerprint: "288336f6511a366d8d49303bc3e76eb475a981966e1ffb0eb2a8539d53fc4ce6",
  seedProjectionFingerprint: "8d27a7634c7def4857f5acd5b399ee82389d8c9baab23fe0b8b4df187a337c38",
  retrievalDocumentFingerprint: "87142f9c46d5fa51f6327c169f6c25d0d90fe35def5ed8778cd27e3da98d7b35",
} satisfies HistoricalSharedPoolApprovalReceipt);

export const HISTORICAL_SHARED_POOL_FIXTURE = Object.freeze({
  corpusVersion: CORPUS_VERSION,
  network: HISTORICAL_SHARED_NETWORK,
  enrichmentRows: HISTORICAL_SHARED_POOL_ENRICHMENT_ROWS,
  retrievalDocuments: HISTORICAL_SHARED_POOL_RETRIEVAL_DOCUMENTS,
  approval: HISTORICAL_SHARED_POOL_APPROVAL_RECORD,
} satisfies HistoricalSharedPoolFixture);

export const HISTORICAL_SHARED_POOL_PLAN = deepFreeze(admitHistoricalSharedPool({
  cases: HISTORICAL_QUALITY_CASES,
  fixture: HISTORICAL_SHARED_POOL_FIXTURE,
  current: {
    authorId: AUTHOR_ID,
    contentRevision: HISTORICAL_SHARED_POOL_APPROVAL_RECORD.contentRevision,
  },
}));

export const HISTORICAL_SHARED_POOL_SEED_PROJECTION = HISTORICAL_SHARED_POOL_PLAN.seedProjection;
