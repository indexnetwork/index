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
  const contentComplete = output.needsClarification
    ? output.suggestedDescription.trim().length > 0 && output.clarificationMessage.trim().length > 0
    : true;
  const normalizedMessage = output.clarificationMessage?.toLowerCase() ?? "";
  const expectedTermsPresent = (c.expectedQuestionTerms ?? []).every((term) =>
    normalizedMessage.includes(term.toLowerCase()),
  );
  return {
    caseId: c.id,
    expectedType: c.expectedType,
    actualType: output.underspecificationType,
    passed: classificationMatches
      && clarificationDecisionMatches
      && !fallbackFailure
      && contentComplete
      && expectedTermsPresent,
    output,
  };
}
