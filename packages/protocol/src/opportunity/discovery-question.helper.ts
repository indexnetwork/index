/**
 * Pure mapper from opportunity-graph outputs + optional chat digest to a
 * `DiscoveryQuestionInput`. No I/O. Side-effect-free.
 */

import type { ChatContextDigest } from "../shared/schemas/chat-context.schema.js";
import type { DiscoveryNegotiationDigest } from "../shared/schemas/negotiation-digest.schema.js";
import type { DiscoveryQuestionInput, DiscoverySummary } from "./question.prompt.js";

export interface BuildDiscoveryQuestionInputArgs {
  query: string;
  /** The seeker's global user_context paragraph (profile-replacing identity text). */
  userContext: string;
  negotiationDigests: DiscoveryNegotiationDigest[];
  summary: DiscoverySummary;
  chatContext?: ChatContextDigest;
  now: string;
}

/** @deprecated Use QuestionerAgent discovery preset instead. Will be removed in a future version. */
export function buildDiscoveryQuestionInput(args: BuildDiscoveryQuestionInputArgs): DiscoveryQuestionInput {
  return {
    query: args.query,
    userContext: args.userContext,
    negotiationDigests: args.negotiationDigests,
    summary: args.summary,
    ...(args.chatContext !== undefined ? { chatContext: args.chatContext } : {}),
    now: args.now,
  };
}
