import { Annotation } from "@langchain/langgraph";
import { z } from "zod";
import type { NegotiationUserAnswer } from "../shared/interfaces/database.interface.js";
import type { ScreenDecisionRecord } from "./negotiation.screen.js";
import type { DeadlockShiftRecord } from "./negotiation.deadlock.js";
import type { NegotiatorMemoryEntry } from "./negotiation.memory.js";
import { AskUserPayloadSchema, NEGOTIATION_ACTIONS, type NegotiationProtocolVersion } from "../shared/schemas/negotiation-state.schema.js";

/**
 * Zod schema for a single negotiation turn (DataPart payload in A2A message).
 * Accepts the full v1+v2 action union — which subset is valid for a given turn
 * is enforced by the seat-scoped schemas in `negotiation.protocol.ts`.
 */
export const NegotiationTurnSchema = z.object({
  action: z.enum(NEGOTIATION_ACTIONS),
  assessment: z.object({
    reasoning: z.string(),
    suggestedRoles: z.object({
      ownUser: z.enum(["agent", "patient", "peer"]),
      otherUser: z.enum(["agent", "patient", "peer"]),
    }),
  }),
  message: z.string().nullable().optional(),
  /** Present when action is `ask_user` (v2, P3.2). */
  askUser: AskUserPayloadSchema.nullable().optional(),
});

/** Restricted v1 turn schema for the system agent (no question action). */
export const SystemNegotiationTurnSchema = z.object({
  action: z.enum(["propose", "accept", "reject", "counter"]),
  assessment: z.object({
    reasoning: z.string(),
    suggestedRoles: z.object({
      ownUser: z.enum(["agent", "patient", "peer"]),
      otherUser: z.enum(["agent", "patient", "peer"]),
    }),
  }),
  message: z.string().nullable().optional(),
});

/** v1 turn schema for system agent's final allowed turn (must decide). */
export const FinalNegotiationTurnSchema = z.object({
  action: z.enum(["accept", "reject"]),
  assessment: z.object({
    reasoning: z.string(),
    suggestedRoles: z.object({
      ownUser: z.enum(["agent", "patient", "peer"]),
      otherUser: z.enum(["agent", "patient", "peer"]),
    }),
  }),
  message: z.string().nullable().optional(),
});

export type NegotiationTurn = z.infer<typeof NegotiationTurnSchema>;

/** Zod schema for the negotiation outcome (Artifact payload on COMPLETED task). */
export const NegotiationOutcomeSchema = z.object({
  hasOpportunity: z.boolean(),
  agreedRoles: z.array(z.object({
    userId: z.string(),
    role: z.enum(["agent", "patient", "peer"]),
  })),
  reasoning: z.string(),
  turnCount: z.number(),
  reason: z.enum(["turn_cap", "timeout", "screened_out"]).optional(),
});

export type NegotiationOutcome = z.infer<typeof NegotiationOutcomeSchema>;

/** Context each agent receives about its user. */
export interface UserNegotiationContext {
  id: string;
  intents: Array<{ id: string; title: string; description: string; confidence: number }>;
  profile: { name?: string; bio?: string; location?: string; interests?: string[]; skills?: string[] };
}

/** Seed assessment from the evaluator pre-filter. */
export interface SeedAssessment {
  reasoning: string;
  valencyRole: string;
  actors?: Array<{ userId: string; role: string }>;
}

/** Typed interface for a negotiation graph's invoke signature. */
export interface NegotiationGraphLike {
  invoke(input: {
    sourceUser: UserNegotiationContext;
    candidateUser: UserNegotiationContext;
    indexContext: { networkId: string; prompt: string };
    seedAssessment: Omit<SeedAssessment, "actors">;
    discoveryQuery?: string;
    opportunityId?: string;
    maxTurns?: number;
    timeoutMs?: number;
    /**
     * The user who holds the initiating seat for this match (v2 client-advocate
     * protocol). Stamped into task metadata by the init node. When omitted, the
     * init node resolves it: inherit from the prior task for the same
     * opportunity → conversation-scoped tie-break → fall back to sourceUser.id.
     */
    initiatorUserId?: string;
  }): Promise<{
    outcome: NegotiationOutcome | null;
    messages?: NegotiationMessage[];
    conversationId?: string;
    isContinuation?: boolean;
    priorTurnCount?: number;
  }>;
}

/** A2A message record shape (matches messages table). */
export interface NegotiationMessage {
  id: string;
  senderId: string;
  role: "agent";
  parts: unknown[];
  createdAt: Date;
}

