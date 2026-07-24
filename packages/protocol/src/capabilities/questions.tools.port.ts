import type { ToolRegistryCompositionDeps } from "../shared/agent/tool.helpers.js";

/** Host capabilities consumed by asynchronous question delivery tools. */
export type QuestionerToolDeps = Pick<ToolRegistryCompositionDeps,
  "answerPendingQuestion" | "findPendingQuestions" | "reportToolError"
>;

/** Host capabilities consumed by the blocking, chat-only question tool. */
export type AskUserQuestionToolDeps = Pick<ToolRegistryCompositionDeps,
  "chatQuestions" | "chatSession" | "getUserContextText"
>;
