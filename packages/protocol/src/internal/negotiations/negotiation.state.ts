import { Annotation } from "@langchain/langgraph";
import { z } from "zod";
import type { NegotiationContinuationExecution, NegotiationContinuationReceipt, NegotiationPrivateConsultation, NegotiationUserAnswer, OpportunityStatus } from "../../platform/database.js";
import type { DeadlockShiftRecord } from "./negotiation.deadlock.contracts.js";
import type { NegotiatorMemoryEntry } from "./negotiation.memory.js";
import { AskUserPayloadSchema, NEGOTIATION_ACTIONS, type NegotiationProtocolVersion } from "../../protocol/schemas/negotiation-state.schema.js";
import { ChecklistDraftSchema } from "../../protocol/schemas/negotiation-checklist.schema.js";
import type { ChecklistItem } from "./negotiation.checklist.contracts.js";
import type { NegotiationTurnFailure } from "./negotiation.turn-failure.js";
import type { NegotiationConsultationReason } from "./negotiation.consultation-policy.js";

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
  /**
   * The checklist as this turn scored it (checklist plan §2). Permissive here,
   * like `askUser`: the turn record carries turns from before the checklist
   * protocol and from external agents that never draft one, and the domain
   * module enforces the invariants when the graph reconciles a draft.
   */
  checklist: ChecklistDraftSchema.nullable().optional(),
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
  /**
   * Why an unconcluded negotiation ended. `agent_error` is the honest name for
   * a run that stopped because the acting agent kept failing — distinct from
   * `turn_cap`, which claims a dialogue happened and exhausted its budget.
   * `repetition` is the honest name for a run the copy-loop guard ended: an
   * agent reproduced a message already on the record and did it again when
   * re-issued, so nothing was decided and no verdict may be implied.
   * `screened_out` means no contact was ever made. The pre-first-turn outreach
   * gate that used to write it is gone; the IND-564 opening-`withdraw` guard
   * still does, and historical rows stamped by the gate still render.
   */
  reason: z.enum(["turn_cap", "timeout", "screened_out", "agent_error", "repetition"]).optional(),
});

export type NegotiationOutcome = z.infer<typeof NegotiationOutcomeSchema>;

/**
 * Context each agent receives about its user.
 *
 * Structurally duplicated by `shared/schemas/negotiation-state.schema.ts`,
 * which is the declaration the package exports to hosts; the two must stay
 * identical.
 */
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
    /** Exact opportunity-actor intent bindings; never inferred from intent array order. */
    sourceIntentId?: string;
    candidateIntentId?: string;
    indexContext: { networkId: string; prompt: string };
    seedAssessment: Omit<SeedAssessment, "actors">;
    discoveryQuery?: string;
    opportunityId?: string;
    /** Exact persisted lifecycle state claimed by this negotiation attempt. */
    opportunityStatus?: OpportunityStatus;
    opportunityUpdatedAt?: Date;
    maxTurns?: number;
    timeoutMs?: number;
    /**
     * The user who holds the initiating seat for this match (v2 client-advocate
     * protocol). Stamped into task metadata by the init node. When omitted, the
     * init node resolves it: inherit from the prior task for the same
     * opportunity → conversation-scoped tie-break → fall back to sourceUser.id.
     */
    initiatorUserId?: string;
    /** Exact settled task for a durable ask_user continuation. */
    resumeFromTaskId?: string;
    /** Deterministic durable settlement/outbox identifier. */
    continuationSettlementId?: string;
    /** Current durable lease/fence for the exact successor execution. */
    continuationExecution?: NegotiationContinuationExecution;
  }): Promise<{
    outcome: NegotiationOutcome | null;
    messages?: NegotiationMessage[];
    conversationId?: string;
    isContinuation?: boolean;
    priorTurnCount?: number;
    error?: string | null;
    continuationReceipt?: NegotiationContinuationReceipt;
  }>;
}

/** A2A message record shape (matches messages table). */
export interface NegotiationMessage {
  id: string;
  senderId: string;
  role: "agent";
  parts: unknown[];
  createdAt: Date;
  /**
   * Originating negotiation task (IND-569). Seeded prior messages carry their
   * source task's id; turns persisted this session carry the current task id.
   * Optional/undefined for legacy hosts whose `getMessagesForConversation`
   * does not project task attribution — such turns degrade to the unattributed
   * prior-dialogue block, never into the current opportunity's turns.
   */
  taskId?: string | null;
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
  sourceIntentId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
  candidateIntentId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
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
   * first time the speaking side's memory is retrieved (turn node) so a
   * multi-turn session pays for retrieval at most once per side. `undefined` per side = not yet retrieved; `[]` =
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

