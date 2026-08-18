/**
 * Negotiation graph, stage 3: one negotiator turn.
 */

import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { requestContext } from "../shared/observability/request-context.js";
import type { NegotiationContinuationReceipt } from "../shared/interfaces/database.interface.js";
import type { NegotiationTurnPayload } from "../shared/interfaces/agent-dispatcher.interface.js";
import { type NegotiationTurn, type NegotiationOutcome } from "./negotiation.state.js";
import { allowedActionsFor, askUserAnswerWindowMs, configuredAskUserEnabled, configuredProtocolVersion, fallbackActionFor, isRejectLikeAction, isTerminalAction, readProtocolVersion, rejectActionFor } from "./negotiation.protocol.js";
import { assessConsultationEligibility, consultationPromptFor, negotiationConsultationPolicyMode, type NegotiationConsultationReason } from "./negotiation.consultation-policy.js";
import { blocksNegotiationBeforeFirstTurn, type ScreenDecision, type ScreenDecisionRecord } from "./negotiation.screen.js";
import { configuredScreenMode } from "./negotiation.screen.contracts.js";
import { assessDeadlock, configuredDeadlockShiftEnabled, configuredDeadlockThreshold, type DeadlockAssessment, type DeadlockShiftRecord } from "./negotiation.deadlock.js";
import type { NegotiationSeat, NegotiationProtocolVersion } from "../shared/schemas/negotiation-state.schema.js";
import { NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY, NEGOTIATION_QUESTION_GENERIC_NETWORK, negotiationQuestionSettlementId } from './negotiation.question-safety.js';
import { buildIntentSnapshots } from "./negotiation.intent-snapshot-provenance.js";
import { holdsNegotiationConversationLock } from "./negotiation.task-lock-policy.js";
import { isNegotiationTurnCapReached } from "./negotiation.turn-cap.js";
import { expectedNegotiationSpeaker } from "./negotiation.expected-speaker.js";
import { buildSeededAttribution } from './negotiation.attribution.js';
import { buildAttributedDialogue, finalizeLog, hasPriorAskUser, initLog, memoryQueryText, negotiateCandidatesLog, resolveTaskAttribution, retrieveClientDm, retrieveMemory, screenNodeLog, turnLog, turnsFromMessages } from "./negotiation.graph.shared.js";
import type { NegotiationGraphDeps, NegotiationState } from "./negotiation.graph.shared.js";


