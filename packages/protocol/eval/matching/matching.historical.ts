import { historicalMatchingCaseProjection, validateHistoricalQualityCase, type HistoricalQualityCase } from "../discovery-env-matrix/historical-quality.corpus.js";
import { HISTORICAL_CASE_01 } from "./historical/historical.case-01.js";
import { HISTORICAL_CASE_02 } from "./historical/historical.case-02.js";
import { HISTORICAL_CASE_03 } from "./historical/historical.case-03.js";
import { HISTORICAL_CASE_04 } from "./historical/historical.case-04.js";
import { HISTORICAL_CASE_05 } from "./historical/historical.case-05.js";

export const HISTORICAL_QUALITY_CASES = Object.freeze([
  HISTORICAL_CASE_01,
  HISTORICAL_CASE_02,
  HISTORICAL_CASE_03,
  HISTORICAL_CASE_04,
  HISTORICAL_CASE_05,
] satisfies HistoricalQualityCase[]);

for (const historicalCase of HISTORICAL_QUALITY_CASES) {
  validateHistoricalQualityCase(historicalCase);
}

export const HISTORICAL_CASES = Object.freeze(
  HISTORICAL_QUALITY_CASES.map(historicalMatchingCaseProjection),
);
