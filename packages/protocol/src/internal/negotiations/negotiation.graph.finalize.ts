/**
 * Negotiation graph, stage 4: persist the outcome and fan out follow-ups.
 */

import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { requestContext } from "../shared/observability/request-context.js";
import type { NegotiationContinuationReceipt } from "../../platform/database.js";
import type { NegotiationTurnPayload } from "../shared/interfaces/agent-dispatcher.interface.js";
import { type NegotiationTurn, type NegotiationOutcome } from "./negotiation.state.js";
import { allowedActionsFor, ASK_USER_WINDOW_MS, fallbackActionFor, isRejectLikeAction, isTerminalAction, negotiationAskRoundsCap, negotiationHasMadeContact, readProtocolVersion, rejectActionFor } from "./negotiation.protocol.js";
import { assessConsultationEligibility, consultationPromptFor, type NegotiationConsultationReason } from "./negotiation.consultation-policy.js";
import { assessDeadlock, type DeadlockAssessment, type DeadlockShiftRecord } from "./negotiation.deadlock.js";
import type { NegotiationSeat, NegotiationProtocolVersion } from "../../protocol/schemas/negotiation-state.schema.js";
import { NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY, NEGOTIATION_QUESTION_GENERIC_NETWORK, isSafeAuthoredNegotiationQuestion, negotiationQuestionSettlementId } from './negotiation.question-safety.js';
import { NEGOTIATION_PARK_REASONING, type NegotiationStallReason } from './negotiation.stall-gap.js';
import { buildIntentSnapshots } from "./negotiation.intent-snapshot-provenance.js";
import { holdsNegotiationConversationLock } from "./negotiation.task-lock-policy.js";
import { isNegotiationTurnCapReached } from "./negotiation.turn-cap.js";
import { isTimeoutFailure } from "./negotiation.turn-failure.js";
import { expectedNegotiationSpeaker } from "./negotiation.expected-speaker.js";
import { buildSeededAttribution } from './negotiation.attribution.js';
import { buildAttributedDialogue, countNegotiationAskRounds, countPrincipalAskUserTurns, finalizeLog, hasPriorAskUser, initLog, memoryQueryText, negotiateCandidatesLog, resolveTaskAttribution, retrieveClientDm, retrieveMemory, turnLog, turnsFromMessages } from "./negotiation.graph.shared.js";
import { configuredQuestionBudgetPerPrincipal } from "./negotiation.checklist.contracts.js";
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
  // IND-564: an opening-move `withdraw` blocked before any message was
  // persisted ends the negotiation quietly — there is no in-task outreach to
  // retract, so the counterparty never learns the match existed. This is the
  // only route left to `screened_out`; the pre-first-turn outreach gate that
  // was its other author is gone.
  //
  // The invariant, asserted where the label is actually stamped:
  // `screened_out` is a claim that NOTHING was ever sent. It is the only
  // outcome that tells the owner the counterparty was never involved and never
  // notified, so it may not be applied to a negotiation whose own messages
  // contradict it. The opening-withdraw guard keeps this true upstream;
  // gating on contact here makes it unfalsifiable at the point of record. A
  // negotiation that has spoken falls through to the honest ends (a stall, an
  // error, a turn cap).
  const contactMade = negotiationHasMadeContact(history);
  const screenedOut = !contactMade && state.firstTurnScreenedOut === true;
  // The run ended because the acting agent kept failing, not because the two
  // sides ran out of things to say.
  //
  // `error` set with a failure run still open is exactly that condition: the
  // turn node sets `error` only at the consecutive-failure bound or when a
  // turn failed after its message was already persisted, and a landed turn
  // resets the run to zero. An init-time error (`busy`, an invalid
  // continuation) carries no failures, so it keeps today's outcome.
  const errorStalled = !screenedOut && !!state.error && state.consecutiveTurnFailures > 0;
  // The copy-loop guard ended the run (`negotiation.graph.turn.ts`): a drafted
  // turn repeated a message already on the record, and so did its one anti-echo
  // re-issue. Kept distinct from every neighbouring end because it is a
  // different fact from each of them — the agents did not run out of turns
  // (nothing was spent), the run did not error (a turn came back, it just said
  // nothing new), and nobody declined. `lastTurn` here is the last turn that
  // actually landed, which is why the reject-like mapping below must never see
  // this run as a decision: the repeated draft was never persisted.
  const repetitionStalled = !screenedOut && !errorStalled && state.repetitionStalled === true;
  // Failed turns no longer advance `turnCount`, so an error-stalled run is
  // normally nowhere near the cap. The guard is explicit anyway: "ran out of
  // turns" is a claim about a dialogue, and this is the outcome where the
  // dialogue is precisely what did not happen.
  const atCap = !screenedOut && !errorStalled && !repetitionStalled && isNegotiationTurnCapReached(state.turnCount, state.maxTurns) && !isTerminalAction(lastTurn?.action);

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
    // IND-611: a `screened_out` run is attributed to the turn that refused.
    // The withdrawing turn IS the decision — there is no separate record to
    // prefer over it now that the outreach gate is gone (IND-610 renders this
    // string in the owner-only gate-decision card).
    reasoning: lastTurn?.assessment?.reasoning ?? "",
    turnCount: state.turnCount,
    ...(screenedOut
      ? { reason: "screened_out" as const }
      : errorStalled
        ? { reason: "agent_error" as const }
        : repetitionStalled
          ? { reason: "repetition" as const }
          : atCap
            ? { reason: "turn_cap" as const }
            : {}),
  };

  // Unconcluded end: no opportunity, no explicit reject, and turns actually
  // happened — turn cap, timeout, or a plain stall. Feeds both the post-stall
  // park below and the legacy questioner enqueue further down.
  // An error-stalled run is deliberately NOT "unconcluded": it neither parks
  // with a question nor enqueues the blind stalled-followup questioner. Both
  // ask the client to settle something the dialogue exposed, and this run has
  // no dialogue to have exposed anything — the gap is ours, not theirs, and
  // asking them about it would dress an outage up as an information need. The
  // opportunity still ends `stalled`, so re-running remains the recovery.
  // A repetition stall stays UNCONCLUDED, unlike an error stall. The exchange
  // happened and exposed a real gap — in the observed case a question about the
  // client's own signal that nobody on either side could answer — so the park
  // that carries that gap back to the client is exactly the right recovery.
  const endedUnconcluded = !hasOpportunity && !screenedOut && !errorStalled
    && !isRejectLikeAction(lastTurn?.action) && state.turnCount > 0;
  const stallReason: NegotiationStallReason = atCap
    ? 'turn_cap'
    : isTimeoutFailure(state.error)
      ? 'timeout'
      : 'stalled';

  // ─── Post-stall park (conversational-questions plan) ──────────────────
  // Instead of ending silently, an unconcluded negotiation parks carrying
  // the ONE question that would let a retry conclude — authored by the
  // negotiator from this negotiation's transcript and the signal's client
  // DM, exactly the grounding the mid-flight consult uses. The gap is
  // persisted as an `ask_user` message in the negotiation's own record: the
  // parked negotiation is the only durable record of the information need,
  // the same substrate the per-side ration reads, and an `ask_user` last
  // message keeps the floor with the asking side on retry.
  //
  // Bounded per negotiation: past the ask-rounds cap the negotiation stalls
  // TERMINALLY — no authoring call, no park — so two agents cannot
  // ping-pong their humans indefinitely. Runs on continuations too (a
  // resumed negotiation may park again); the cap is what bounds the loop.
  //
  // Every failure — authoring, safety gate, persistence — degrades to
  // today's terminal stall. A park is additive state, never a new way for
  // finalize to fail.
  if (
    endedUnconcluded
    && deps.stallGapAuthor
    && state.opportunityId
    && state.sourceIntentId
    && state.indexContext.networkId
  ) {
    const askRounds = countNegotiationAskRounds(state.messages);
    const askRoundsCap = negotiationAskRoundsCap({ checklist: true });
    // The park asks THIS user a question, so it draws on their own budget as
    // well as on the negotiation-wide cap (checklist plan §3 rule 5). Without
    // this a negotiation could spend a principal's whole budget mid-flight and
    // still park one more question on them at the end — the flavour of the
    // park is not something the person on the other end experiences.
    const principalAsks = countPrincipalAskUserTurns(state.messages, state.sourceUser.id);
    // Under `advocate` the post-stall park was never bound by the per-side
    // ration — it is the mechanism that asks AFTER the consult is spent — so
    // the budget binds here only where the checklist protocol put every ask on
    // one counter.
    const principalBudget = configuredQuestionBudgetPerPrincipal();
    if (askRounds >= askRoundsCap || principalAsks >= principalBudget) {
      finalizeLog.info('negotiation_ask_cap_terminal', {
        taskId: state.taskId,
        opportunityId: state.opportunityId,
        askRounds,
        askRoundsCap,
        principalAsks,
        ...(Number.isFinite(principalBudget) && { principalBudget }),
        stallReason,
      });
      emitWide({
        type: 'negotiation_ask_cap_terminal',
        opportunityId: state.opportunityId,
        askRounds,
        askRoundsCap,
      });
    } else {
      try {
        const clientDm = await retrieveClientDm(deps, state.sourceUser.id, state.sourceIntentId);
        const parkIntent = state.sourceUser.intents.find((intent) => intent.id === state.sourceIntentId);
        const gap = await deps.stallGapAuthor.author({
          userName: state.sourceUser.profile.name ?? 'your user',
          signal: parkIntent
            ? { title: parkIntent.title, description: parkIntent.description }
            : { title: 'Signal', description: 'the signal attached to this match' },
          seedReasoning: state.seedAssessment.reasoning,
          history,
          stallReason,
          ...(clientDm.length > 0 && { clientDm }),
        });
        // Same identifier-aware gate as the mid-flight authored question, with
        // the same inputs in hand: the counterparty's name and the evaluator's
        // reasoning. An unsafe question never parks — there is no enum-only
        // downgrade here because a park without its gap records nothing.
        const counterpartyName = state.candidateUser.profile?.name?.trim();
        const seedReasoning = state.seedAssessment?.reasoning?.trim();
        const safeGap = gap && isSafeAuthoredNegotiationQuestion(gap.question, {
          ...(counterpartyName ? { forbiddenIdentifiers: [counterpartyName] } : {}),
          ...(seedReasoning ? { forbiddenSourceText: [seedReasoning] } : {}),
        });
        if (safeGap) {
          const parkTurn: NegotiationTurn = {
            action: 'ask_user',
            assessment: {
              reasoning: NEGOTIATION_PARK_REASONING,
              suggestedRoles: lastTurn?.assessment.suggestedRoles ?? { ownUser: 'peer', otherUser: 'peer' },
            },
            message: null,
            askUser: { reason: gap.reason, question: gap.question },
          };
          await deps.database.createMessage({
            conversationId: state.conversationId,
            senderId: `agent:${state.sourceUser.id}`,
            role: 'agent',
            parts: [{ kind: 'data', data: parkTurn }],
            taskId: state.taskId,
            ...(state.continuationExecution ? { continuationExecution: state.continuationExecution } : {}),
          });
          finalizeLog.info('negotiation_parked', {
            taskId: state.taskId,
            opportunityId: state.opportunityId,
            recipientUserId: state.sourceUser.id,
            recipientIntentId: state.sourceIntentId,
            askRounds: askRounds + 1,
            askRoundsCap,
            stallReason,
          });
          emitWide({
            type: 'negotiation_parked',
            opportunityId: state.opportunityId,
            negotiationConversationId: state.conversationId,
            askRounds: askRounds + 1,
            askRoundsCap,
            stallReason,
          });
        } else if (gap) {
          finalizeLog.warn('Dropping unsafe post-stall gap question; negotiation stalls without a park', {
            taskId: state.taskId,
            opportunityId: state.opportunityId,
          });
        }
      } catch (err) {
        finalizeLog.error('Failed to park stalled negotiation with its gap', {
          taskId: state.taskId,
          opportunityId: state.opportunityId,
          error: err,
        });
      }
    }
  }

  const lastFailure = state.turnFailures[state.turnFailures.length - 1];
  if (errorStalled) {
    finalizeLog.error('negotiation_error_stalled', {
      taskId: state.taskId,
      opportunityId: state.opportunityId || undefined,
      turnCount: state.turnCount,
      consecutiveTurnFailures: state.consecutiveTurnFailures,
      seat: lastFailure?.seat,
      lastError: lastFailure?.error,
    });
    if (state.opportunityId) {
      emitWide({
        type: 'negotiation_error_stalled',
        opportunityId: state.opportunityId,
        negotiationConversationId: state.conversationId,
        turnCount: state.turnCount,
        consecutiveTurnFailures: state.consecutiveTurnFailures,
        seat: lastFailure?.seat,
      });
    }
  }

  try {
    // The terminal status message is the second half of the durable trace:
    // `metadata.failedTurns` says what failed, this says that the failures are
    // why the task is over — readable without joining the artifact.
    await deps.database.updateTaskState(
      state.taskId,
      "completed",
      errorStalled
        ? {
            reason: 'negotiation_agent_error',
            consecutiveTurnFailures: state.consecutiveTurnFailures,
            ...(lastFailure?.seat && { seat: lastFailure.seat }),
            ...(lastFailure?.error && { lastError: lastFailure.error }),
          }
        : undefined,
      state.continuationExecution,
    );
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
      outcome: hasOpportunity ? 'accepted' : screenedOut ? 'screened_out' : errorStalled ? 'agent_error' : repetitionStalled ? 'repetition' : (atCap ? 'turn_cap' : (lastTurn?.action ?? 'unknown')),
      opportunityId: state.opportunityId || undefined,
    });

    if (state.opportunityId) {
      // screened_out → 'rejected': quiet terminal status (hidden from
      // default lists), never 'stalled' — with zero turns the generic
      // mapping would misfile the client's own gate decision.
      // `repetitionStalled` outranks the reject-like mapping: the last turn that
      // LANDED may well be a `question` or a `counter`, but if the guard ended
      // the run then no decision was reached and the row may not read as one.
      const nextStatus = lastTurn?.action === 'accept'
        ? 'pending'
        : repetitionStalled
          ? 'stalled'
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
    const emittedOutcome: "accepted" | "rejected_stalled" | "turn_cap" | "timed_out" | "screened_out" | "error_stalled" =
      hasOpportunity
        ? "accepted"
        : screenedOut
        ? "screened_out"
        : errorStalled
        ? "error_stalled"
        : atCap
        ? "turn_cap"
        : isTimeoutFailure(state.error)
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
  // Kept alongside the post-stall park above until the conversational-questions
  // delivery lane retires the blind questioner path.
  if (endedUnconcluded && state.opportunityId && state.sourceIntentId && state.indexContext.networkId && deps.questionerEnqueue && !state.continuationExecution) {
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
