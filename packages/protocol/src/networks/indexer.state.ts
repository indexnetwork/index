import { Annotation } from "@langchain/langgraph";

import type { IntentIndexerOutput } from "../intents/intent.module.js";
import type { DebugMetaAgent } from "../agents/agent.module.js";

/**
 * Intent payload and metadata loaded for network evaluation.
 * Loaded from the database before LLM-based assignment scoring.
 */
export interface IntentForIndexing {
  id: string;
  payload: string;
  userId: string;
  sourceType: string | null;
  sourceId: string | null;
}

/**
 * Index and member prompts for a single network (user must be member with autoAssign).
 * Used by the evaluated assignment path in IntentNetworkGraphFactory.
 */
export interface IndexMemberContext {
  networkId: string;
  indexPrompt: string | null;
  memberPrompt: string | null;
}

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
 * Handles CRUD for the intent_indexes junction table (linking intents to networks).
 *
 * ## Signal assignment policy
 *
 * Two assignment paths, selected via `skipEvaluation`:
 * - `true` (direct / manual_override): writes the link immediately with a fixed
 *   score of 1 and mode `manual_override`.  No LLM call.
 * - `false` (automatic / evaluated): loads intent + network context, calls the
 *   injected indexer, then applies `buildNetworkAssignmentDecision` to produce
 *   the threshold / metadata. A no-prompt fast path skips the LLM when both
 *   prompts are absent.
 *
 * The indexer is injected as a constructor argument — communities never imports
 * signals internals directly.
 *
 * Flow:
 * START → router → {
 *   create: assignNode (direct or evaluated) → END
 *   read: readNode → END
 *   delete: unassignNode → END
 * }
 */
export const IntentNetworkGraphState = Annotation.Root({
  // --- Core Inputs (from ChatGraph via ToolContext) ---

  /** User performing the action. Always required. */
  userId: Annotation<string>,

  /** Target network for assign/read-by-network. From ChatGraph or tool arg. */
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

  // --- Create Mode Controls ---

  /**
   * When true, skip LLM evaluation and assign directly (manual_override).
   * When false, run IntentIndexer evaluation (automatic mode).
   */
  skipEvaluation: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => true,
  }),

  // --- Intermediate State (populated by nodes during graph execution) ---

  /** Intent payload and metadata.  Null if intent not found. */
  intent: Annotation<IntentForIndexing | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  /** Network + member context.  Null if user not eligible. */
  indexContext: Annotation<IndexMemberContext | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  /** LLM evaluation result from IntentIndexer.  Null if evaluation was skipped. */
  evaluation: Annotation<IntentIndexerOutput | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  /** Final decision: should intent be in this network? */
  shouldAssign: Annotation<boolean | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),

  /** Final score used for decision (0–1). */
  finalScore: Annotation<number | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),

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
