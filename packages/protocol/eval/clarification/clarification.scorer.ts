import type { IntentClarifierOutput } from "../../src/intent/intent.clarifier.js";

import type { ClarificationCase, ClarificationResult } from "./clarification.types.js";

/** Score a clarification output by exact taxonomy equality, including null. */
export function scoreCase(
  c: ClarificationCase,
  output: IntentClarifierOutput,
): ClarificationResult {
  return {
    caseId: c.id,
    expectedType: c.expectedType,
    actualType: output.underspecificationType,
    passed: output.underspecificationType === c.expectedType,
    output,
  };
}
