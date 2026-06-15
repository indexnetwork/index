/**
 * Terminal output module — re-exports from base, markdown, and formatters.
 *
 * Consumers can continue using `import * as output from "./output"` and
 * `import { MarkdownRenderer } from "./output"` unchanged.
 */

export { RESET, BOLD, DIM, ITALIC, RED, GREEN, YELLOW, BLUE, MAGENTA, CYAN, WHITE, GRAY, ORANGE, AGENT_TEXT, USER_PROMPT, error, success, info, warn, dim, heading, chatHeader, PROMPT_STR, raw, status, clearStatus, toolActivity, humanizeToolName, wordWrap, confidenceBar, padTo, stripAnsi } from "./base";

export { MarkdownRenderer } from "./markdown";

export type { ProfileData } from "./formatters";
export { profileCard, contactTable, sessionTable, intentTable, intentCard, opportunityTable, opportunityCard, networkTable, networkCard, memberTable, conversationTable, conversationCard, messageList } from "./formatters";
