import { describe, expect, it } from "bun:test";

import { HISTORICAL_MATRIX_CASES, matrixModelInput, validateHistoricalMatrixCases } from "../historical-matrix.cases.js";
import { historicalModelSafeProjection } from "../historical-quality.corpus.js";
import type { HistoricalMatrixCase } from "../historical-matrix.types.js";
import { HISTORICAL_CASES, HISTORICAL_QUALITY_CASES } from "../../matching/matching.historical.js";

function mutableCases(): HistoricalMatrixCase[] {
  return structuredClone(HISTORICAL_MATRIX_CASES) as HistoricalMatrixCase[];
}

describe("historical discovery environment matrix fixtures", () => {
  it("adapts exactly the five committed Tier-3 historical cases", () => {
    expect(HISTORICAL_MATRIX_CASES).toHaveLength(5);
    expect(HISTORICAL_MATRIX_CASES.map((c) => c.id)).toEqual(HISTORICAL_CASES.map((c) => c.id));
  });

  it("preserves audited network contexts and leaves Case 05 empty pending IND-638 shared-pool review", () => {
    expect(HISTORICAL_MATRIX_CASES.slice(0, 4).map(({ networkContext }) => networkContext)).toEqual(
      HISTORICAL_QUALITY_CASES.slice(0, 4).map((historicalCase) => {
        const source = historicalCase.input.entities.find(({ userId }) => userId === historicalCase.input.discovererId)!;
        return historicalCase.input.networkContexts![source.networkId]!;
      }),
    );
    expect(HISTORICAL_MATRIX_CASES[4]!.networkContext).toBe("");
  });

  it("adapts every matrix intent directly from the audited participant intent", () => {
    for (const [caseIndex, matrixCase] of HISTORICAL_MATRIX_CASES.entries()) {
      const auditedCase = HISTORICAL_QUALITY_CASES[caseIndex]!;
      for (const participant of matrixCase.participants) {
        const entity = auditedCase.input.entities.find(({ userId }) => userId === participant.id)!;
        expect(entity.intents).toHaveLength(1);
        expect(participant.intent).toEqual({ text: entity.intents![0]!.payload });
      }
    }
  });

  it("keeps control IDs and all audit-only strings out of every model boundary", () => {
    const auditKeys = [
      "historicalQuality",
      "claimProvenance",
      "semanticNegatives",
      "anonymizationReview",
      "outcomeCitationIds",
      "citationIds",
      "basisClaimIds",
      "violatedRequirement",
      "basis",
    ];

    for (const [caseIndex, matrixCase] of HISTORICAL_MATRIX_CASES.entries()) {
      const auditedCase = HISTORICAL_QUALITY_CASES[caseIndex]!;
      const input = matrixModelInput(matrixCase);
      expect(input).not.toHaveProperty("id");

      const serializations = [
        JSON.stringify(historicalModelSafeProjection(auditedCase)),
        JSON.stringify(input),
        JSON.stringify(HISTORICAL_CASES[caseIndex]!.input),
      ];
      const forbidden = [
        auditedCase.id,
        ...Object.values(auditedCase.reportNames ?? {}),
        ...auditedCase.historicalQuality.citations.flatMap((citation) => [
          citation.url,
          citation.title,
          citation.publisher,
          citation.excerpt,
        ]),
        ...Object.values(auditedCase.historicalQuality.semanticNegatives),
        ...auditKeys,
      ];

      for (const serialized of serializations) {
        for (const value of forbidden) expect(serialized).not.toContain(value);
      }
    }
  });

  it("freezes the adapted fixture graph", () => {
    const matrixCase = HISTORICAL_MATRIX_CASES[0]!;
    expect(Object.isFrozen(HISTORICAL_MATRIX_CASES)).toBe(true);
    expect(Object.isFrozen(matrixCase)).toBe(true);
    expect(Object.isFrozen(matrixCase.participants)).toBe(true);
    expect(Object.isFrozen(matrixCase.participants[0]!.intent)).toBe(true);
  });

  it("rejects invalid references, empty intents, and model-input report names", () => {
    const duplicateIds = mutableCases();
    duplicateIds[1]!.id = duplicateIds[0]!.id;
    expect(() => validateHistoricalMatrixCases(duplicateIds)).toThrow("Duplicate historical matrix case id");

    const missingSource = mutableCases();
    missingSource[0]!.sourceUserId = "missing-user";
    expect(() => validateHistoricalMatrixCases(missingSource)).toThrow("sourceUserId is not a participant");

    const emptyIntent = mutableCases();
    emptyIntent[0]!.participants[0]!.intent.text = " ";
    expect(() => validateHistoricalMatrixCases(emptyIntent)).toThrow("has an empty intent");

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
