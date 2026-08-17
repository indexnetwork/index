/**
 * Fan-out driver: run one bilateral negotiation per candidate.
 *
 * Split out of `negotiation.graph.ts`, which held the graph, its four nodes and
 * this driver in one file. Import from `negotiation.graph.js` — it re-exports
 * everything here.
 */

import { invokeWithAbortSignal } from "../../shared/agent/model-signal.js";
import type { TraceEmitter } from "../../shared/observability/request-context.js";
import type { OpportunityStatus } from "../../shared/interfaces/database.interface.js";
import { type NegotiationTurn, type NegotiationOutcome, type UserNegotiationContext, type NegotiationGraphLike } from "../domain/negotiation.state.js";
import { negotiateCandidatesLog, turnsFromMessages } from "./negotiation.graph.shared.js";

export interface NegotiationCandidate {
  userId: string;
  /** Exact opportunity-bound source and candidate intent IDs. */
  sourceIntentId?: string;
  candidateIntentId?: string;
  /** Per-opportunity source context when its exact actor intent differs across a fan-out. */
  sourceUser?: UserNegotiationContext;
  reasoning: string;
  valencyRole: string;
  networkId?: string;
  candidateUser: UserNegotiationContext;
  /** The explicit search query that triggered discovery (if any). */
  discoveryQuery?: string;
  /**
   * ID of the opportunity this negotiation is for. When set, the negotiation
   * graph's finalize node updates the opportunity's status based on the outcome
   * (`accept` → 'pending', `reject` → 'rejected', otherwise → 'stalled').
   */
  opportunityId?: string;
  /** Exact persisted lifecycle state claimed by this negotiation attempt. */
  opportunityStatus?: OpportunityStatus;
  opportunityUpdatedAt?: Date;
}

export interface NegotiationResult {
  userId: string;
  agreedRoles: NegotiationOutcome["agreedRoles"];
  reasoning: string;
  turnCount: number;
}

/**
 * Per-candidate resolution hook — fires as each negotiation settles, before
 * Promise.all aggregates. Awaited so the caller can run async work before the
 * next settle.
 *
 * `turns` and `outcome` are passed through from the underlying negotiation
 * graph so consumers can build per-candidate decision-question inputs without
 * re-walking trace events or DB artifacts. Both are present on every
 * resolution (accepted, rejected, stalled, error); error paths receive a
 * synthesized `outcome` with `hasOpportunity: false`.
 */
export type OnNegotiationResolved = (entry: {
  candidate: NegotiationCandidate;
  accepted: NegotiationResult | null;
  turns: NegotiationTurn[];
  outcome: NegotiationOutcome;
  continuationReceipt?: import('../../shared/interfaces/database.interface.js').NegotiationContinuationReceipt;
}) => Promise<void>;

/**
 * Runs bilateral negotiation for each candidate in parallel.
 * @returns Only candidates that produced an opportunity
 */
