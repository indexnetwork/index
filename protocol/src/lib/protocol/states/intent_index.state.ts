import { Annotation } from "@langchain/langgraph";
import type { IntentIndexerOutput } from "../agents/intent.indexer";
import type { DebugMetaAgent } from '../../../types/chat-streaming.types';

/**
 * Intent payload and metadata loaded for index evaluation.
 * (Migrated from the old index.graph.state.ts)
 */
export interface IntentForIndexing {
  id: string;
  payload: string;
  userId: string;
  sourceType: string | null;
  sourceId: string | null;
}

/**
 * Index and member prompts for a single index (user must be member with autoAssign).
 * (Migrated from the old index.graph.state.ts)
 */
export interface IndexMemberContext {
  indexId: string;
  indexPrompt: string | null;
  memberPrompt: string | null;
}

/**
 * Result of executing an assignment decision.
 * (Migrated from the old index.graph.state.ts)
 */
export interface AssignmentResult {
  indexId: string;
  assigned: boolean;
  success: boolean;
  error?: string;
}

/**
 * Intent Index Graph State.
 * Handles CRUD for the intent_indexes junction table (linking intents to indexes).
 * Absorbs the old Index Graph's evaluate-based assignment flow.
 *
 * Flow:
 * START → router → {
 *   create: assignNode (direct or evaluated) → END
 *   read: readNode → END
 *   delete: unassignNode → END
 * }
 */
export const IntentIndexGraphState = Annotation.Root({
  // --- Core Inputs (from ChatGraph via ToolContext) ---

  /** User performing the action. Always required. */
  userId: Annotation<string>,

  /** Target index for assign/read-by-index. From ChatGraph or tool arg. */
  indexId: Annotation<string | undefined>({
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
   * When true, skip LLM evaluation and assign directly.
   * (Migrated from old Index Graph.)
   */
  skipEvaluation: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => true,
  }),

  // --- Intermediate State (populated by nodes, migrated from old Index Graph) ---

  /** Intent payload and metadata. Null if intent not found. */
  intent: Annotation<IntentForIndexing | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  /** Index + member context. Null if user not eligible. */
  indexContext: Annotation<IndexMemberContext | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  /** LLM evaluation result. Null if skipped. */
  evaluation: Annotation<IntentIndexerOutput | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  /** Final decision: should intent be in this index? */
  shouldAssign: Annotation<boolean | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),

  /** Final score used for decision (0–1). */
  finalScore: Annotation<number | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),

  /** Result of the assignment operation. */
  assignmentResult: Annotation<AssignmentResult | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // --- Read Mode Outputs ---

  /** For read-by-intent: pass userId when listing an intent's indexes (omit for read-by-index). */
  queryUserId: Annotation<string | undefined>({
    reducer: (_, next) => next,
    default: () => undefined,
  }),

  /** Output for read mode. */
  readResult: Annotation<{
    links: Array<{
      intentId: string;
      indexId: string;
      intentTitle?: string;
      indexTitle?: string;
      userId?: string;
      userName?: string;
      createdAt?: Date;
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
