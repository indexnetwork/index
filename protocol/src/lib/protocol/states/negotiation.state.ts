import { Annotation } from "@langchain/langgraph";
import type { Id } from '../../../types/common.types';
import type {
  NegotiationParticipant,
  NegotiationTrigger,
  NegotiationTurn,
  NegotiationResolution,
  NegotiationStatus,
  NegotiationOutcome,
  NegotiationAgentOutput,
} from '../../../types/negotiation.types';

/**
 * Negotiation Graph State
 * 
 * Orchestrates agent-to-agent negotiation with adaptive turn limits.
 * Flow: Init → Turn → (Extension Check) → Resolution OR Loop → Persist → END
 */

/** Profile data for negotiation participants */
export interface NegotiationProfileData {
  name?: string;
  bio?: string;
  location?: string;
  interests?: string[];
  skills?: string[];
  context?: string;
}

/** Intent data for negotiation participants */
export interface NegotiationIntentData {
  intentId: Id<'intents'>;
  payload: string;
  summary?: string;
}

/** Loaded principal context */
export interface PrincipalContext {
  userId: Id<'users'>;
  profile: NegotiationProfileData;
  intents: NegotiationIntentData[];
}

/** Options for the negotiation graph */
export interface NegotiationGraphOptions {
  /** Initial max turns (default: 3) */
  maxTurns?: number;
  /** Index context for the negotiation */
  indexId?: Id<'indexes'>;
}

/**
 * Negotiation Graph State Annotation
 */
export const NegotiationGraphState = Annotation.Root({
  // ─── Input Fields (Required) ───
  
  /** Initiator user ID */
  initiatorUserId: Annotation<Id<'users'>>({
    reducer: (curr, next) => next ?? curr,
    default: () => '' as Id<'users'>,
  }),
  
  /** Responder user ID */
  responderUserId: Annotation<Id<'users'>>({
    reducer: (curr, next) => next ?? curr,
    default: () => '' as Id<'users'>,
  }),
  
  /** Trigger that started this negotiation */
  trigger: Annotation<NegotiationTrigger>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({ source: 'search' } as NegotiationTrigger),
  }),
  
  /** Graph options */
  options: Annotation<NegotiationGraphOptions>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({}),
  }),
  
  /**
   * Operation mode:
   * - 'negotiate': Full negotiation flow
   * - 'resume': Resume an existing negotiation
   */
  operationMode: Annotation<'negotiate' | 'resume'>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'negotiate' as const,
  }),
  
  /** Existing negotiation ID for resume mode */
  negotiationId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
  
  // ─── Intermediate Fields (Accumulated) ───
  
  /** Loaded initiator context */
  initiatorContext: Annotation<PrincipalContext | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),
  
  /** Loaded responder context */
  responderContext: Annotation<PrincipalContext | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),
  
  /** Participants list */
  participants: Annotation<NegotiationParticipant[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),
  
  /** Current turn number (1-indexed) */
  currentTurn: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 0,
  }),
  
  /** Maximum turns allowed */
  maxTurns: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 3,
  }),
  
  /** Accumulated turns */
  turns: Annotation<NegotiationTurn[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),
  
  /** Latest agent output (from current turn) */
  latestAgentOutput: Annotation<NegotiationAgentOutput | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),
  
  /** Current participant (whose turn it is) */
  currentParticipantUserId: Annotation<Id<'users'> | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),
  
  /** Negotiation status */
  status: Annotation<NegotiationStatus>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'initiated' as NegotiationStatus,
  }),
  
  // ─── Output Fields ───
  
  /** Final outcome */
  outcome: Annotation<NegotiationOutcome | null>({
    reducer: (curr, next) => next,
    default: () => null,
  }),
  
  /** Resolution details */
  resolution: Annotation<NegotiationResolution | null>({
    reducer: (curr, next) => next,
    default: () => null,
  }),
  
  /** Created opportunity ID (if outcome is 'opportunity') */
  opportunityId: Annotation<string | null>({
    reducer: (curr, next) => next,
    default: () => null,
  }),
  
  /** Created negotiation record ID */
  createdNegotiationId: Annotation<string | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),
  
  /** Error message if any step fails */
  error: Annotation<string | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),
  
  // ─── Trace Output ───
  
  /** Accumulated trace entries for observability */
  trace: Annotation<Array<{ node: string; detail?: string; data?: Record<string, unknown> }>>({
    reducer: (curr, next) => [...curr, ...(next || [])],
    default: () => [],
  }),
});
