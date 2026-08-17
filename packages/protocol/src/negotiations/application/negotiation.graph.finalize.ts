/**
 * Negotiation graph, stage 4: persist the outcome and fan out follow-ups.
 */

import { invokeWithAbortSignal } from "../../shared/agent/model-signal.js";
import { requestContext } from "../../shared/observability/request-context.js";
import type { NegotiationContinuationReceipt } from "../../shared/interfaces/database.interface.js";
import type { NegotiationTurnPayload } from "../../shared/interfaces/agent-dispatcher.interface.js";
import { type NegotiationTurn, type NegotiationOutcome } from "../domain/negotiation.state.js";
import { allowedActionsFor, askUserAnswerWindowMs, configuredAskUserEnabled, configuredProtocolVersion, fallbackActionFor, isRejectLikeAction, isTerminalAction, readProtocolVersion, rejectActionFor } from "../domain/negotiation.protocol.js";
import { assessConsultationEligibility, consultationPromptFor, negotiationConsultationPolicyMode, type NegotiationConsultationReason } from "../domain/negotiation.consultation-policy.js";
import { blocksNegotiationBeforeFirstTurn, type ScreenDecision, type ScreenDecisionRecord } from "./negotiation.screen.js";
import { configuredScreenMode } from "../domain/negotiation.screen.contracts.js";
import { assessDeadlock, configuredDeadlockShiftEnabled, configuredDeadlockThreshold, type DeadlockAssessment, type DeadlockShiftRecord } from "../domain/negotiation.deadlock.js";
import type { NegotiationSeat, NegotiationProtocolVersion } from "../../shared/schemas/negotiation-state.schema.js";
import { NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY, NEGOTIATION_QUESTION_GENERIC_NETWORK, negotiationQuestionSettlementId } from '../domain/negotiation.question-safety.js';
import { buildIntentSnapshots } from "../domain/negotiation.intent-snapshot-provenance.js";
import { holdsNegotiationConversationLock } from "../domain/negotiation.task-lock-policy.js";
import { isNegotiationTurnCapReached } from "../domain/negotiation.turn-cap.js";
import { expectedNegotiationSpeaker } from "../domain/negotiation.expected-speaker.js";
import { buildSeededAttribution } from '../negotiation.attribution.js';
import { buildAttributedDialogue, finalizeLog, hasPriorAskUser, initLog, memoryQueryText, negotiateCandidatesLog, resolveTaskAttribution, retrieveMemory, screenNodeLog, turnLog, turnsFromMessages } from "./negotiation.graph.shared.js";
import type { NegotiationGraphDeps, NegotiationState } from "./negotiation.graph.shared.js";