export async function negotiateCandidates(
  negotiationGraph: NegotiationGraphLike,
  sourceUser: UserNegotiationContext,
  candidates: NegotiationCandidate[],
  indexContext: { networkId: string; prompt: string },
  opts?: {
    maxTurns?: number;
    traceEmitter?: TraceEmitter;
    indexContextOverrides?: Map<string, string>;
    timeoutMs?: number;
    onCandidateResolved?: OnNegotiationResolved;
    /**
     * Initiator seat for every candidate session in this fan-out (v2 stamp).
     * Passed through to the negotiation graph, which may still override it by
     * inheriting from a prior task on the same opportunities/conversation.
     */
    initiatorUserId?: string;
    /** Exact settled task to resume; only the durable run-existing path sets this. */
    resumeFromTaskId?: string;
    /** Deterministic settlement key paired with resumeFromTaskId. */
    continuationSettlementId?: string;
    /** Current durable lease/fence for this exact continuation successor. */
    continuationExecution?: import('../../shared/interfaces/database.interface.js').NegotiationContinuationExecution;
  },
): Promise<NegotiationResult[]> {
  const {
    maxTurns,
    traceEmitter,
    indexContextOverrides,
    timeoutMs,
    onCandidateResolved,
    initiatorUserId,
    resumeFromTaskId,
    continuationSettlementId,
    continuationExecution,
  } = opts ?? {};

  // Local helper to emit events whose shape is wider than the declared
  // `TraceEmitter` union (mirrors the cast used in chat.agent at the relay sink
  // and inside turn/finalize nodes above).
  const emitWide = (event: Record<string, unknown>) =>
    (traceEmitter as ((e: Record<string, unknown>) => void) | undefined)?.(event);

  const results = await Promise.all(
    candidates.map(async (candidate) => {
      const start = Date.now();
      const candidateSourceUser = candidate.sourceUser ?? sourceUser;
      if (candidate.opportunityId) {
        const candidateName = candidate.candidateUser?.profile?.name;
        emitWide({
          type: "negotiation_session_start",
          opportunityId: candidate.opportunityId,
          negotiationConversationId: "", // filled in on session_end
          sourceUserId: candidateSourceUser.id,
          candidateUserId: candidate.userId,
          initiatorUserId: initiatorUserId ?? candidateSourceUser.id,
          ...(candidateName && { candidateName }),
          startedAt: start,
        });
      }
      traceEmitter?.({ type: "agent_start", name: "Negotiating candidate" });

      try {
        const candidateIndexContext = candidate.networkId
          ? { networkId: candidate.networkId, prompt: indexContextOverrides?.get(candidate.networkId) ?? '' }
          : indexContext;

        const result = await invokeWithAbortSignal(negotiationGraph, {
          sourceUser: candidateSourceUser,
          candidateUser: candidate.candidateUser,
          ...(candidate.sourceIntentId && { sourceIntentId: candidate.sourceIntentId }),
          ...(candidate.candidateIntentId && { candidateIntentId: candidate.candidateIntentId }),
          indexContext: candidateIndexContext,
          seedAssessment: {
            reasoning: candidate.reasoning,
            valencyRole: candidate.valencyRole,
          },
          ...(candidate.discoveryQuery && { discoveryQuery: candidate.discoveryQuery }),
          ...(candidate.opportunityId && { opportunityId: candidate.opportunityId }),
          ...(candidate.opportunityStatus && { opportunityStatus: candidate.opportunityStatus }),
          ...(candidate.opportunityUpdatedAt && { opportunityUpdatedAt: candidate.opportunityUpdatedAt }),
          ...(initiatorUserId && { initiatorUserId }),
          ...(resumeFromTaskId && continuationSettlementId && continuationExecution ? {
            resumeFromTaskId,
            continuationSettlementId,
            continuationExecution,
          } : {}),
          ...(maxTurns !== undefined && { maxTurns }),
          ...(timeoutMs !== undefined && { timeoutMs }),
        });

        const durationMs = Date.now() - start;
        const outcome = result.outcome;
        const hasOpportunity = outcome?.hasOpportunity === true;
        const isContinuation = (result as { isContinuation?: boolean }).isContinuation ?? false;
        const priorTurnCount = (result as { priorTurnCount?: number }).priorTurnCount ?? 0;

        const turnFlow = (result.messages ?? [])
          .map((m) => {
            const dataPart = (m.parts as Array<{ kind?: string; data?: Record<string, unknown> }>)?.find((p) => p.kind === "data");
            if (!dataPart?.data) return null;
            const turn = dataPart.data as { action?: string };
            return turn.action ?? "unknown";
          })
          .filter(Boolean)
          .join(" → ");

        const statusTag = hasOpportunity ? "✓ opportunity" : "✗ rejected";
        traceEmitter?.({ type: "agent_end", name: "Negotiating candidate", durationMs, summary: `${candidate.userId}: ${turnFlow} ${statusTag}` });

        if (candidate.opportunityId) {
          emitWide({
            type: "negotiation_session_end",
            opportunityId: candidate.opportunityId,
            negotiationConversationId: (result as { conversationId?: string }).conversationId ?? "",
            durationMs: Date.now() - start,
            isContinuation,
            turnsAdded: outcome?.turnCount ?? 0,
            priorTurnCount,
          });
        }

        const accepted: NegotiationResult | null = hasOpportunity && outcome
          ? {
              userId: candidate.userId,
              agreedRoles: outcome.agreedRoles,
              reasoning: outcome.reasoning,
              turnCount: outcome.turnCount,
            }
          : null;

        if (onCandidateResolved) {
          const turnHistory: NegotiationTurn[] = turnsFromMessages(result.messages ?? []);
          const resolvedOutcome: NegotiationOutcome = result.outcome ?? {
            hasOpportunity: false,
            agreedRoles: [],
            reasoning: "no outcome returned by negotiation graph",
            turnCount: turnHistory.length,
          };
          try {
            await onCandidateResolved({
              candidate,
              accepted,
              turns: turnHistory,
              outcome: resolvedOutcome,
              ...(result.continuationReceipt ? { continuationReceipt: result.continuationReceipt } : {}),
            });
          } catch (hookErr) {
            // Hook failures must not sink the candidate result — the aggregate
            // return remains useful to the caller.
            negotiateCandidatesLog.error("onCandidateResolved hook threw", {
              candidateUserId: candidate.userId,
              error: hookErr,
            });
          }
        }

        return accepted;
      } catch (err) {
        const durationMs = Date.now() - start;
        traceEmitter?.({ type: "agent_end", name: "Negotiating candidate", durationMs, summary: `${candidate.userId}: error` });
        if (candidate.opportunityId) {
          emitWide({
            type: "negotiation_session_end",
            opportunityId: candidate.opportunityId,
            negotiationConversationId: "",
            durationMs: Date.now() - start,
          });
        }
        negotiateCandidatesLog.error("Negotiation failed", { candidateUserId: candidate.userId, error: err });
        if (onCandidateResolved) {
          try {
            await onCandidateResolved({
              candidate,
              accepted: null,
              turns: [],
              outcome: {
                hasOpportunity: false,
                agreedRoles: [],
                reasoning: err instanceof Error ? err.message : String(err),
                turnCount: 0,
              },
            });
          } catch {
            // ignore hook failure on error path
          }
        }
        return null;
      }
    }),
  );

  return results.filter((r): r is NegotiationResult => r !== null);
}
