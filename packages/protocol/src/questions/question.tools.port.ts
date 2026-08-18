/**
 * questions/question.tools.port — host capabilities injected into question tools.
 *
 * Declares the narrow port types consumed by the question delivery tools
 * without importing the full ToolRegistryCompositionDeps interface.
 */
import type { ToolRegistryCompositionDeps } from "../shared/agent/tool.helpers.js";

/** Host capabilities consumed by asynchronous question delivery tools. */
export type QuestionerToolDeps = Pick<ToolRegistryCompositionDeps,
  "answerPendingQuestion" | "findPendingQuestions" | "reportToolError"
>;
