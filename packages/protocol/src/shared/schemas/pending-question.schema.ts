/**
 * Lightweight projection of a persisted question, suitable for embedding
 * in tool results. Omits internal fields (actors, answer, status) that
 * are not needed by the chat agent or MCP client.
 */
import type { QuestionMode } from "./question.schema.js";

export interface PendingQuestionSummary {
  id: string;
  title: string;
  prompt: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
  mode: QuestionMode;
  sourceType: string;
  sourceId: string;
  createdAt: string;
  expiresAt?: string;
  /** Internal actor projection used for defense-in-depth scoped filtering; tool responses strip it before returning. */
  actors?: Array<{ userId: string; networkId?: string }>;
}