export async function finalizeNode(state: NegotiationState, deps: NegotiationGraphDeps) {
  const traceEmitter = requestContext.getStore()?.traceEmitter;
  const emitWide = (event: Record<string, unknown>) =>
    (traceEmitter as ((e: Record<string, unknown>) => void) | undefined)?.(event);

  const pauseReceipt = (outcome: 'waiting_for_agent' | 'input_required'): { continuationReceipt: NegotiationContinuationReceipt } | undefined =>
    state.continuationExecution
      ? {
          continuationReceipt: {
            priorTaskId: state.continuationExecution.taskId,
            settlementId: state.continuationExecution.settlementId,
            successorTaskId: state.continuationExecution.successorTaskId,
            fence: state.continuationExecution.fence,
            outcome,
          },
        }
      : undefined;

  if (state.status === 'waiting_for_agent') {
    if (state.opportunityId) {
      emitWide({
        type: "negotiation_outcome",
        opportunityId: state.opportunityId,
        outcome: "waiting_for_agent",
        turnCount: state.turnCount,
        isContinuation: state.isContinuation,
      });
    }
    return pauseReceipt('waiting_for_agent') ?? {};
  }

  // ask_user pause: no outcome, no completed state — the task stays
  // input_required until the client answers or the window expires.
  if (state.status === 'input_required') {
    if (state.opportunityId) {
      emitWide({
        type: "negotiation_outcome",
        opportunityId: state.opportunityId,
        outcome: "input_required",
        turnCount: state.turnCount,
        isContinuation: state.isContinuation,
      });
    }
    return pauseReceipt('input_required') ?? {};
  }

  // Init can fail closed before an attempt owns a task. Such a rejection is
  // not a completed negotiation and must not write through an empty task ID,
  // create an artifact, or advance the opportunity lifecycle.
  if (!state.taskId) {
    finalizeLog.info('Skipping outcome persistence because no negotiation task was claimed', {
      opportunityId: state.opportunityId || undefined,
      error: state.error || undefined,
    });
    return {};
  }

  const history: NegotiationTurn[] = turnsFromMessages(state.messages);

  const lastTurn = state.lastTurn;
  const hasOpportunity = lastTurn?.action === "accept";
  // P2.2: the client's own outreach gate declined before any turn — the
  // negotiation never happened from the counterparty's perspective.
  // IND-564: an opening-move `withdraw` blocked before any message was
  // persisted is the same quiet screen-out outcome (no in-task outreach to
  // retract), reached from the turn node rather than the screen node.
  // Two DISTINCT routes reach the same quiet `screened_out` outcome, and
  // they disagree about who authored the decision:
  //  - the screen node blocked before any turn was drafted → the screen
  //    decision is the reason;
  //  - the acting agent refused on its opening turn (IND-611) → the
  //    withdrawing TURN is the reason.
  // They are collapsed into `screenedOut` for status/lifecycle purposes but
  // must stay separate when attributing `outcome.reasoning` below.
  const blockedByScreenNode = blocksNegotiationBeforeFirstTurn(state.screenDecision, state.turnCount);
  const refusedAtOpeningTurn = state.firstTurnScreenedOut === true;
  const screenedOut = blockedByScreenNode || refusedAtOpeningTurn;
  const atCap = !screenedOut && isNegotiationTurnCapReached(state.turnCount, state.maxTurns) && !isTerminalAction(lastTurn?.action);

  let agreedRoles: NegotiationOutcome["agreedRoles"] = [];
  if (hasOpportunity && history.length >= 2) {
    const acceptTurn = history[history.length - 1];
    const precedingTurn = history[history.length - 2];
    const accepterIsSource = state.currentSpeaker === "candidate";
    const [sourceRole, candidateRole] = accepterIsSource
      ? [acceptTurn.assessment.suggestedRoles.ownUser, precedingTurn.assessment.suggestedRoles.ownUser]
      : [precedingTurn.assessment.suggestedRoles.ownUser, acceptTurn.assessment.suggestedRoles.ownUser];
    agreedRoles = [
      { userId: state.sourceUser.id, role: sourceRole },
      { userId: state.candidateUser.id, role: candidateRole },
    ];
  }

  const outcome: NegotiationOutcome = {
    hasOpportunity,
    agreedRoles,
    // IND-611: attribute the reasoning to whoever actually made the
    // decision. Before the turn-0 refusal path existed, `screenedOut`
    // implied the screen node, so preferring `screenDecision.reasoning`
    // was always right. It is now wrong for an opening-turn refusal taken
    // while the screen said `reach_out`: that record argues FOR the match,
    // and surfacing it as the reason the agent did NOT reach out is exactly
    // the dishonesty this work removes (IND-610 renders this string in the
    // owner-only gate-decision card). The screen-node branch is unchanged.
    reasoning: blockedByScreenNode
      ? (state.screenDecision?.reasoning ?? lastTurn?.assessment?.reasoning ?? "")
      : refusedAtOpeningTurn
        ? (lastTurn?.assessment?.reasoning ?? state.screenDecision?.reasoning ?? "")
        : (lastTurn?.assessment.reasoning ?? ""),
    turnCount: state.turnCount,
    ...(screenedOut
      ? { reason: "screened_out" as const }
      : atCap
        ? { reason: "turn_cap" as const }
        : {}),
  };

  try {
    await deps.database.updateTaskState(state.taskId, "completed", undefined, state.continuationExecution);
    await deps.database.createArtifact({
      taskId: state.taskId,
      name: "negotiation-outcome",
      parts: [{ kind: "data", data: outcome }],
      metadata: {
        hasOpportunity,
        turnCount: state.turnCount,
        ...(state.continuationExecution ? {
          continuationOutcome: hasOpportunity
            ? 'accepted'
            : (screenedOut || isRejectLikeAction(lastTurn?.action)) ? 'rejected' : 'stalled',
        } : {}),
      },
      ...(state.continuationExecution ? { continuationExecution: state.continuationExecution } : {}),
    });

    finalizeLog.info('Session complete', {
      conversationId: state.conversationId,
      taskId: state.taskId,
      isContinuation: state.isContinuation,
      turnsAdded: state.turnCount,
      priorTurnCount: state.priorTurnCount,
      outcome: hasOpportunity ? 'accepted' : screenedOut ? 'screened_out' : (atCap ? 'turn_cap' : (lastTurn?.action ?? 'unknown')),
      opportunityId: state.opportunityId || undefined,
    });

    if (state.opportunityId) {
      // screened_out → 'rejected': quiet terminal status (hidden from
      // default lists), never 'stalled' — with zero turns the generic
      // mapping would misfile the client's own gate decision.
      const nextStatus = lastTurn?.action === 'accept'
        ? 'pending'
        : (screenedOut || isRejectLikeAction(lastTurn?.action))
          ? 'rejected'
          : 'stalled';
      await deps.database.updateOpportunityStatus(state.opportunityId, nextStatus, undefined, state.continuationExecution).catch((err) => {
        finalizeLog.error("Failed to update opportunity status", { opportunityId: state.opportunityId, nextStatus, error: err });
      });
    }
  } catch (err) {
    finalizeLog.error("Failed to persist outcome", { error: err });
  }

  if (state.opportunityId) {
    const emittedOutcome: "accepted" | "rejected_stalled" | "turn_cap" | "timed_out" | "screened_out" =
      hasOpportunity
        ? "accepted"
        : screenedOut
        ? "screened_out"
        : atCap
        ? "turn_cap"
        : state.error && /timeout/i.test(state.error)
        ? "timed_out"
        : "rejected_stalled";

    emitWide({
      type: "negotiation_outcome",
      opportunityId: state.opportunityId,
      outcome: emittedOutcome,
      turnCount: state.turnCount,
      isContinuation: state.isContinuation,
      turnsAdded: state.turnCount,
      priorTurnCount: state.priorTurnCount,
      ...(outcome.reasoning && { reasoning: outcome.reasoning }),
      ...(hasOpportunity && agreedRoles.length >= 2 && {
        agreedRoles: {
          ownUser: agreedRoles[0]?.role,
          otherUser: agreedRoles[1]?.role,
        },
      }),
    });
  }

  if (state.consultationPolicyReason) {
    // Stable, content-free terminal funnel telemetry. This executes only
    // after a fenced continuation has reached its terminal outcome.
    finalizeLog.info('negotiation_consultation_policy', {
      stage: 'terminal_outcome',
      reason: state.consultationPolicyReason,
      outcome: hasOpportunity ? 'accepted' : (screenedOut || isRejectLikeAction(lastTurn?.action)) ? 'rejected' : 'stalled',
    });
    emitWide({
      type: 'negotiation_consultation_policy',
      stage: 'terminal_outcome',
      reason: state.consultationPolicyReason,
      outcome: hasOpportunity ? 'accepted' : (screenedOut || isRejectLikeAction(lastTurn?.action)) ? 'rejected' : 'stalled',
    });
  }

  // Enqueue post-negotiation reflection (P5.2 memory write path) — fire
  // and forget: a reflection failure must never affect the outcome. Only
  // sessions that actually exchanged turns teach anything; init/turn
  // errors with turnCount 0 are skipped.
  if (deps.reflectEnqueue && state.turnCount > 0 && !state.continuationExecution) {
    deps.reflectEnqueue({
      negotiationId: state.taskId,
      conversationId: state.conversationId,
      ...(state.opportunityId && { opportunityId: state.opportunityId }),
      sourceUser: {
        id: state.sourceUser.id,
        ...(state.sourceUser.profile.name && { name: state.sourceUser.profile.name }),
        ...(state.sourceUser.profile.bio && { bio: state.sourceUser.profile.bio }),
      },
      candidateUser: {
        id: state.candidateUser.id,
        ...(state.candidateUser.profile.name && { name: state.candidateUser.profile.name }),
        ...(state.candidateUser.profile.bio && { bio: state.candidateUser.profile.bio }),
      },
      initiatorUserId: state.initiatorUserId ?? state.sourceUser.id,
      outcome: { hasOpportunity, reasoning: outcome.reasoning, turnCount: state.turnCount },
    }).catch((err) =>
      finalizeLog.error('Failed to enqueue negotiation reflection', {
        taskId: state.taskId,
        error: err,
      })
    );
  }

  // Enqueue question generation for stalled/capped negotiations (not accepted or explicitly rejected).
  // Require turnCount > 0 so early init/turn errors don't enqueue with empty context.
  if (!hasOpportunity && !isRejectLikeAction(lastTurn?.action) && state.turnCount > 0 && state.opportunityId && state.sourceIntentId && state.indexContext.networkId && deps.questionerEnqueue && !state.continuationExecution) {
    const stallReason: 'turn_cap' | 'timeout' | 'stalled' = atCap
      ? 'turn_cap'
      : (state.error && /timeout/i.test(state.error))
        ? 'timeout'
        : 'stalled';

    const userContext = (await deps.database.getUserContext(state.sourceUser.id, null))?.text ?? '';
    const sourceIntent = state.sourceUser.intents.find((intent) => intent.id === state.sourceIntentId);
    deps.questionerEnqueue({
      mode: 'negotiation',
      purpose: 'stalled_followup',
      userId: state.sourceUser.id,
      sourceType: 'opportunity',
      sourceId: state.opportunityId,
      negotiation: {
        purpose: 'stalled_followup',
        recipientUserId: state.sourceUser.id,
        recipientIntentId: state.sourceIntentId,
        opportunityId: state.opportunityId,
        taskId: state.taskId,
        networkId: state.indexContext.networkId,
      },
      context: {
        negotiationId: state.taskId,
        counterpartyHint: NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY,
        indexContext: NEGOTIATION_QUESTION_GENERIC_NETWORK,
        outcomeReason: stallReason,
        recipientIntent: sourceIntent
          ? `${sourceIntent.title}: ${sourceIntent.description}`
          : 'the signal attached to this match',
        userContext,
      },
    }).catch((err) =>
      finalizeLog.error('Failed to enqueue negotiation question generation', {
        opportunityId: state.opportunityId,
        error: err,
      })
    );
  }

  const terminalReceipt: { continuationReceipt: NegotiationContinuationReceipt } | undefined = state.continuationExecution
    ? {
        continuationReceipt: {
          priorTaskId: state.continuationExecution.taskId,
          settlementId: state.continuationExecution.settlementId,
          successorTaskId: state.continuationExecution.successorTaskId,
          fence: state.continuationExecution.fence,
          outcome: hasOpportunity
            ? 'accepted'
            : (screenedOut || isRejectLikeAction(lastTurn?.action)) ? 'rejected' : 'stalled',
        },
      }
    : undefined;

  return { outcome, status: 'completed' as const, ...terminalReceipt };
}
