import { describe, expect, it } from "bun:test";

import { HISTORICAL_MATRIX_CASES } from "../../discovery-env-matrix/historical-matrix.cases.js";
import { CASES as MATCHING_CASES } from "../../matching/matching.cases.js";
import { CASES as OPPORTUNITY_CASES } from "../../opportunities/opportunity.cases.js";
import { CASES as PREMISE_CASES } from "../../premises/premise.cases.js";
import { CASES as PROFILE_CASES } from "../../profile/profile.cases.js";
import { HARNESS_REGISTRY, OPS_HARNESSES } from "../ops.registry.js";
import type { OpsHarness } from "../ops.types.js";

/**
 * Pins HARNESS_REGISTRY.caseCount to the corpora it describes.
 *
 * caseCount is not decoration: the launch form multiplies it by the run count to
 * show the workload, and the full-corpus confirmation gate quotes that number as
 * the model invocations the operator is authorising. If a corpus grows and this
 * stays behind, the gate silently understates the spend — degrading the main cost
 * control on a feature whose whole risk is launching expensive runs from a browser.
 *
 * Importing the corpus modules is provider-free and database-free: they are plain
 * data. Each import mirrors what that harness's own eval script imports, so this
 * measures the same selection the CLI would run with no filters.
 */
const CORPORA: Record<OpsHarness, readonly unknown[]> = {
  matching: MATCHING_CASES,
  profile: PROFILE_CASES,
  premise: PREMISE_CASES,
  opportunity: OPPORTUNITY_CASES,
  // discovery runs the historical matrix corpus once per side, so a COMPARISON
  // costs cases x runs x 2 while a single configuration costs cases x runs —
  // renderRun and the launch form both take the multiplier from
  // sidesPerRun(spec) (ops.sides.ts), which reads the run's shape. An
  // understated caseCount is therefore up to twice as expensive here as it is
  // for a scorecard harness.
  discovery: HISTORICAL_MATRIX_CASES,
};

describe("HARNESS_REGISTRY.caseCount", () => {
  it("matches the real corpus size for every harness", () => {
    const declared = Object.fromEntries(OPS_HARNESSES.map((h) => [h, HARNESS_REGISTRY[h].caseCount]));
    // Keyed off CORPORA rather than OPS_HARNESSES so a harness that is missing
    // from the registry entirely fails here too, instead of being skipped.
    const actual = Object.fromEntries(Object.entries(CORPORA).map(([h, cases]) => [h, cases.length]));

    // Compared as whole objects so a failure names every drifted harness at once.
    expect(declared).toEqual(actual);
  });

  it("covers every registered harness, so a new harness cannot skip this check", () => {
    expect(Object.keys(CORPORA).sort()).toEqual([...OPS_HARNESSES].sort());
  });

  it("declares a positive case count for every harness", () => {
    // A zero would make the workload gate read "0 model invocations" and wave
    // through a full-corpus run as though it were free.
    for (const harness of OPS_HARNESSES) {
      expect(HARNESS_REGISTRY[harness].caseCount).toBeGreaterThan(0);
    }
  });
});
