#!/usr/bin/env bun
/**
 * Explicit, reviewable conversion of legacy (pre-envelope) committed baselines
 * into versioned `index-eval/baseline` artifacts.
 *
 * Usage (from packages/protocol):
 *   bun eval/shared/migrate-legacy-baselines.ts            # dry-run: report what would change
 *   bun eval/shared/migrate-legacy-baselines.ts --write    # convert in place (review the git diff)
 *
 * The scorecard payload is carried over byte-for-byte in value terms —
 * identical case/rule/run/pass numbers — and the conversion is validated
 * before anything is written. Provenance that cannot be reconstructed
 * (corpus/config fingerprints, git revision) is marked with explicit
 * legacy-migration sentinels; nothing is fabricated and nothing is cast
 * silently. Already-converted baselines are reported and skipped.
 */
import path from "node:path";

import { looksLikeLegacyScorecard, migrateLegacyBaseline } from "./artifact.js";
import { writeEvalArtifact } from "./artifact.io.js";
import { has } from "./cli.js";

/** Every baseline-backed harness with a committed baseline. */
const COMMITTED_BASELINES = [
  { harness: "matching", harnessVersion: "1" },
  { harness: "premise", harnessVersion: "1" },
  { harness: "profile", harnessVersion: "1" },
  { harness: "opportunity", harnessVersion: "1" },
] as const;

async function main(): Promise<void> {
  const write = has("--write");
  let failures = 0;

  for (const { harness, harnessVersion } of COMMITTED_BASELINES) {
    const baselinePath = path.resolve(import.meta.dir, `../${harness}/baselines/${harness}.baseline.json`);
    const file = Bun.file(baselinePath);
    if (!(await file.exists())) {
      console.log(`- ${harness}: no committed baseline at ${baselinePath}; skipping`);
      continue;
    }
    let value: unknown;
    try {
      value = await file.json();
    } catch {
      console.error(`✗ ${harness}: ${baselinePath} is not valid JSON; refusing to migrate`);
      failures += 1;
      continue;
    }
    if (!looksLikeLegacyScorecard(value)) {
      console.log(`- ${harness}: already a versioned artifact; skipping`);
      continue;
    }
    try {
      const envelope = migrateLegacyBaseline(value, { harness, harnessVersion });
      if (write) {
        // In-place conversion is the sanctioned input==output flow of this
        // script; the git diff is the review surface.
        await writeEvalArtifact(baselinePath, envelope, { force: true });
        console.log(`✓ ${harness}: converted ${baselinePath} (schema v${envelope.schemaVersion}, `
          + `${envelope.completeness.caseCount} cases, ${envelope.completeness.totalPasses}/${envelope.completeness.totalRuns} passes)`);
      } else {
        console.log(`~ ${harness}: would convert ${baselinePath} (schema v${envelope.schemaVersion}, `
          + `${envelope.completeness.caseCount} cases, ${envelope.completeness.totalPasses}/${envelope.completeness.totalRuns} passes)`);
      }
    } catch (err) {
      console.error(`✗ ${harness}: ${err instanceof Error ? err.message : String(err)}`);
      failures += 1;
    }
  }

  if (!write) console.log("\nDry run only. Re-run with --write to convert, then review the git diff.");
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
