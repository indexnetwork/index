import { Annotation } from "@langchain/langgraph";

import type { DebugMetaAgent } from "../../protocol/core.js";

/**
 * Result of executing an assignment decision.
 * Returned from the assign node as a structured output alongside mutationResult.
 */
export interface AssignmentResult {
  networkId: string;
  assigned: boolean;
  success: boolean;
  error?: string;
}

/**
 * Intent Index Graph State.
 * Handles CRUD for the intent_networks junction table (linking intents to networks).
 *
 * ## Signal assignment policy
 *
 * There is none: a link exists because its owner asked for it, so the assign
 * node writes the row at score 1 with mode `manual_override`. No LLM call.
 *
 * Flow:
 * START → router → {
 *   create: assignNode → END
 *   read: readNode → END
 *   delete: unassignNode → END
 * }
 */
export const IntentNetworkGraphState = Annotation.Root({
  // --- Core Inputs (from ToolContext) ---

  /** User performing the action. Always required. */
  userId: Annotation<string>,

  /** Target network for assign/read-by-network. From ToolContext or tool arg. */
  networkId: Annotation<string | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),

  /** Target intent for assign/read-by-intent. From tool arg. */
  intentId: Annotation<string | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),

  /** Operation mode. */
  operationMode: Annotation<'create' | 'read' | 'delete'>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'read' as const,
  }),

  // --- Intermediate State (populated by nodes during graph execution) ---

  /** Result of the assignment persistence operation. */
  assignmentResult: Annotation<AssignmentResult | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // --- Read Mode Controls ---

  /** For read-by-network: pass userId when listing one user's intents in a network. */
  queryUserId: Annotation<string | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),

  // --- Outputs ---

  /** Output for read mode. */
  readResult: Annotation<{
    links: Array<{
      intentId: string;
      networkId: string;
      intentTitle?: string;
      networkTitle?: string;
      userId?: string;
      userName?: string;
      createdAt?: Date;
      relevancyScore?: number | null;
    }>;
    count: number;
    mode: string;
    note?: string;
  } | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),

  /** Output for create/delete modes. */
  mutationResult: Annotation<{
    success: boolean;
    message?: string;
    error?: string;
  } | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),

  /** Error message. */
  error: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  /** Timing records for each agent invocation within this graph run. */
  agentTimings: Annotation<DebugMetaAgent[]>({
    reducer: (acc, val) => [...acc, ...val],
    default: () => [],
  }),
});
