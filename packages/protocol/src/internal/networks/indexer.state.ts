import type { IntentIndexingResult } from "../../protocol/core.js";
import type { DebugMetaAgent } from "../../protocol/core.js";

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
export interface IntentNetworkState {
  /** User performing the action. Always required. */
  userId: string;
  /** Target network for assign/read-by-network. From ChatGraph or tool arg. */
  networkId: string | undefined;
  /** Target intent for assign/read-by-intent. From tool arg. */
  intentId: string | undefined;
  /** Operation mode. */
  operationMode: 'create' | 'read' | 'delete';
  /** When true, skip LLM evaluation and assign directly (manual_override). When false, run IntentIndexer evaluation (automatic mode). */
  skipEvaluation: boolean;
  /** Intent payload and metadata.  Null if intent not found. */
  intent: IntentForIndexing | null;
  /** Network + member context.  Null if user not eligible. */
  indexContext: IndexMemberContext | null;
  /** LLM evaluation result from IntentIndexer.  Null if evaluation was skipped. */
  evaluation: IntentIndexingResult | null;
  /** Final decision: should intent be in this network? */
  shouldAssign: boolean | undefined;
  /** Final score used for decision (0–1). */
  finalScore: number | undefined;
  /** Result of the assignment persistence operation. */
  assignmentResult: AssignmentResult | null;
  /** For read-by-network: pass userId when listing one user's intents in a network. */
  queryUserId: string | undefined;
  /** Output for read mode. */
  readResult: {
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
  } | undefined;
  /** Output for create/delete modes. */
  mutationResult: {
    success: boolean;
    message?: string;
    error?: string;
  } | undefined;
  /** Error message. */
  error: string | null;
  /** Timing records for each agent invocation within this graph run. */
  agentTimings: DebugMetaAgent[];
}

export function intentNetworkDefaults(): IntentNetworkState {
  return {
    userId: "",
    networkId: undefined,
    intentId: undefined,
    operationMode: 'read' as const,
    skipEvaluation: true,
    intent: null,
    indexContext: null,
    evaluation: null,
    shouldAssign: undefined,
    finalScore: undefined,
    assignmentResult: null,
    queryUserId: undefined,
    readResult: undefined,
    mutationResult: undefined,
    error: null,
    agentTimings: [],
  };
}

