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
  actionType: 'create' | 'update' | 'expire' | 'transition' | 'confirm';
  /** Whether the action succeeded */
  success: boolean;
  /** The intent ID (created/updated/archived) */
  intentId?: string;
  /** Final payload (sanitized, for create/update) */
  payload?: string;
  /** Error message if failed. For transition/confirm this is the outcome's `kind`. */
  error?: string;
}

/** A deterministic pause/resume action, bypassing the LLM reconciler. */
export interface TransitionIntentAction {
  type: 'transition';
  id: string;
  status: 'ACTIVE' | 'PAUSED';
}

/** A deterministic proposal-confirmation action, bypassing the LLM reconciler. */
export interface ConfirmIntentAction {
  type: 'confirm';
  proposalId: string;
  description: string;
  networkId?: string;
}

/** Every action kind the executor can carry out. */
export type IntentGraphAction = NormalizedIntentAction | TransitionIntentAction | ConfirmIntentAction;

/** Outcome of a `transition` action, mirroring the adapter's discriminated result plus the enqueue-failure compensation case. */
export type TransitionOutcome =
  | { kind: 'success'; id: string; status: 'ACTIVE' | 'PAUSED'; changed: boolean; lifecycleVersionMs: number }
  | { kind: 'not_found' }
  | { kind: 'scope_violation' }
  | { kind: 'stale' }
  | { kind: 'conflict'; status: IntentLifecycleStatus | null; archived: boolean }
  | { kind: 'enqueue_failed'; id: string; status: IntentLifecycleStatus; lifecycleVersionMs: number };

/** Outcome of a `confirm` action. */
export type ConfirmOutcome =
  | { kind: 'created' | 'replay'; intentId: string }
  | { kind: 'missing' | 'expired' | 'consumed' | 'payload_mismatch' | 'analysis_missing' | 'proposal_edit_rejected' }
  | { kind: 'membership_required'; networkId: string }
  | { kind: 'admission_enqueue_failed'; intentId: string };

/**
 * The Graph State using LangGraph Annotations.
 * This acts as the central bus for data flowing through our graph.
 */
export interface IntentState {
  /** The unique identifier of the user whose intents are being processed. Required for database operations. */
  userId: string;
  /** The user's profile context (Identity, Narrative, etc.) */
  userProfile: string;
  /** Explicit input content (e.g., user message). Optional - graph might run on implicit only. */
  inputContent: string | undefined;
  /** Conversation history for context-aware intent inference. Used to resolve anaphoric references ("that intent", "this goal"). Limited to recent messages (typically last 10) for token efficiency. Optional - if not provided, intent inference uses only inputContent. */
  conversationContext: BaseMessage[] | undefined;
  /** The graph routes on the shape of its input, not a mode flag: - `inputContent` alone → create path (infer → verify → reconcile → execute) - `inputContent` + `targetIntentIds` → explicit update, bound to that one id - `targetIntentIds` + `archive: true` → expire those ids, no LLM - `targetIntentIds` + `status` → pause/resume, no LLM - `proposalId` (+ `description`, `networkId`) → confirm a stored proposal, no LLM - none of the above → read (query fast path) Exactly one of {content, archive, status, proposalId} may be set per invoke. */
  targetIntentIds: string[] | undefined;
  /** Archive route: expire every id in `targetIntentIds`. Requires `targetIntentIds`. */
  archive: boolean;
  /** Transition route: pause/resume the single id in `targetIntentIds`. Requires `targetIntentIds`. */
  status: 'ACTIVE' | 'PAUSED' | undefined;
  /** Confirm route: the durable proposal to persist. */
  proposalId: string | undefined;
  /** Confirm route: the caller's (possibly owner-edited) description, compared byte-for-byte against the stored proposal. Never run through inference. */
  description: string | undefined;
  /** When true on the content path, stop after verification — no reconciliation, no writes. Replaces the old `propose` operation mode. */
  dryRun: boolean;
  /** Optional material compare-and-set guard used only by recovery-answer updates. The database rechecks it while holding the final intent row lock. */
  expectedIntentFingerprint: string | undefined;
  /** Optional network scope (network ID). Used for linking created intents to a network and for scoping read operations. Prep always fetches ALL user intents via getActiveIntents(userId) regardless of network scope (for global dedup/reconciliation). */
  networkId: string | undefined;
  /** Focused request scope type for write-side assignment and follow-up queues. */
  scopeType: ToolScopeType | undefined;
  /** Focused request scope id. When scopeType is `network`, this is the focused network id. */
  scopeId: string | undefined;
  /** The formatted string of currently active intents. Always populated by prep via getActiveIntents(userId). */
  activeIntents: string;
  /** IDs of active intents owned by the graph user, used to fail closed on explicit updates. */
  activeIntentIds: string[];
  /** List of raw intents extracted from text. */
  inferredIntents: InferredIntent[];
  /** List of intents that have passed semantic verification. Invalid intents are filtered out before reaching this state. */
  verifiedIntents: VerifiedIntent[];
  /** Structured reasons for candidates rejected before persistence. */
  validationFailures: IntentValidationFailure[];
  /** Final actions to be performed on the DB (Create, Update, Expire, Transition, Confirm). */
  actions: IntentGraphAction[];
  /** Results of executing actions against the database. Populated by executorNode after actions are persisted. */
  executionResults: ExecutionResult[];
  /** Detailed outcome of a `transition` action, for host-side status mapping. */
  transitionResult: TransitionOutcome | undefined;
  /** Detailed outcome of a `confirm` action, for host-side status mapping. */
  confirmResult: ConfirmOutcome | undefined;
  /** If set, indicates a fatal error that should short-circuit the graph to END. Populated by prep when a precondition fails (e.g. missing profile). */
  error: string | undefined;
  /** Accumulated trace entries from each graph node. Used for observability: surfaces internal processing steps (inference, verification with Felicity scores, reconciliation) to the frontend. */
  trace: Array<{ node: string; detail?: string; data?: Record<string, unknown> }>;
  /** Timing records for each agent invocation within this graph run. */
  agentTimings: DebugMetaAgent[];
  /** For read mode: the set of network IDs the caller's agent can reach. When set and neither networkId nor queryUserId is provided, the graph returns the caller's own intents across all networks in this set (scope-aware default path). Derived by the tool layer from the scope envelope plus memberships. */
  indexScope: string[] | undefined;
  /** For read mode: filter intents by a specific user when reading in a network. When omitted and network-scoped, returns all intents in the network. */
  queryUserId: string | undefined;
  /** For read mode: when true, return all of the current user's intents ignoring network scope. Used before create_intent to detect duplicates. */
  allUserIntents: boolean;
  /** Output of read mode: queried intents with count and optional metadata. */
  readResult: {
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
  } | undefined;
}

export function intentDefaults(): IntentState {
  return {
    userId: "",
    userProfile: "",
    inputContent: undefined,
    conversationContext: undefined,
    targetIntentIds: undefined,
    archive: false,
    status: undefined,
    proposalId: undefined,
    description: undefined,
    dryRun: false,
    expectedIntentFingerprint: undefined,
    networkId: undefined,
    scopeType: undefined,
    scopeId: undefined,
    activeIntents: "",
    activeIntentIds: [],
    inferredIntents: [],
    verifiedIntents: [],
    validationFailures: [],
    actions: [],
    executionResults: [],
    transitionResult: undefined,
    confirmResult: undefined,
    error: undefined,
    trace: [],
    agentTimings: [],
    indexScope: undefined,
    queryUserId: undefined,
    allUserIntents: false,
    readResult: undefined,
  };
}

