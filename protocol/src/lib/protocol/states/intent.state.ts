import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";
import { InferredIntent } from "../agents/intent.inferrer";
import { SemanticVerifierOutput } from "../agents/intent.verifier";
import { IntentReconcilerOutput } from "../agents/intent.reconciler";
import type { DebugMetaAgent } from '../../../types/chat-streaming.types';

/**
 * Extended InferredIntent that includes verification results.
 * We attach the verification output directly to the intent object
 * as it flows through the graph.
 */
export type VerifiedIntent = InferredIntent & {
  verification?: SemanticVerifierOutput;
  score?: number; // Calculated min(authority, sincerity, clarity)
};

/**
 * Result of executing a single reconciler action.
 */
export interface ExecutionResult {
  /** The action type that was executed */
  actionType: 'create' | 'update' | 'expire';
  /** Whether the action succeeded */
  success: boolean;
  /** The intent ID (created/updated/archived) */
  intentId?: string;
  /** Final payload (sanitized, for create/update) */
  payload?: string;
  /** Error message if failed */
  error?: string;
}

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
   * Operation mode controls graph flow and determines which nodes execute.
   * - 'create': Full pipeline (prep → inference → verification → reconciliation → execution)
   * - 'update': Skip verification if no new intents (prep → inference → reconciliation → execution)
   * - 'delete': Skip inference and verification (prep → reconciliation → execution)
   * - 'read': Fast path (prep → queryNode → END) — reads intents without LLM calls
   * - 'propose': Inference + verification only, stops before reconciliation (no DB writes)
   *
   * Defaults to 'create' for backward compatibility.
   */
  operationMode: Annotation<'create' | 'update' | 'delete' | 'read' | 'propose'>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'create' as const,
  }),

  /**
   * For update/delete operations, specifies which intent IDs to target.
   * Optional - used when modifying or removing specific intents.
   */
  targetIntentIds: Annotation<string[] | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /**
   * Optional index scope (index ID). Used for linking created intents to an index
   * and for scoping read operations. Prep always fetches ALL user intents via
   * getActiveIntents(userId) regardless of index scope (for global dedup/reconciliation).
   */
  indexId: Annotation<string | undefined>({
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

  // --- Output ---

  /**
   * Final actions to be performed on the DB (Create, Update, Expire).
   */
  actions: Annotation<IntentReconcilerOutput['actions']>({
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
   * For read mode: filter intents by a specific user when reading in an index.
   * When omitted and index-scoped, returns all intents in the index.
   */
  queryUserId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /**
   * For read mode: when true, return all of the current user's intents
   * ignoring index scope. Used before create_intent to detect duplicates.
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
    indexId?: string;
  } | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),
});
