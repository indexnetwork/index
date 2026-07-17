import { describe, expect, it } from "bun:test";
import path from "node:path";

import { EVAL_BASELINE_ARTIFACT_TYPE, EVAL_LEGACY_UNAVAILABLE } from "../artifact.js";
import { readEvalArtifact } from "../artifact.io.js";

/**
 * Every committed baseline must be a valid versioned envelope. This is the
 * provider-free guard that keeps the explicit legacy migration honest: the
 * payloads validate under the full consistency rules (identical
 * case/rule/run/pass values were asserted at conversion time via the git
 * diff), and provenance that could not be reconstructed carries explicit
 * sentinels instead of fabricated values.
 */
const COMMITTED_BASELINES = ["matching", "premise", "profile", "opportunity"] as const;

describe("committed baselines are versioned artifacts", () => {
  for (const harness of COMMITTED_BASELINES) {
    it(`${harness} baseline validates as a v1 baseline envelope`, async () => {
      const baselinePath = path.resolve(import.meta.dir, `../../${harness}/baselines/${harness}.baseline.json`);
      const envelope = await readEvalArtifact(baselinePath, {
        expectedType: EVAL_BASELINE_ARTIFACT_TYPE,
        expectedHarness: harness,
      });
      expect(envelope).not.toBeNull();
      expect(envelope!.schemaVersion).toBe(1);
      expect(envelope!.source).toBe("legacy-migration");
      expect(envelope!.corpusFingerprint).toBe(EVAL_LEGACY_UNAVAILABLE);
      expect(envelope!.selection).toEqual({ fullCorpus: true, filters: {} });
      expect(envelope!.completeness.caseCount).toBe(envelope!.payload.cases.length);
      expect(envelope!.completeness.totalPasses).toBeLessThanOrEqual(envelope!.completeness.totalRuns);
    });
  }
});
