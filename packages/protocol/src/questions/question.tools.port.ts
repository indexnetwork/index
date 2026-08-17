/**
 * questions/question.tools.port — host capabilities injected into question tools.
 *
 * Declares the narrow port types consumed by the foreground adapter tools
 * (question delivery and chat-inline ask_user_question) without importing
 * the full ToolRegistryCompositionDeps interface.
 */
import type { ToolRegistryCompositionDeps } from "../shared/agent/tool.helpers.js";

/** Host capabilities consumed by asynchronous question delivery tools. */
export type QuestionerToolDeps = Pick<ToolRegistryCompositionDeps,
  "answerPendingQuestion" | "findPendingQuestions" | "reportToolError"
>;

/** Host capabilities consumed by the blocking, chat-only question tool. */
export type AskUserQuestionToolDeps = Pick<ToolRegistryCompositionDeps,
  "chatQuestions" | "chatSession" | "getUserContextText"
>;
