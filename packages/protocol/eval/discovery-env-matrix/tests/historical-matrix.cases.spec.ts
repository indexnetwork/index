import { describe, expect, it } from "bun:test";

import { HISTORICAL_MATRIX_CASES, matrixModelInput, validateHistoricalMatrixCases } from "../historical-matrix.cases.js";
import type { HistoricalMatrixCase } from "../historical-matrix.types.js";
import { HISTORICAL_CASES } from "../../matching/matching.historical.js";

function mutableCases(): HistoricalMatrixCase[] {
  return structuredClone(HISTORICAL_MATRIX_CASES) as HistoricalMatrixCase[];
}

describe("historical discovery environment matrix fixtures", () => {
  it("adapts exactly the five committed Tier-3 historical cases", () => {
    expect(HISTORICAL_MATRIX_CASES).toHaveLength(5);
    expect(HISTORICAL_MATRIX_CASES.map((c) => c.id)).toEqual(HISTORICAL_CASES.map((c) => c.id));
  });

  it("gives every participant an intent with auditable basis when reconstructed", () => {
    for (const c of HISTORICAL_MATRIX_CASES) {
      for (const p of c.participants) {
        expect(p.intent.text.trim()).not.toBe("");
        if (p.intent.kind === "historically_grounded_reconstruction") {
          expect(p.intent.basis.length).toBeGreaterThan(0);
          expect(p.intent.basis.every((quote) => p.profileText.includes(quote))).toBe(true);
        }
      }
    }
  });

  it("keeps report-only names and reconstruction provenance out of model input", () => {
    const input = matrixModelInput(HISTORICAL_MATRIX_CASES[0]!);
    expect(JSON.stringify(input)).not.toContain("Steve Jobs");
    expect(JSON.stringify(input)).not.toContain("basis");
    expect(JSON.stringify(input)).not.toContain("historically_grounded_reconstruction");
  });

  it("freezes the adapted fixture graph", () => {
    const matrixCase = HISTORICAL_MATRIX_CASES[0]!;
    expect(Object.isFrozen(HISTORICAL_MATRIX_CASES)).toBe(true);
    expect(Object.isFrozen(matrixCase)).toBe(true);
    expect(Object.isFrozen(matrixCase.participants)).toBe(true);
    expect(Object.isFrozen(matrixCase.participants[0]!.intent)).toBe(true);
  });

  it("rejects invalid references, intent provenance, and model-input report names", () => {
    const duplicateIds = mutableCases();
    duplicateIds[1]!.id = duplicateIds[0]!.id;
    expect(() => validateHistoricalMatrixCases(duplicateIds)).toThrow("Duplicate historical matrix case id");

    const missingSource = mutableCases();
    missingSource[0]!.sourceUserId = "missing-user";
    expect(() => validateHistoricalMatrixCases(missingSource)).toThrow("sourceUserId is not a participant");

    const emptyIntent = mutableCases();
    emptyIntent[0]!.participants[0]!.intent.text = " ";
    expect(() => validateHistoricalMatrixCases(emptyIntent)).toThrow("has an empty intent");

    const invalidBasis = mutableCases();
    const reconstruction = invalidBasis[0]!.participants.find((participant) => participant.intent.kind === "historically_grounded_reconstruction")!;
    reconstruction.intent.basis = ["not present in profile text"];
    expect(() => validateHistoricalMatrixCases(invalidBasis)).toThrow("reconstruction basis is not present in profileText");

    const missingTarget = mutableCases();
    missingTarget[0]!.expectedUserId = "";
    expect(() => validateHistoricalMatrixCases(missingTarget)).toThrow("missing expected target");

    const excludedTarget = mutableCases();
    excludedTarget[0]!.excludedUserIds.push(excludedTarget[0]!.expectedUserId);
    expect(() => validateHistoricalMatrixCases(excludedTarget)).toThrow("expected target is excluded");

    const missingReportNameUser = mutableCases();
    missingReportNameUser[0]!.reportNames = { missing: "Report-only name" };
    expect(() => validateHistoricalMatrixCases(missingReportNameUser)).toThrow("reportNames userId missing is not a participant");

    const reportNameLeak = mutableCases();
    reportNameLeak[0]!.reportNames = {
      [reportNameLeak[0]!.sourceUserId]: reportNameLeak[0]!.participants[0]!.profileText,
    };
    expect(() => validateHistoricalMatrixCases(reportNameLeak)).toThrow("report name is present in matrixModelInput");
  });
});
