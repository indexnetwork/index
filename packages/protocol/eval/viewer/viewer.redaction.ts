import type { ViewerAdapter, ViewerDocument, ViewerFailure, ViewerSourceSummary } from "./viewer.types.js";
import { ViewerSafeError } from "./viewer.types.js";

const PROHIBITED_HYDE_TYPES = new Set([
  "hyde-evidence-collection",
  "hyde-blind-private-key",
  "hyde-independent-judgment",
  "hyde-resolver-decisions",
  "hyde-resolved-adjudication",
  "hyde-evidence-analysis",
]);

const PROHIBITED_HYDE_TYPE_FRAGMENT = /(private|judgment|resolver|adjudicat|collection|analysis|unblind|mapping|secret|key)/i;

const PROHIBITED_PROJECTION_KEYS = new Set([
  "rawReasoning",
  "reasoning",
  "detail",
  "error",
  "piiHits",
  "secret",
  "secrets",
  "apiKey",
  "authorization",
  "headers",
  "embedding",
  "embeddings",
  "mapping",
  "mappings",
  "hmacSecret",
  "judgment",
  "judgments",
  "decision",
  "decisions",
  "resolvedAdjudication",
  "privateKey",
  "candidateId",
  "caseId",
]);

/** True when a value is a non-array JSON object. */
export function isViewerRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns an artifact discriminant without inspecting any other source fields. */
export function viewerArtifactType(value: unknown): string | null {
  return isViewerRecord(value) && typeof value.artifactType === "string" ? value.artifactType : null;
}

/**
 * Rejects every known or plausibly future private HyDE artifact before parsing.
 * Error text intentionally never echoes the source discriminant.
 */
export function assertArtifactIsNotProhibited(value: unknown): void {
  const artifactType = viewerArtifactType(value);
  if (
    artifactType !== null
    && artifactType.startsWith("hyde-")
    && (PROHIBITED_HYDE_TYPES.has(artifactType) || PROHIBITED_HYDE_TYPE_FRAGMENT.test(artifactType))
  ) {
    throw new ViewerSafeError(
      "prohibited-artifact",
      "This HyDE artifact is private or unblinding-capable and cannot be opened by the public viewer. Use only a validated blind public batch.",
    );
  }
}

function assertNoProhibitedKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoProhibitedKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!isViewerRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (PROHIBITED_PROJECTION_KEYS.has(key)) {
      throw new Error(`Unsafe viewer projection key at ${path}.${key}`);
    }
    assertNoProhibitedKeys(entry, `${path}.${key}`);
  }
}

/**
 * Defense-in-depth check over the adapter projection. The fixed viewer model is
 * already allowlisted; this catches accidental runtime additions before HTML.
 */
export function assertPublicProjection(document: ViewerDocument, adapter: ViewerAdapter): void {
  if (document.adapterId !== adapter.id) throw new Error("Viewer adapter identity mismatch");
  assertNoProhibitedKeys(document, "viewer");
  const serialized = JSON.stringify(document);
  for (const field of adapter.sensitiveFields) {
    const keyToken = `"${field}":`;
    if (serialized.includes(keyToken)) {
      throw new Error(`Adapter projected declared-sensitive field ${field}`);
    }
  }
}

/** Converts any internal failure into deterministic public-safe display data. */
export function toViewerFailure(error: unknown, source?: ViewerSourceSummary): ViewerFailure {
  if (error instanceof ViewerSafeError) {
    return {
      code: error.code,
      title: "Artifact could not be displayed safely",
      message: error.message,
      source,
    };
  }
  return {
    code: "malformed-input",
    title: "Artifact could not be displayed safely",
    message: "The input is malformed, incompatible, or failed validation. No artifact content was rendered.",
    source,
  };
}
