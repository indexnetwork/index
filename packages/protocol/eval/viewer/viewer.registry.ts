import { EVAL_ARTIFACT_SCHEMA_VERSION_V1, EVAL_ARTIFACT_SCHEMA_VERSION_V2, EVAL_BASELINE_ARTIFACT_TYPE, EVAL_RUN_REPORT_ARTIFACT_TYPE } from "../shared/artifact.js";
import { HYDE_BLIND_PUBLIC_BATCH_ARTIFACT_TYPE } from "../hyde/hyde.schemas.js";
import { HYDE_ARTIFACT_SCHEMA_VERSION } from "../hyde/hyde.policy.js";
import { HYDE_BLIND_PUBLIC_BATCH_ADAPTER, SHARED_SCORECARD_ADAPTERS } from "./adapters/index.js";
import { assertArtifactIsNotProhibited, assertPublicProjection, isViewerRecord, viewerArtifactType } from "./viewer.redaction.js";
import type { ViewerAdapter, ViewerAdapterContext, ViewerDocument } from "./viewer.types.js";
import { ViewerSafeError } from "./viewer.types.js";

const SHARED_ARTIFACT_TYPES = new Set([
  EVAL_BASELINE_ARTIFACT_TYPE,
  EVAL_RUN_REPORT_ARTIFACT_TYPE,
]);
const SHARED_HARNESSES = new Set(["matching", "profile", "premise", "opportunity"]);
const SHARED_SCHEMA_VERSIONS = new Set<number>([
  EVAL_ARTIFACT_SCHEMA_VERSION_V1,
  EVAL_ARTIFACT_SCHEMA_VERSION_V2,
]);
const SHARED_HARNESS_VERSION = "1";

/** Immutable registry of every artifact shape the public viewer can classify. */
export const VIEWER_ADAPTERS: readonly ViewerAdapter[] = Object.freeze([
  ...SHARED_SCORECARD_ADAPTERS,
  HYDE_BLIND_PUBLIC_BATCH_ADAPTER,
]);

function malformedDiscriminants(): never {
  throw new ViewerSafeError(
    "malformed-input",
    "The input does not contain a complete supported artifact identity. No artifact content was rendered.",
  );
}

function incompatibleVersion(): never {
  throw new ViewerSafeError(
    "incompatible-artifact",
    "The artifact type is known, but its schema or harness version is not supported by this viewer build.",
  );
}

/**
 * Resolves an adapter only for an exact, allowlisted type/version/harness tuple.
 * Prohibited HyDE boundaries are rejected before any other classification.
 *
 * @param value - Untrusted parsed JSON.
 * @returns The sole adapter registered for the exact artifact identity.
 * @throws ViewerSafeError when the artifact is malformed, prohibited, incompatible, or unsupported.
 */
export function resolveViewerAdapter(value: unknown): ViewerAdapter {
  assertArtifactIsNotProhibited(value);
  if (!isViewerRecord(value)) malformedDiscriminants();

  const artifactType = viewerArtifactType(value);
  if (artifactType === null) malformedDiscriminants();

  if (SHARED_ARTIFACT_TYPES.has(artifactType)) {
    if (
      typeof value.schemaVersion !== "number"
      || !SHARED_SCHEMA_VERSIONS.has(value.schemaVersion)
      || typeof value.harness !== "string"
      || typeof value.harnessVersion !== "string"
    ) {
      incompatibleVersion();
    }
    if (!SHARED_HARNESSES.has(value.harness)) {
      throw new ViewerSafeError(
        "unsupported-artifact",
        "This shared eval harness does not have an explicit public presentation adapter.",
      );
    }
    if (value.harnessVersion !== SHARED_HARNESS_VERSION) incompatibleVersion();

    const adapters = VIEWER_ADAPTERS.filter((candidate) =>
      candidate.artifactType === artifactType
      && candidate.schemaVersion === value.schemaVersion
      && candidate.harness === value.harness
      && candidate.harnessVersion === value.harnessVersion);
    if (adapters.length === 1) return adapters[0];
    throw new ViewerSafeError(
      "unsupported-artifact",
      "No explicit public presentation adapter is registered for this artifact.",
    );
  }

  if (artifactType === HYDE_BLIND_PUBLIC_BATCH_ARTIFACT_TYPE) {
    if (value.schemaVersion !== HYDE_ARTIFACT_SCHEMA_VERSION) incompatibleVersion();
    return HYDE_BLIND_PUBLIC_BATCH_ADAPTER;
  }

  throw new ViewerSafeError(
    "unsupported-artifact",
    "No explicit public presentation adapter is registered for this artifact.",
  );
}

/**
 * Validates and projects an untrusted artifact into the fixed public viewer model.
 * Internal parser and projection errors are replaced with source-free guidance.
 *
 * @param value - Untrusted parsed artifact JSON.
 * @param context - Digest-only source metadata supplied by the caller.
 * @returns A deterministic, allowlisted viewer document.
 * @throws ViewerSafeError with public-safe text for every failure path.
 */
export function adaptViewerArtifact(value: unknown, context: ViewerAdapterContext): ViewerDocument {
  try {
    const adapter = resolveViewerAdapter(value);
    const document = adapter.adapt(value, context);
    assertPublicProjection(document, adapter);
    return document;
  } catch (error) {
    if (error instanceof ViewerSafeError) throw error;
    throw new ViewerSafeError(
      "malformed-input",
      "The artifact failed validation and could not be displayed safely. No source content was rendered.",
    );
  }
}
