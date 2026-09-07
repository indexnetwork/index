import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { InferredIntent } from "../intent.inferrer.js";
import { SemanticVerifierOutput } from "../intent.verifier.js";
import { NormalizedIntentAction } from "../intent.reconciler.js";
import type { DebugMetaAgent } from "../../../protocol/core.js";
import type { ToolScopeType } from '../../shared/agent/tool.scope.js';
import type { IntentLifecycleStatus } from "../../../platform/database.js";

/**
 * Extended InferredIntent that includes verification results.
 * We attach the verification output directly to the intent object
 * as it flows through the graph.
 */
export type VerifiedIntent = InferredIntent & {
  verification?: SemanticVerifierOutput;
  score?: number; // Calculated min(authority, sincerity, clarity)
};

export type IntentValidationFailureCategory =
  | 'non_actionable'
  | 'vague_or_invalid'
  | 'verification_failure'
  | 'update_target_boundary'
  | 'reconciliation_boundary';

export interface IntentValidationFailure {
  category: IntentValidationFailureCategory;
  message: string;
  classification?: string;
  referentialBreadth?: 'narrow' | 'moderate' | 'broad';
}

/**
 * Result of executing a single reconciler action.
 */
export interface ExecutionResult {
  /** The action type that was executed */
  actionType: 'create' | 'update' | 'expire' | 'transition';
  /** Whether the action succeeded */
  success: boolean;
  /** The intent ID (created/updated/archived) */
  intentId?: string;
  /** Final payload (sanitized, for create/update) */
  payload?: string;
  /** Error message if failed. For transition this is the outcome's `kind`. */
  error?: string;
  /** Networks the created intent was linked to, for a `create` action. */
  linkedNetworkIds?: string[];
}

/** A deterministic pause/resume action, bypassing the LLM reconciler. */
export interface TransitionIntentAction {
  type: 'transition';
  id: string;
  status: 'ACTIVE' | 'PAUSED';
}

/** Every action kind the executor can carry out. */
export type IntentGraphAction = NormalizedIntentAction | TransitionIntentAction;

/** Outcome of a `transition` action, mirroring the adapter's discriminated result plus the enqueue-failure compensation case. */
export type TransitionOutcome =
  | { kind: 'success'; id: string; status: 'ACTIVE' | 'PAUSED'; changed: boolean; lifecycleVersionMs: number }
  | { kind: 'not_found' }
  | { kind: 'scope_violation' }
  | { kind: 'stale' }
  | { kind: 'conflict'; status: IntentLifecycleStatus | null; archived: boolean }
  | { kind: 'enqueue_failed'; id: string; status: IntentLifecycleStatus; lifecycleVersionMs: number };

/**
 * The Graph State using LangGraph Annotations.
 * This acts as the central bus for data flowing through our graph.
 */