export async function turnNode(state: NegotiationState, deps: NegotiationGraphDeps) {
  const traceEmitter = requestContext.getStore()?.traceEmitter;
  // Local helper to emit events whose shape is wider than the declared
  // `TraceEmitter` union. The chat agent already casts at its relay sink;
  // here we localize the cast at the callsite so the rest of the body stays typed.
  const emitWide = (event: Record<string, unknown>) =>
    (traceEmitter as ((e: Record<string, unknown>) => void) | undefined)?.(event);
  const agentName = "Index negotiator";
  const agentStart = Date.now();
  traceEmitter?.({ type: "agent_start", name: agentName });

  try {
    const history: NegotiationTurn[] = turnsFromMessages(state.messages);

    const isSource = state.currentSpeaker === "source";
    const ownUser = isSource ? state.sourceUser : state.candidateUser;
    const otherUser = isSource ? state.candidateUser : state.sourceUser;
    const ownIntentId = isSource ? state.sourceIntentId : state.candidateIntentId;

    // Determine if this is the system agent's final allowed turn.
    const isFinalTurn = isNegotiationTurnCapReached(state.turnCount + 1, state.maxTurns);

    // Seat attribution keys on initiatorUserId (rigid v2 stamp), never on
    // parity or source/candidate position — under the conversation-scoped
    // tie-break this run's source may hold the counterparty seat.
    const version = state.protocolVersion ?? 'v1';
    const seat: NegotiationSeat = ownUser.id === (state.initiatorUserId ?? state.sourceUser.id)
      ? 'initiator'
      : 'counterparty';

    // Legacy ask_user availability (P3.2): flag on, full pause loop wired
    // (questioner + answer-window timer + an opportunity to resume
    // against), v2 non-final non-opening turn, and this side's one client
    // consultation not yet spent (rationing). Shadow is observational and
    // must preserve this legacy path byte-for-byte except for telemetry.
    const policyMode = negotiationConsultationPolicyMode();
    const askUserAvailable =
      version === 'v2'
      && !isFinalTurn
      && configuredAskUserEnabled()
      && !!deps.questionerEnqueue
      && !!deps.timeoutQueue?.enqueueAskUserExpiry
      && !!state.opportunityId
      && !!ownIntentId
      && !!state.indexContext.networkId
      && !(state.turnCount === 0 && !state.isContinuation)
      && !hasPriorAskUser(state.messages, ownUser.id);

    // ─── Deadlock detection → persuasion→bargaining stance (IND-428) ──────
    // Deterministic trailing-run inspection of the persisted history — no
    // LLM in the decision. Gated on the strict default-off flag AND v2,
    // checked alongside the protocol-version plumbing so v1 semantics stay
    // untouched. Fail-open: any detection error means "no deadlock" and
    // the legacy path proceeds byte-identically. The shift changes the
    // system agent's drafting stance only — allowedActions, the dispatch
    // payload, and all termination rules are untouched.
    let deadlock: DeadlockAssessment | null = null;
    if (version === 'v2' && configuredDeadlockShiftEnabled()) {
      try {
        deadlock = assessDeadlock(history, configuredDeadlockThreshold());
      } catch (err) {
        turnLog.warn('Deadlock detection failed; proceeding without mode shift', {
          taskId: state.taskId,
          error: err instanceof Error ? err.message : String(err),
        });
        deadlock = null;
      }
    }
    const bargainingMode = deadlock?.deadlocked === true;

    // P5.3: the speaker's own negotiator memory (cached per side across
    // turns). Injected into both the dispatch payload (the user's own
    // agent — scope-correct) and the system-agent prompt.
    const ownSide: "source" | "candidate" = isSource ? "source" : "candidate";
    const ownMemory = state.memoryBySide?.[ownSide]
      ?? (deps.memoryRetrieve
        ? await retrieveMemory(deps, ownUser.id, otherUser.id, memoryQueryText(state, otherUser), "turn")
        : []);

    const payload: NegotiationTurnPayload = {
      negotiationId: state.taskId,
      ownUser,
      otherUser,
      indexContext: state.indexContext,
      seedAssessment: state.seedAssessment,
      history,
      isFinalTurn,
      isDiscoverer: isSource,
      seat,
      protocolVersion: version,
      allowedActions: [...allowedActionsFor(version, seat, isFinalTurn, { askUser: askUserAvailable })],
      ...(state.discoveryQuery && isSource && { discoveryQuery: state.discoveryQuery }),
      ...(ownMemory.length > 0 && { negotiatorMemory: ownMemory }),
      ...(state.privateConsultation?.recipientUserId === ownUser.id
        ? { privateConsultation: state.privateConsultation }
        : {}),
      ...(state.continuationExecution
        ? {
            timeoutContinuation: {
              priorTaskId: state.continuationExecution.taskId,
              settlementId: state.continuationExecution.settlementId,
              successorTaskId: state.continuationExecution.successorTaskId,
              token: state.continuationExecution.token,
              fence: state.continuationExecution.fence,
            },
          }
        : {}),
    };

    const scope = { action: 'manage:negotiations', scopeType: 'network', scopeId: state.indexContext.networkId };

    const dispatchResult = await deps.dispatcher.dispatch(ownUser.id, scope, payload, { timeoutMs: state.timeoutMs });

    let turn: NegotiationTurn;

    if (dispatchResult.handled) {
      // Personal agent responded. Under v2, coerce out-of-seat actions to
      // the conservative fallback — the polling/respond surfaces reject
      // these with a 400, but locally-dispatched turns land here directly.
      turn = dispatchResult.turn;
      if (version === 'v2' && !allowedActionsFor(version, seat, isFinalTurn, { askUser: askUserAvailable }).includes(turn.action)) {
        turnLog.warn('Personal agent returned out-of-seat action, coercing to conservative fallback', {
          action: turn.action, seat, isFinalTurn,
        });
        turn = { ...turn, action: fallbackActionFor(version, seat, isFinalTurn) };
      }
    } else if (dispatchResult.reason === 'waiting') {
      // Long timeout — graph suspends. Persist the full turn context so the
      // polling agent (and MCP consumers via get_negotiation) reconstruct
      // the same view the in-process system agent would see. The view is
      // stored in absolute source/candidate terms; perspective is projected
      // at pickup time using the claiming user's id.
      traceEmitter?.({ type: "agent_end", name: agentName, durationMs: Date.now() - agentStart, summary: "waiting_for_agent" });
      await deps.database.setTaskTurnContext(state.taskId, {
        sourceUser: state.sourceUser,
        candidateUser: state.candidateUser,
        indexContext: state.indexContext,
        seedAssessment: state.seedAssessment,
        // Keep discoveryQuery speaker-scoped: include it only when the
        // parked turn belongs to the discoverer (source). Persisting it on
        // candidate-side turns would make the pickup prompt frame the
        // search as "your user searched for X" for the wrong user.
        ...(isSource && state.discoveryQuery && { discoveryQuery: state.discoveryQuery }),
        ...(state.privateConsultation && state.privateConsultation.recipientUserId === ownUser.id
          ? { privateConsultation: state.privateConsultation }
          : {}),
      }, state.continuationExecution);
      await deps.database.updateTaskState(
        state.taskId,
        "waiting_for_agent",
        undefined,
        state.continuationExecution,
        dispatchResult.resumeToken,
      );
      return { status: 'waiting_for_agent' as const };
    } else {
      // No personal agent or timeout — run system agent
      const agentPriorDialogue = buildAttributedDialogue(state);

      // ─── A2H: the acting user's own negotiator DM for this signal ──────
      // Retrieved HERE, inside the system-agent branch, rather than beside
      // `ownMemory` above. Two reasons, and the first is the constraint:
      //
      // 1. `payload` is built and dispatched before this point, so the
      //    excerpt cannot reach an external agent by a later edit — the
      //    value does not exist in that scope. Memory is safe to forward
      //    (distilled standing rules); a verbatim excerpt of the client's
      //    private thread with their own negotiator is not, and an external
      //    registered agent can hold the personal-agent seat.
      // 2. A dispatched turn never reads it, so it never pays for the query.
      //
      // Gated on `askUserAvailable`: the grant is settled before the model
      // runs, so the DM is present on exactly the turns where the agent may
      // consult its client — the turns where knowing what they already said
      // changes what it asks. Fetching it on every turn would move the
      // prompt for every negotiation, not just the consulting ones.
      // `askUserAvailable` already requires a non-empty `ownIntentId`.
      const clientDm = askUserAvailable
        ? await retrieveClientDm(deps, ownUser.id, ownIntentId!)
        : [];
      turn = await deps.systemAgent.invoke({
        ownUser,
        otherUser,
        indexContext: state.indexContext,
        seedAssessment: state.seedAssessment,
        history,
        isFinalTurn,
        isDiscoverer: isSource,
        seat,
        protocolVersion: version,
        ...(state.discoveryQuery && isSource && { discoveryQuery: state.discoveryQuery }),
        isContinuation: state.isContinuation,
        ...(agentPriorDialogue && { priorDialogue: agentPriorDialogue }),
        ...(state.userAnswers.length > 0 && { userAnswers: state.userAnswers }),
        ...(askUserAvailable && { canAskUser: true }),
        ...(bargainingMode && { bargaining: { consecutiveNonConvergent: deadlock!.consecutiveNonConvergent } }),
        ...(ownMemory.length > 0 && { memory: ownMemory }),
        ...(clientDm.length > 0 && { clientDm }),
        ...(state.privateConsultation?.recipientUserId === ownUser.id
          ? { privateConsultation: state.privateConsultation }
          : {}),
      });
    }

    traceEmitter?.({ type: "agent_end", name: agentName, durationMs: Date.now() - agentStart, summary: `${turn.action}` });

    // IND-564 / IND-611: the opening-withdraw guard runs BEFORE the turn-0
    // opening force below. Order matters and used to be inverted: the force
    // rewrote a turn-0 `withdraw` into `outreach` first, which (a) made this
    // guard dead code for a v2 initiator on turn 0 and (b) sent an outreach
    // whose surviving `reasoning` argued against the match to the
    // counterparty. An honest turn-0 refusal is now allowed to stand and
    // flows into the existing quiet `screened_out` path — no message is
    // persisted, so the original guard's intent (never retract a message
    // that was never made) is preserved rather than weakened.
    //
    // Exact ask_user resumes are exempt: the successor is the SAME logical
    // negotiation resumed after the client answered, so post-consultation
    // withdraw is legitimate.
    if (turn.action === 'withdraw' && !state.outreachOpened && !state.continuationExecution) {
      turnLog.info('negotiation_opening_withdraw_screened_out', {
        taskId: state.taskId,
        opportunityId: state.opportunityId || undefined,
        seat,
        turnCount: state.turnCount,
        isContinuation: state.isContinuation,
      });
      traceEmitter?.({ type: "agent_end", name: agentName, durationMs: Date.now() - agentStart, summary: "screened_out: opening withdraw" });
      return { lastTurn: turn, firstTurnScreenedOut: true };
    }

    // First turn must open the negotiation (unless continuing a prior
    // conversation): v1 → "propose"; v2 initiator → "outreach". A v2 turn-0
    // speaker holding the counterparty seat (tie-break inheritance) is left
    // unforced — it is responding, not opening.
    //
    // A legitimate turn-0 refusal never reaches here: the opening-withdraw
    // guard above already returned. What remains are genuinely malformed
    // openings (a turn-0 `counter`/`question`), which are still coerced.
    if (state.turnCount === 0 && !state.isContinuation) {
      const openingAction = version === 'v2' ? 'outreach' : 'propose';
      if ((version !== 'v2' || seat === 'initiator') && turn.action !== openingAction) {
        turnLog.warn(`Agent returned unexpected action on turn 0, forcing to ${openingAction}`, { action: turn.action });
        turn.action = openingAction;
      }
    }

    // IND-508 deterministic admission is evaluated only after the opening
    // guard but before any turn is persisted. It consumes action/role enums
    // only; free-form reasoning, messages, profiles, and evaluator inputs
    // are intentionally unavailable to the policy.
    let consultationPolicyReason: NegotiationConsultationReason | undefined;
    const policyEligibility = policyMode === 'off' ? { eligible: false } : assessConsultationEligibility({
      protocolVersion: version,
      seat,
      isOpeningTurn: state.turnCount === 0 && !state.isContinuation,
      isFinalTurn,
      screenedOut: blocksNegotiationBeforeFirstTurn(state.screenDecision, state.turnCount),
      action: turn.action,
      ownSuggestedRole: turn.assessment?.suggestedRoles?.ownUser,
      priorActions: history.map((prior) => prior.action),
      previouslyConsulted: hasPriorAskUser(state.messages, ownUser.id),
      hasExactResumeCoordinate: Boolean(
        configuredAskUserEnabled()
        && deps.questionerEnqueue
        && deps.timeoutQueue?.enqueueAskUserExpiry
        && state.taskId
        && state.opportunityId
        && ownIntentId
        && state.indexContext.networkId,
      ),
      lifecycleValid: Boolean(state.taskId && state.opportunityId && ownIntentId && state.indexContext.networkId),
    });
    const emitConsultationTelemetry = (stage: 'eligible' | 'asked', reason: NegotiationConsultationReason) => {
      turnLog.info('negotiation_consultation_policy', { stage, mode: policyMode, reason });
      emitWide({ type: 'negotiation_consultation_policy', stage, mode: policyMode, reason });
    };
    if (policyEligibility.eligible && policyEligibility.reason) {
      emitConsultationTelemetry('eligible', policyEligibility.reason);
      if (policyMode === 'on') {
        consultationPolicyReason = policyEligibility.reason;
        turn = {
          ...turn,
          action: 'ask_user',
          message: null,
          assessment: {
            reasoning: 'Client consultation required.',
            suggestedRoles: turn.assessment.suggestedRoles,
          },
          askUser: { reason: consultationPolicyReason },
        };
        emitConsultationTelemetry('asked', consultationPolicyReason);
      }
    }

    // Safety net: off/shadow retain legacy behavior. In on, a spontaneous
    // ask_user is admissible only when the deterministic policy just
    // authorized it, so no unbounded pause can enter shared history.
    if (turn.action === 'ask_user' && (!askUserAvailable || (policyMode === 'on' && !consultationPolicyReason))) {
      turnLog.warn('ask_user emitted while unavailable, coercing to conservative fallback', {
        seat, isFinalTurn, taskId: state.taskId,
      });
      turn = { ...turn, action: fallbackActionFor(version, seat, isFinalTurn) };
    }

    // ─── Deadlock shift record (IND-428) ───────────────────────────────
    // Applied-stance analytics: recorded once per session, on the first
    // turn actually drafted in the bargaining stance (the system agent —
    // externally dispatched turns never receive the stance). Internal
    // metadata only: persisted to tasks.metadata.deadlockShift via the
    // optional hook; negotiation API surfaces project specific fields and
    // never return task metadata verbatim. Every step fails open.
    const bargainingApplied = bargainingMode && !dispatchResult.handled;
    let deadlockShiftRecord: DeadlockShiftRecord | null = null;
    if (bargainingApplied && !state.deadlockShift) {
      deadlockShiftRecord = {
        reason: 'consecutive_non_convergent',
        consecutiveNonConvergent: deadlock!.consecutiveNonConvergent,
        threshold: deadlock!.threshold,
        shiftedAtTurn: state.turnCount,
        seat,
        detectedAt: new Date().toISOString(),
      };
      await deps.database.setTaskDeadlockShift?.(state.taskId, deadlockShiftRecord as unknown as Record<string, unknown>, state.continuationExecution).catch((err) => {
        turnLog.error('Failed to persist deadlock shift record', { taskId: state.taskId, error: err });
      });
      turnLog.info('negotiation_deadlock_shift', {
        taskId: state.taskId,
        opportunityId: state.opportunityId || undefined,
        seat,
        consecutiveNonConvergent: deadlockShiftRecord.consecutiveNonConvergent,
        threshold: deadlockShiftRecord.threshold,
        turnIndex: state.turnCount,
      });
      if (state.opportunityId) {
        emitWide({
          type: 'negotiation_deadlock_shift',
          opportunityId: state.opportunityId,
          negotiationConversationId: state.conversationId,
          turnIndex: state.turnCount,
          actor: isSource ? 'source' : 'candidate',
          consecutiveNonConvergent: deadlockShiftRecord.consecutiveNonConvergent,
          threshold: deadlockShiftRecord.threshold,
        });
      }
    }

    const parts = [{ kind: "data" as const, data: turn }];
    const message = await deps.database.createMessage({
      conversationId: state.conversationId,
      senderId: `agent:${ownUser.id}`,
      role: "agent",
      parts,
      taskId: state.taskId,
      ...(state.continuationExecution ? { continuationExecution: state.continuationExecution } : {}),
    });

    // ─── ask_user pause (P3.2) ────────────────────────────────────────────
    // The negotiator consults its OWN client: persist the turn (done above),
    // park the full turn context, arm the answer-window timer, enqueue the
    // question through the negotiation_inflight preset, then suspend the
    // task as input_required. The graph exits at this turn boundary exactly
    // like the waiting_for_agent suspend; the answer (or window expiry)
    // resumes via the run-existing continuation path.
    if (turn.action === 'ask_user') {
      const consultationReason = turn.askUser?.reason;
      const safeAskUser = consultationReason
        ? consultationPromptFor(consultationReason)
        : null;
      const settlementId = negotiationQuestionSettlementId(state.taskId);

      const askUserBinding = await deps.database.captureNegotiationAskUserBinding({
        taskId: state.taskId,
        settlementId,
        recipientUserId: ownUser.id,
        recipientIntentId: ownIntentId!,
        opportunityId: state.opportunityId,
        networkId: state.indexContext.networkId,
        turnContext: {
          sourceUser: state.sourceUser,
          candidateUser: state.candidateUser,
          indexContext: state.indexContext,
          seedAssessment: state.seedAssessment,
          ...(isSource && state.discoveryQuery && { discoveryQuery: state.discoveryQuery }),
          ...(consultationReason && { consultationPolicyReason: consultationReason }),
        },
        ...(state.continuationExecution ? { continuationExecution: state.continuationExecution } : {}),
      });

      // Arm the timer BEFORE flipping state: it is the durable recovery
      // trigger even when generation enqueues no job or persists no row.
      const windowMs = askUserAnswerWindowMs();
      await deps.timeoutQueue!.enqueueAskUserExpiry!(state.taskId, {
        settlementId,
        opportunityId: state.opportunityId,
        userId: ownUser.id,
        recipientIntentId: ownIntentId!,
        networkId: state.indexContext.networkId,
        intentFingerprint: askUserBinding.intentFingerprint,
        opportunityStatus: askUserBinding.opportunityStatus,
        opportunityUpdatedAt: askUserBinding.opportunityUpdatedAt,
        counterpartyUserId: askUserBinding.counterpartyUserId,
        counterpartyIntentId: askUserBinding.counterpartyIntentId,
      }, windowMs);

      // Persistence admission requires the exact task to be input_required.
      // Flip before enqueue; if the structured ask_user fields fail the
      // deterministic privacy gate, the timer alone closes the exact task.
      await deps.database.updateTaskState(state.taskId, 'input_required', undefined, state.continuationExecution);
      if (safeAskUser) {
        const userContext = (await deps.database.getUserContext(ownUser.id, null).catch(() => null))?.text ?? '';
        await deps.questionerEnqueue!({
          mode: 'negotiation_inflight',
          purpose: 'inflight_consultation',
          userId: ownUser.id,
          sourceType: 'opportunity',
          sourceId: state.opportunityId,
          negotiation: {
            purpose: 'inflight_consultation',
            recipientUserId: ownUser.id,
            recipientIntentId: ownIntentId!,
            opportunityId: state.opportunityId,
            taskId: state.taskId,
            networkId: state.indexContext.networkId,
          },
          context: {
            negotiationId: state.taskId,
            counterpartyHint: NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY,
            indexContext: NEGOTIATION_QUESTION_GENERIC_NETWORK,
            consultationPolicyReason: consultationReason!,
            ...(userContext && { userContext }),
          },
        }).catch((error) => {
          turnLog.error('Failed to enqueue safe ask_user question; timeout recovery remains armed', {
            taskId: state.taskId,
            opportunityId: state.opportunityId,
            error,
          });
        });
      } else {
        turnLog.warn('Skipping unsafe or incomplete ask_user question generation', {
          taskId: state.taskId,
          opportunityId: state.opportunityId,
        });
      }

      turnLog.info('negotiation_ask_user_pause', {
        taskId: state.taskId,
        opportunityId: state.opportunityId,
        seat,
        askingUserId: ownUser.id,
        windowMs,
      });
      traceEmitter?.({ type: "agent_end", name: agentName, durationMs: Date.now() - agentStart, summary: "ask_user" });
      emitWide({
        type: 'negotiation_ask_user',
        opportunityId: state.opportunityId,
        negotiationConversationId: state.conversationId,
        turnIndex: state.turnCount,
        actor: isSource ? 'source' : 'candidate',
        questionGenerationSafe: Boolean(safeAskUser),
        windowMs,
      });

      return {
        messages: [{
          id: message.id,
          senderId: message.senderId,
          role: "agent" as const,
          parts: message.parts,
          createdAt: message.createdAt,
        }],
        turnCount: state.turnCount + 1,
        lastTurn: turn,
        status: 'input_required' as const,
        ...(deadlockShiftRecord && { deadlockShift: deadlockShiftRecord }),
      };
    }

    await deps.database.updateTaskState(state.taskId, "working", undefined, state.continuationExecution);

    if (state.opportunityId) {
      emitWide({
        type: "negotiation_turn",
        opportunityId: state.opportunityId,
        negotiationConversationId: state.conversationId,
        turnIndex: state.turnCount,
        actor: isSource ? "source" : "candidate",
        action: turn.action,
        ...(turn.assessment?.reasoning && { reasoning: turn.assessment.reasoning }),
        ...(turn.message && { message: turn.message }),
        ...(turn.assessment?.suggestedRoles && { suggestedRoles: turn.assessment.suggestedRoles }),
        durationMs: Date.now() - agentStart,
      });
    }

    return {
      messages: [{
        id: message.id,
        senderId: message.senderId,
        role: "agent" as const,
        parts: message.parts,
        createdAt: message.createdAt,
      }],
      turnCount: state.turnCount + 1,
      currentSpeaker: (isSource ? "candidate" : "source") as "source" | "candidate",
      lastTurn: turn,
      memoryBySide: { [ownSide]: ownMemory },
      // Record the in-task outreach so a later `withdraw` is legal (IND-564).
      ...(turn.action === 'outreach' && { outreachOpened: true }),
      ...(deadlockShiftRecord && { deadlockShift: deadlockShiftRecord }),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    turnLog.error("Agent invocation failed", { error: errMsg, stack: err instanceof Error ? err.stack : undefined, turnCount: state.turnCount });
    traceEmitter?.({ type: "agent_end", name: agentName, durationMs: Date.now() - agentStart, summary: `error: ${errMsg}` });
    const errorSeat: NegotiationSeat = (state.currentSpeaker === 'source' ? state.sourceUser.id : state.candidateUser.id) === (state.initiatorUserId ?? state.sourceUser.id)
      ? 'initiator'
      : 'counterparty';
    return {
      lastTurn: {
        action: rejectActionFor(state.protocolVersion ?? 'v1', errorSeat),
        assessment: { reasoning: `Agent error: ${errMsg}`, suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const } },
      },
      turnCount: state.turnCount + 1,
      error: `Turn failed: ${errMsg}`,
    };
  }
}
