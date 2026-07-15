import type { IntentClarifierOutput } from "../../src/intent/intent.clarifier.js";

import type { ClarificationCase, ClarificationResult } from "./clarification.types.js";

/** Score a clarification output by exact taxonomy equality, including null. */
export function scoreCase(
  c: ClarificationCase,
  output: IntentClarifierOutput,
): ClarificationResult {
  const classificationMatches = output.underspecificationType === c.expectedType;
  const clarificationDecisionMatches = output.needsClarification === (c.expectedType !== null);
  const fallbackFailure = output.reason === "fallback_on_model_error";
  return {
    caseId: c.id,
    expectedType: c.expectedType,
    actualType: output.underspecificationType,
    passed: classificationMatches && clarificationDecisionMatches && !fallbackFailure,
    output,
  };
}