  /**
   * Immutable attributed prior dialogue derived once in the init node from the
   * seeded prior messages (IND-569). Groups earlier-opportunity turns and
   * legacy unattributed turns so every turn prompt can label prior context
   * per opportunity. Null on fresh runs / when there is no
   * seeded prior dialogue. Typed as `unknown` to avoid a module cycle
   * (attribution module imports NegotiationTurn from this module's shim);
   * callers cast to `SeededAttribution` via the negotiation.attribution module.
   */
   
  priorAttribution: Annotation<unknown>({
    reducer: (curr: any, next: any) => next ?? curr,
    default: () => null,
  }),

  /**
   * Whether the initiator has actually opened `outreach` within THIS task
   * (IND-564). Set by the turn node the first time an `outreach` turn is
   * persisted in the current session; seeded prior-task turns never flip it.
   * `withdraw` is only legal after an in-task outreach — a withdraw before one
   * would retract an outreach never made here and drop a spurious message into
   * the shared thread, so the turn node maps it to a quiet screen-out instead.
   */
  outreachOpened: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  /**
   * Set by the turn node when an opening-move `withdraw` (no in-task outreach)
   * was blocked (IND-564). Signals finalize to record the quiet screen-out
   * outcome (`reason: "screened_out"`, opportunity `rejected`) without ever
   * persisting the withdraw message into the shared `dm_pair` conversation.
   * The sole remaining writer of `screened_out` now that the outreach gate is
   * gone: the refusal is the acting agent's own opening turn, not a decision
   * taken before it drafted one.
   */
  firstTurnScreenedOut: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),
  opportunityId: Annotation<string>({
    reducer: (curr, next) => next ?? curr,
    default: () => "",
  }),
  /** Exact persisted lifecycle state claimed by this negotiation attempt. */
  opportunityStatus: Annotation<OpportunityStatus | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
  opportunityUpdatedAt: Annotation<Date | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
  /** Exact prior task selected by a durable continuation; bypasses latest-task lookup. */
  resumeFromTaskId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
  /** Deterministic settlement key used to idempotently reuse a successor task. */
  continuationSettlementId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  continuationExecution: Annotation<NegotiationContinuationExecution | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  continuationReceipt: Annotation<NegotiationContinuationReceipt | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  privateConsultation: Annotation<NegotiationPrivateConsultation | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
  /** Server-only IND-508 category recovered from the exact prior task binding. */
  consultationPolicyReason: Annotation<NegotiationConsultationReason | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
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
   * Park-window budget in milliseconds. The annotation default is a safety net
   * for any caller that omits the field — keep it aligned with
   * `AMBIENT_PARK_WINDOW_MS` in packages/protocol/src/negotiations/negotiation.tools.ts.
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

  /**
   * The negotiation's checklist (checklist plan §2): 3–5 dimensions authored
   * on turn 1 from the two intents alone, FROZEN after, re-scored every turn.
   *
   * A channel rather than the store: the durable record is the turn history
   * itself — every turn persists the checklist it acted on — and the turn node
   * re-derives the frozen dimensions from `messages` on each turn, so a
   * continuation, a retried turn and a fresh process all read the same
   * checklist without this channel having to survive anything. What the
   * channel adds is an in-session read for finalize and telemetry.
   */
  checklist: Annotation<ChecklistItem[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** User answers collected by the questioner between negotiation sessions. */
  userAnswers: Annotation<NegotiationUserAnswer[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /**
   * Failed turns recorded this session (most recent last, capped). A failed
   * turn persists no message and no turn, so this channel — mirrored to
   * `tasks.metadata.failedTurns` — is the only record that it happened.
   */
  turnFailures: Annotation<NegotiationTurnFailure[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /**
   * Failed turns since the last turn that actually landed. Drives the retry
   * edge out of the turn node and the error-stalled outcome at the bound; a
   * successful turn resets it to zero, so it counts a RUN of failures rather
   * than failures in total.
   */
  consecutiveTurnFailures: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 0,
  }),

  /**
   * The copy-loop guard ended this run: a drafted turn repeated a message
   * already on the record, and the single anti-echo re-issue repeated it too.
   *
   * A channel rather than `error` because the two are different facts and the
   * outcome must not confuse them — `error` means the agent could not produce
   * a turn at all, this means it produced one that said nothing new. Routes to
   * finalize, where it becomes `reason: "repetition"`.
   */
  repetitionStalled: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
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
