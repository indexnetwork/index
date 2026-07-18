import { parseHydeBlindPublicBatch } from "../../hyde/hyde.artifacts.js";
import { HYDE_BLIND_PUBLIC_BATCH_ARTIFACT_TYPE, HYDE_CANDIDATE_TASK_KIND, HYDE_GROUNDING_TASK_KIND } from "../../hyde/hyde.schemas.js";
import { HYDE_ARTIFACT_SCHEMA_VERSION } from "../../hyde/hyde.policy.js";
import type { ViewerAdapter, ViewerDocument, ViewerField, ViewerItem } from "../viewer.types.js";

const HYDE_PUBLIC_SENSITIVE_FIELDS = [
  "caseId",
  "candidateId",
  "mapping",
  "mappings",
  "privateKey",
  "hmacSecret",
  "judgment",
  "judgments",
  "decision",
  "decisions",
  "resolvedAdjudication",
  "reasoning",
  "rawReasoning",
  "detail",
  "headers",
  "authorization",
  "embedding",
  "embeddings",
  "secret",
  "secrets",
] as const;

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function field(label: string, value: string | number): ViewerField {
  return { label, value: String(value) };
}

/** Explicit adapter for the cryptographically validated HyDE blind public batch only. */
export const HYDE_BLIND_PUBLIC_BATCH_ADAPTER: ViewerAdapter = {
  id: "hyde-blind-public-batch-v4",
  artifactType: HYDE_BLIND_PUBLIC_BATCH_ARTIFACT_TYPE,
  schemaVersion: HYDE_ARTIFACT_SCHEMA_VERSION,
  sensitiveFields: HYDE_PUBLIC_SENSITIVE_FIELDS,
  adapt(value, context): ViewerDocument {
    const batch = parseHydeBlindPublicBatch(value);
    const items = [...batch.items].sort((left, right) => compareAscii(left.opaqueId, right.opaqueId));
    const candidateCount = items.filter((item) => item.taskKind === HYDE_CANDIDATE_TASK_KIND).length;
    const groundingCount = items.filter((item) => item.taskKind === HYDE_GROUNDING_TASK_KIND).length;

    return {
      viewerSchemaVersion: 1,
      kind: "hyde-public-blind-batch",
      adapterId: HYDE_BLIND_PUBLIC_BATCH_ADAPTER.id,
      title: "HyDE Blind Public Batch",
      source: { sha256: context.source.sha256, byteLength: context.source.byteLength },
      artifact: [
        field("Artifact type", batch.artifactType),
        field("Schema version", batch.schemaVersion),
        field("Rubric version", batch.rubricVersion),
      ],
      provenance: [
        field("Study ID", batch.studyId),
        field("Created at", batch.createdAt),
        field("Collection fingerprint", batch.collectionFingerprint),
        field("Corpus fingerprint", batch.corpusFingerprint),
        field("Config fingerprint", batch.configFingerprint),
        field("Batch fingerprint", batch.batchFingerprint),
      ],
      completeness: [
        field("Item count", items.length),
        field("Candidate relevance items", candidateCount),
        field("Document grounding items", groundingCount),
      ],
      summary: [
        field("Task kinds", [HYDE_CANDIDATE_TASK_KIND, HYDE_GROUNDING_TASK_KIND].join(", ")),
      ],
      aggregatePassRate: null,
      rules: [
        { id: HYDE_CANDIDATE_TASK_KIND, itemCount: candidateCount, passRate: null },
        { id: HYDE_GROUNDING_TASK_KIND, itemCount: groundingCount, passRate: null },
      ].sort((left, right) => compareAscii(left.id, right.id)),
      items: items.map((item): ViewerItem => ({
        id: item.opaqueId,
        group: item.taskKind,
        state: "unjudged",
        fields: [
          field("Rubric", item.rubric),
          field("Source text", item.sourceText),
          field("Item text", item.itemText),
        ],
        diagnostics: [],
        diagnosticsAvailable: false,
        executionRuns: [],
        executionAvailable: false,
      })),
    };
  },
};
