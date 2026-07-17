/**
 * Shared test fixtures for the versioned eval artifact envelope. Used by the
 * shared specs and by harness specs that exercise the envelope-backed
 * baseline/run-report writers.
 */
import type { EvalRunMeta } from "../artifact.js";

/** A syntactically valid SHA-256 fingerprint for fixtures. */
export const TEST_FINGERPRINT = "a".repeat(64);

/** A syntactically valid Git revision for fixtures. */
export const TEST_REVISION = "b".repeat(40);

/** A fully populated run meta; override per test. */
export function makeTestMeta(overrides: Partial<EvalRunMeta> = {}): EvalRunMeta {
  return {
    harness: "test-harness",
    harnessVersion: "1",
    models: ["test/model"],
    runs: 1,
    selection: { fullCorpus: true, filters: {} },
    corpusFingerprint: TEST_FINGERPRINT,
    configFingerprint: TEST_FINGERPRINT,
    git: { revision: TEST_REVISION, dirty: false },
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    ...overrides,
  };
}