export const IntentGraphState = Annotation.Root({
  // --- Inputs (Required at start) ---

  /**
   * The unique identifier of the user whose intents are being processed.
   * Required for database operations.
   */
  userId: Annotation<string>,

  /**
   * The user's profile context (Identity, Narrative, etc.)
   */
  userProfile: Annotation<string>,

  /**
   * Explicit input content (e.g., user message).
   * Optional - graph might run on implicit only.
   */
  inputContent: Annotation<string | undefined>,

  /**
   * Conversation history for context-aware intent inference.
   * Used to resolve anaphoric references ("that intent", "this goal").
   * Limited to recent messages (typically last 10) for token efficiency.
   * Optional - if not provided, intent inference uses only inputContent.
   */
  conversationContext: Annotation<BaseMessage[] | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /**
   * The graph routes on the shape of its input, not a mode flag:
   * - `inputContent` alone → create path (infer → verify → reconcile → execute)
   * - `inputContent` + `targetIntentIds` → explicit update, bound to that one id
   * - `targetIntentIds` + `archive: true` → expire those ids, no LLM
   * - `targetIntentIds` + `status` → pause/resume, no LLM
   * - none of the above → read (query fast path)
   * Exactly one of {content, archive, status} may be set per invoke.
   */
  targetIntentIds: Annotation<string[] | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Archive route: expire every id in `targetIntentIds`. Requires `targetIntentIds`. */
  archive: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  /** Transition route: pause/resume the single id in `targetIntentIds`. Requires `targetIntentIds`. */
  status: Annotation<'ACTIVE' | 'PAUSED' | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /**
   * Optional material compare-and-set guard used only by recovery-answer
   * updates. The database rechecks it while holding the final intent row lock.
   */
  expectedIntentFingerprint: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /**
   * Optional network scope (network ID) for read operations. Prep always
   * fetches ALL user intents via getActiveIntents(userId) regardless of network
   * scope (for global dedup/reconciliation).
   */
  networkId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /**
   * Create route: the networks a newly created intent is linked to. Exactly
   * this list is written to `intent_networks`, each one membership-checked;
   * nothing is inferred or scored. An empty list creates an unlinked intent.
   */
  networkIds: Annotation<string[] | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Focused request scope type for write-side assignment and follow-up queues. */
  scopeType: Annotation<ToolScopeType | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Focused request scope id. When scopeType is `network`, this is the focused network id. */
  scopeId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  // --- Populated by Graph (Prep Node) ---

  /**
   * The formatted string of currently active intents.
   * Always populated by prep via getActiveIntents(userId).
   */
  activeIntents: Annotation<string>({
    reducer: (curr, next) => next,
    default: () => "",
  }),

  /** IDs of active intents owned by the graph user, used to fail closed on explicit updates. */
  activeIntentIds: Annotation<string[]>({
    reducer: (curr, next) => next,
    default: () => [],
  }),

  // --- Intermediate State ---

  /**
   * List of raw intents extracted from text.
   */
  inferredIntents: Annotation<InferredIntent[]>({
    reducer: (curr, next) => next, // Overwrite with new inference
    default: () => [],
  }),

  /**
   * List of intents that have passed semantic verification.
   * Invalid intents are filtered out before reaching this state.
   */
  verifiedIntents: Annotation<VerifiedIntent[]>({
    reducer: (curr, next) => next,
    default: () => [],
  }),

  /** Structured reasons for candidates rejected before persistence. */
  validationFailures: Annotation<IntentValidationFailure[]>({
    reducer: (curr, next) => next,
    default: () => [],
  }),

  // --- Output ---

  /**
   * Final actions to be performed on the DB (Create, Update, Expire, Transition).
   */
  actions: Annotation<IntentGraphAction[]>({
    reducer: (curr, next) => next,
    default: () => [],
  }),

  /**
   * Results of executing actions against the database.
   * Populated by executorNode after actions are persisted.
   */
  executionResults: Annotation<ExecutionResult[]>({
    reducer: (curr, next) => next,
    default: () => [],
  }),

  /** Detailed outcome of a `transition` action, for host-side status mapping. */
  transitionResult: Annotation<TransitionOutcome | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  // --- Error State ---

  /**
   * If set, indicates a fatal error that should short-circuit the graph to END.
   * Populated by prep when a precondition fails (e.g. missing profile).
   */
  error: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  // --- Trace Output ---

  /**
   * Accumulated trace entries from each graph node.
   * Used for observability: surfaces internal processing steps (inference,
   * verification with Felicity scores, reconciliation) to the frontend.
   */
  trace: Annotation<Array<{ node: string; detail?: string; data?: Record<string, unknown> }>>({
    reducer: (curr, next) => [...curr, ...(next || [])],
    default: () => [],
  }),

  /** Timing records for each agent invocation within this graph run. */
  agentTimings: Annotation<DebugMetaAgent[]>({
    reducer: (acc, val) => [...acc, ...val],
    default: () => [],
  }),

  // --- Read Mode Fields ---

  /**
   * For read mode: the set of network IDs the caller's agent can reach.
   * When set and neither networkId nor queryUserId is provided, the graph
   * returns the caller's own intents across all networks in this set (scope-aware
   * default path). Derived by the tool layer from the scope envelope plus memberships.
   */
  networkScope: Annotation<string[] | undefined>({
    reducer: (_curr, next) => next,
    default: () => undefined,
  }),

  /**
   * For read mode: filter intents by a specific user when reading in a network.
   * When omitted and network-scoped, returns all intents in the network.
   */
  queryUserId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /**
   * For read mode: when true, return all of the current user's intents
   * ignoring network scope. Used before create_intent to detect duplicates.
   */
  allUserIntents: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  /**
   * Output of read mode: queried intents with count and optional metadata.
   */
  readResult: Annotation<{
    count: number;
    intents: Array<{
      id: string;
      description: string;
      summary: string | null;
      createdAt: Date;
      userId?: string;
      userName?: string | null;
    }>;
    message?: string;
    networkId?: string;
  } | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),
});
