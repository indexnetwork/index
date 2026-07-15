import type { IntentClarifierOutput } from "../../src/intent/intent.clarifier.js";
import type { UnderspecificationType } from "../../src/shared/schemas/question.schema.js";

/** One exact-match QUD classification fixture. */
export interface ClarificationCase {
  id: string;
  description: string;
  input: string;
  profileContext: string;
  activeIntentsContext: string;
  expectedType: UnderspecificationType | null;
  /** Terms that must appear in the clarification question to resolve this QUD. */
  expectedQuestionTerms?: string[];
}

/** Minimal live clarifier surface required by the runner. */
export interface ClarifierLike {
  invoke(
    description: string,
    profileContext: string,
    activeIntentsContext: string,
  ): Promise<IntentClarifierOutput>;
}

/** Exact-match scoring result for one clarifier invocation. */
export interface ClarificationResult {
  caseId: string;
  expectedType: UnderspecificationType | null;
  actualType: UnderspecificationType | null;
  passed: boolean;
  output: IntentClarifierOutput;
}
