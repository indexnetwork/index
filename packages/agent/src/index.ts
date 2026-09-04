// Public API: a personal agent run by a host on someone's behalf. One
// identity, scopeable to an intent, with a loop that can stop to ask the
// party it represents a question.
export { Agent } from "./core/agent.ts";
export type { AgentOptions, RunOptions } from "./core/agent.ts";

export { askUserTool, defaultTools } from "./core/tools.ts";
export type { Tool, ToolContext } from "./core/tools.ts";

export { MemoryMessageStore } from "./core/sessions.ts";
export type { ModelMessage } from "./core/model.ts";

export type {
  AgentIdentity,
  Intent,
  MessageStore,
  PendingQuestion,
  RunEnd,
  RunResult,
  Step,
} from "./core/types.ts";