/** LangGraph state annotation for the negotiation graph. */
export const NegotiationGraphState = Annotation.Root({
  sourceUser: Annotation<UserNegotiationContext>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({ id: "", intents: [], profile: {} }),
  }),
  candidateUser: Annotation<UserNegotiationContext>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({ id: "", intents: [], profile: {} }),
  }),
  indexContext: Annotation<{ networkId: string; prompt: string }>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({ networkId: "", prompt: "" }),
  }),
  seedAssessment: Annotation<SeedAssessment>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({ reasoning: "", valencyRole: "" }),
  }),

  /**
   * Explicit initiator seat for this match (purely additive metadata — no seat
   * rules attach to it yet). Resolution when unset happens in the init node;
   * the resolved value is written back to state and into task metadata.
   */
  initiatorUserId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** The explicit search query that triggered discovery (if any). */
  discoveryQuery: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
  /**
   * Negotiation protocol version for this session's task. Resolved by the
   * init node: inherited from the prior task on the conversation when one
   * exists (never re-stamped — a v1 conversation stays v1 mid-flight), else
   * stamped from `NEGOTIATION_PROTOCOL_VERSION` for genuinely fresh runs.
   */
  protocolVersion: Annotation<NegotiationProtocolVersion>({
    reducer: (curr, next) => next ?? curr,
    default: () => "v1" as const,
  }),

  /**
   * Screen-gate decision for this fresh run (P2.1 shadow mode). Written by the
   * screen node; null when the gate is off, on continuations, or before the
   * node runs. Mirrors `tasks.metadata.screenDecision`.
   */
  screenDecision: Annotation<ScreenDecisionRecord | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),

  /**
   * First applied deadlock→bargaining shift in this session (IND-428).
   * Written by the turn node when the system agent first drafts in the
   * bargaining stance; used to record the shift exactly once per session.
   * Internal analytics only — mirrored to `tasks.metadata.deadlockShift`,
   * never into any turn payload or public projection.
   */
  deadlockShift: Annotation<DeadlockShiftRecord | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),

  /**
   * Per-side negotiator-memory cache (P5.3 read path). Populated lazily the
   * first time each side's memory is retrieved (screen node for the client,
   * turn node for the speaker) so a multi-turn session pays for retrieval at
   * most once per side. `undefined` per side = not yet retrieved; `[]` =
   * retrieved and empty (flag off / no rows / retrieval failed).
   */
  memoryBySide: Annotation<Partial<Record<"source" | "candidate", NegotiatorMemoryEntry[]>>>({
    reducer: (curr, next) => ({ ...curr, ...next }),
    default: () => ({}),
  }),

  /** Whether this run is continuing a prior conversation with the same pair. */
  isContinuation: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),
  opportunityId: Annotation<string>({
    reducer: (curr, next) => next ?? curr,
    default: () => "",
  }),
  conversationId: Annotation<string>({
    reducer: (curr, next) => next ?? curr,
    default: () => "",
  }),
  taskId: Annotation<string>({
    reducer: (curr, next) => next ?? curr,
    default: () => "",
  }),
  messages: Annotation<NegotiationMessage[]>({
    reducer: (curr, next) => [...curr, ...(next || [])],
    default: () => [],
  }),
  turnCount: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 0,
  }),
  maxTurns: Annotation<number | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
  /**
   * Park-window budget in milliseconds. Ambient callers pass `AMBIENT_PARK_WINDOW_MS`
   * (5 minutes); orchestrator callers pass a shorter window. This annotation default
   * is a safety net for any caller that omits the field — keep it aligned with
   * `AMBIENT_PARK_WINDOW_MS` in packages/protocol/src/negotiation/negotiation.tools.ts.
   * Inlined rather than imported to avoid a state↔tools cycle.
   */
  timeoutMs: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 5 * 60 * 1000,
  }),

  currentSpeaker: Annotation<"source" | "candidate">({
    reducer: (curr, next) => next ?? curr,
    default: () => "source" as const,
  }),
  lastTurn: Annotation<NegotiationTurn | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),

  /**
   * Graph status.
   * - `active` — agents are exchanging turns (default)
   * - `waiting_for_agent` — graph suspended; awaiting external agent response or timeout
   * - `input_required` — graph suspended on an `ask_user` pause; awaiting the
   *   negotiator's own client (answer or 24 h window expiry resumes it)
   * - `completed` — negotiation finalized (accept/reject/turn-cap/timeout)
   */
  status: Annotation<'active' | 'waiting_for_agent' | 'input_required' | 'completed'>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'active' as const,
  }),

  /** Number of turns present in the conversation before this session started. */
  priorTurnCount: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 0,
  }),

  /** User answers collected by the questioner between negotiation sessions. */
  userAnswers: Annotation<NegotiationUserAnswer[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  outcome: Annotation<NegotiationOutcome | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),
  error: Annotation<string | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),
});
