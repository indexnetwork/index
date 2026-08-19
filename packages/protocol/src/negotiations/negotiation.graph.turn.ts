/**
 * Negotiation graph, stage 3: one negotiator turn.
 */

import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { requestContext } from "../shared/observability/request-context.js";
import type { NegotiationContinuationReceipt } from "../shared/interfaces/database.interface.js";
import type { NegotiationTurnPayload } from "../shared/interfaces/agent-dispatcher.interface.js";
import { type NegotiationTurn, type NegotiationOutcome } from "./negotiation.state.js";
import { allowedActionsFor, askUserAnswerWindowMs, configuredAskUserEnabled, configuredProtocolVersion, fallbackActionFor, isRejectLikeAction, isTerminalAction, negotiationAskRoundsCap, readProtocolVersion } from "./negotiation.protocol.js";
import { assessConsultationEligibility, consultationPromptFor, countOpenPreContactConsults, isPreContactConsultResume, MAX_OPEN_PRE_CONTACT_CONSULTS_PER_INTENT, negotiationConsultationPolicyMode, PRE_CONTACT_CONSULT_MARKER, type NegotiationConsultationReason } from "./negotiation.consultation-policy.js";
import { blocksNegotiationBeforeFirstTurn, type ScreenDecision, type ScreenDecisionRecord } from "./negotiation.screen.js";
import { configuredScreenMode } from "./negotiation.screen.contracts.js";
import { assessDeadlock, configuredDeadlockShiftEnabled, configuredDeadlockThreshold, type DeadlockAssessment, type DeadlockShiftRecord } from "./negotiation.deadlock.js";
import type { NegotiationSeat, NegotiationProtocolVersion } from "../shared/schemas/negotiation-state.schema.js";
import { NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY, NEGOTIATION_QUESTION_GENERIC_NETWORK, isSafeAuthoredNegotiationQuestion, negotiationQuestionSettlementId } from './negotiation.question-safety.js';
import { buildIntentSnapshots } from "./negotiation.intent-snapshot-provenance.js";
import { holdsNegotiationConversationLock } from "./negotiation.task-lock-policy.js";
import { isNegotiationTurnCapReached } from "./negotiation.turn-cap.js";
import { appendTurnFailure, turnFailureBoundReached, type NegotiationTurnFailure } from "./negotiation.turn-failure.js";
import { expectedNegotiationSpeaker } from "./negotiation.expected-speaker.js";
import { buildSeededAttribution } from './negotiation.attribution.js';
import { askedChecklistTopics, buildAttributedDialogue, countNegotiationAskRounds, countPrincipalAskUserTurns, finalizeLog, initLog, memoryQueryText, negotiateCandidatesLog, resolveTaskAttribution, retrieveClientDm, retrieveMemory, screenNodeLog, turnLog, turnsFromMessages } from "./negotiation.graph.shared.js";
import { configuredNegotiatorStance, stanceUsesChecklist } from "./negotiation.stance.contracts.js";
import { assessAskAdmissibility, authorChecklist, checklistFromTurns, checklistVerdictState, configuredQuestionBudgetPerPrincipal, isChecklistAuthored, reconcileChecklist, ChecklistDraftSchema, type ChecklistItem } from "./negotiation.checklist.contracts.js";
import type { NegotiationGraphDeps, NegotiationState } from "./negotiation.graph.shared.js";


/**
 * Whether this signal may open another pre-contact consultation.
 *
 * The count comes from the user's own parked negotiation tasks — the durable
 * parks themselves — rather than a stored counter, so an answered, expired, or
 * resumed park frees its slot with nothing to keep in step. The acting task is
 * excluded: it is `working` at this point, but a retried turn on a task that
 * already parked must not count itself out.
 *
 * Fails OPEN. This bound defends against an agent that would re-ask the same
 * signal-level question candidate by candidate; it is not the safety gate. The
 * per-negotiation ration and the ask-rounds cap already hold that line from
 * the message record, and neither depends on this query — so a database blip
 * must not silently retire the turn-0 verdict.
 */
async function preContactConsultsUnderCap(
  deps: NegotiationGraphDeps,
  userId: string,
  intentId: string,
  actingTaskId: string,
): Promise<boolean> {
  try {
    const parked = await deps.database.getTasksForUser(userId, { state: 'input_required' });
    const open = countOpenPreContactConsults(parked, { userId, intentId, excludeTaskId: actingTaskId });
    if (open >= MAX_OPEN_PRE_CONTACT_CONSULTS_PER_INTENT) {
      turnLog.info('negotiation_pre_contact_consult_capped', {
        userId, intentId, open, cap: MAX_OPEN_PRE_CONTACT_CONSULTS_PER_INTENT,
      });
      return false;
    }
    return true;
  } catch (err) {
    turnLog.warn('Pre-contact consult cap check failed; proceeding without the per-signal bound', {
      userId,
      intentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}

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

  // Resolved before the try because a FAILED turn has to name its seat too:
  // the whole point of the failure record is that the seat which cannot get a
  // turn out of its agent is the first thing an investigation needs. Keys on
  // initiatorUserId (rigid v2 stamp), never on parity or source/candidate
  // position — under the conversation-scoped tie-break this run's source may
  // hold the counterparty seat.
  const actingSeat: NegotiationSeat =
    (state.currentSpeaker === "source" ? state.sourceUser : state.candidateUser).id
      === (state.initiatorUserId ?? state.sourceUser.id)
      ? 'initiator'
      : 'counterparty';
  // Whether this attempt already put a turn into the shared conversation.
  // Everything after that point — the ask_user park, the state flip — can
  // still throw, and such a failure must NOT be retried: the turn is on the
  // record, and running the seat again would persist a second one. Only a
  // failure that produced nothing is a free retry.
  let turnPersisted = false;

  try {
    const history: NegotiationTurn[] = turnsFromMessages(state.messages);

    const isSource = state.currentSpeaker === "source";
    const ownUser = isSource ? state.sourceUser : state.candidateUser;
    const otherUser = isSource ? state.candidateUser : state.sourceUser;
    const ownIntentId = isSource ? state.sourceIntentId : state.candidateIntentId;

    // Determine if this is the system agent's final allowed turn.
    const isFinalTurn = isNegotiationTurnCapReached(state.turnCount + 1, state.maxTurns);

    const version = state.protocolVersion ?? 'v1';
    const seat: NegotiationSeat = actingSeat;

    // ask_user availability (P3.2): flag on, full pause loop wired
    // (questioner + answer-window timer + an opportunity to resume
    // against), v2 non-final non-opening turn, and this principal's question
    // budget not yet spent. Shadow is observational and must preserve this
    // legacy path byte-for-byte except for telemetry.
    //
    // The negotiation-wide ask-rounds cap reads the same message substrate as
    // the per-principal budget, and sits above it: it bounds both sides
    // combined — post-stall parks, which also persist `ask_user` messages,
    // included — so a negotiation near its cap cannot spend a further round
    // here even when the acting principal still has budget left.
    const policyMode = negotiationConsultationPolicyMode();
    // The opening turn, before anything is sent. `outreachOpened` is per-run
    // and history is this negotiation's own record, so this is true exactly
    // once per negotiation — and stays true across a pre-contact park, whose
    // resume re-enters holding nothing but its own `ask_user` turn.
    const isFreshOpeningTurn = state.turnCount === 0 && !state.isContinuation;
    const isPreContactResume = state.turnCount === 0 && isPreContactConsultResume(history);
    // Pre-contact consultation (the turn-0 third verdict). The initiator may
    // consult its client BEFORE deciding whether to reach out, so the seat's
    // opening vocabulary stops being binary. Everything downstream is the
    // shipped consult loop unchanged: same park, same binding, same question
    // routing, same expiry. Only admission moves.
    //
    // Bounded twice over. Per negotiation by the same ration and ask-rounds
    // cap the mid-flight consult reads (this consult IS round 1). Per signal
    // by the open-park count below, so one vague intent cannot interrogate
    // its client candidate-by-candidate.
    const preContactConsultShapeAvailable = isFreshOpeningTurn && seat === 'initiator';
    // ─── The checklist protocol (checklist plan §2–§6) ────────────────────
    // Stance-scoped, like every other rule it restructures: `advocate` runs
    // the pre-checklist negotiation unchanged, which is what keeps its prompt
    // AND its generation schema byte-identical. Resolved here because the
    // grant below depends on it — the per-principal question budget replaces
    // the one-consultation ration only where the protocol that spends it is
    // live.
    const stance = configuredNegotiatorStance();
    const checklistActive = stanceUsesChecklist(stance);
    // The frozen dimensions, re-derived from this negotiation's own turns
    // rather than carried in the channel: `state.messages` is scoped to this
    // negotiation and spans its sessions, so a continuation, a retry and a
    // fresh process all read the same checklist.
    const frozenChecklist: ChecklistItem[] = checklistActive ? checklistFromTurns(history) : [];
    const questionsSpent = countPrincipalAskUserTurns(state.messages, ownUser.id);
    const askedTopics = checklistActive ? askedChecklistTopics(state.messages, ownUser.id) : [];
    const askedDimensions = askedTopics.map((topic) => topic.dimension);
    // One question budget per principal per negotiation, the turn-0
    // pre-contact consult included. Under `advocate` the budget is 1, which is
    // exactly the legacy `hasPriorAskUser` ration expressed as a count.
    const questionBudget = configuredQuestionBudgetPerPrincipal();
    const askUserWiringAvailable =
      version === 'v2'
      && !isFinalTurn
      && configuredAskUserEnabled()
      && !!deps.questionerEnqueue
      && !!deps.timeoutQueue?.enqueueAskUserExpiry
      && !!state.opportunityId
      && !!ownIntentId
      && !!state.indexContext.networkId
      && (!isFreshOpeningTurn || preContactConsultShapeAvailable)
      && questionsSpent < questionBudget
      && countNegotiationAskRounds(state.messages) < negotiationAskRoundsCap({ checklist: checklistActive });
    const askUserAvailable = askUserWiringAvailable
      && (!preContactConsultShapeAvailable
        || await preContactConsultsUnderCap(deps, ownUser.id, ownIntentId!, state.taskId));

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
      ...(checklistActive
        ? {
            checklist: frozenChecklist,
            questionBudget: { spent: questionsSpent, total: questionBudget },
            ...(askedDimensions.length > 0 && { askedDimensions }),
          }
        : {}),
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
      // Read on EVERY turn under the checklist protocol, not only the turns
      // where the agent may ask. This was gated on `askUserAvailable` — the DM
      // was present exactly when the agent might ask something, on the theory
      // that knowing what the client already said changes what it asks. But
      // the answers matter most AFTER they are given: on a turn with the grant
      // spent, the negotiator argued the client's case having never read a word
      // the client wrote about this signal.
      //
      // That is also what plan §2 requires. The commitment store is the
      // client's own intents, premises, and ANSWERS; a dimension may be scored
      // from them. An answer the negotiator cannot see cannot score anything,
      // so the same question stays open and gets asked again.
      //
      // Still in-process only, for the reason above: the excerpt is never
      // forwarded to `NegotiationTurnPayload`, so an external agent holding the
      // personal-agent seat cannot receive the client's private thread.
      //
      // What stays gated is the FEATURE, not the turn. `configuredAskUserEnabled()`
      // is the A2H kill switch: flipped off, no A2H read is issued at all and
      // the prompt is the pre-A2H one. v2-only for the same reason — a v1
      // negotiation has no A2H vocabulary, so its prompt stays byte-identical.
      // Dropped from the gate are the per-turn conditions that used to ride
      // along inside `askUserAvailable`: final turn, budget spent, ask-rounds
      // cap, pre-contact bound. Those decide whether the agent may ASK, not
      // whether it may know what its client already said.
      const clientDm = version === 'v2' && configuredAskUserEnabled() && ownIntentId
        ? await retrieveClientDm(deps, ownUser.id, ownIntentId)
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
        ...(checklistActive
          ? {
              checklist: frozenChecklist,
              questionsSpent,
              ...(askedTopics.length > 0 && { askedTopics }),
            }
          : {}),
        ...(bargainingMode && { bargaining: { consecutiveNonConvergent: deadlock!.consecutiveNonConvergent } }),
        ...(ownMemory.length > 0 && { memory: ownMemory }),
        ...(clientDm.length > 0 && { clientDm }),
        ...(state.privateConsultation?.recipientUserId === ownUser.id
          ? { privateConsultation: state.privateConsultation }
          : {}),
      });
    }

    traceEmitter?.({ type: "agent_end", name: agentName, durationMs: Date.now() - agentStart, summary: `${turn.action}` });

    // ─── Checklist: author on turn 1, re-score after, never rewrite ───────
    // The freeze is enforced HERE rather than trusted to the prompt, and on
    // every seat: an externally dispatched agent drafts into the same field.
    // `reconcileChecklist` copies the frozen name/kind through and takes only
    // `result`/`basis` from the draft, so a dimension cannot be added, dropped
    // or renamed mid-negotiation whatever the draft says. Both paths enforce
    // the basis discipline, and both fail toward `unknown`: an `ok` with no
    // commitment behind it is not a score, and an authoring that cannot make a
    // valid checklist yields none at all — which leaves the negotiation
    // running exactly as it does today and lets the next turn draft again.
    //
    // The reconciled list is stamped back onto the turn, so the message record
    // IS the checklist's store — no new table, and a continuation recovers it
    // from the same messages it recovers the dialogue from.
    let nextChecklist: ChecklistItem[] = frozenChecklist;
    if (checklistActive) {
      const parsedDraft = ChecklistDraftSchema.safeParse(turn.checklist ?? []);
      const draft = parsedDraft.success ? parsedDraft.data : [];
      if (!parsedDraft.success) {
        turnLog.warn('Checklist draft failed schema validation; keeping the frozen scores', {
          taskId: state.taskId,
          seat,
          handledExternally: dispatchResult.handled,
        });
      }
      nextChecklist = isChecklistAuthored(frozenChecklist)
        ? reconcileChecklist(frozenChecklist, draft)
        : (authorChecklist(draft) ?? []);
      if (nextChecklist.length > 0) {
        turn = { ...turn, checklist: nextChecklist };
      } else if (turn.checklist) {
        // An authoring that produced nothing usable must not leave the raw
        // draft on the turn: `checklistFromTurns` would read it back as the
        // frozen dimensions on the next turn, which is exactly the freeze this
        // path declined to grant.
        const { checklist: _unusable, ...rest } = turn;
        turn = rest;
      }
      if (!isChecklistAuthored(frozenChecklist)) {
        turnLog.info('negotiation_checklist_authored', {
          taskId: state.taskId,
          opportunityId: state.opportunityId || undefined,
          seat,
          dimensions: nextChecklist.length,
          authored: nextChecklist.length > 0,
        });
      }
    }

    // Whether the ask on the table is the AGENT's own move, captured before the
    // consultation policy can rewrite the turn into one. The distinction is
    // what scopes the admissibility rule below to the drafted asks the
    // checklist protocol governs, leaving the policy's inferred consultations
    // to the policy.
    const agentDraftedAsk = turn.action === 'ask_user' && !!turn.askUser;

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
    //
    // A PRE-CONTACT resume is exempt from that exemption. The exemption exists
    // because a mid-flight consult has an outreach behind it — there is a
    // message on the table, and walking away from it is a real move. A
    // pre-contact park has nothing behind it: the counterparty was never
    // contacted, so the post-consult refusal is still the opening refusal and
    // must land on the same quiet `screened_out` outcome the unconsulted pass
    // lands on. This is also what makes an UNANSWERED pre-contact consult
    // resolve to today's behavior — the expiry worker resumes through exactly
    // this path.
    if (turn.action === 'withdraw' && !state.outreachOpened && (!state.continuationExecution || isPreContactResume)) {
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
    //
    // A pre-contact resume is coerced by the same rule: nothing was ever sent,
    // so the negotiation still has to OPEN, and a `counter`/`question` there
    // would make the counterparty's first sight of this match a mid-exchange
    // reply. An admissible `ask_user` is the one non-opening action left to
    // stand — it is the turn-0 third verdict, not a malformed opening.
    if (isFreshOpeningTurn || isPreContactResume) {
      const openingAction = version === 'v2' ? 'outreach' : 'propose';
      const consultingInstead = turn.action === 'ask_user' && askUserAvailable;
      if ((version !== 'v2' || seat === 'initiator') && turn.action !== openingAction && !consultingInstead) {
        turnLog.warn(`Agent returned unexpected action on turn 0, forcing to ${openingAction}`, { action: turn.action });
        // Rebind rather than mutate: `turn` may be the very object a dispatched
        // personal agent returned, and every other rewrite in this function
        // already replaces it instead of editing it in place.
        turn = { ...turn, action: openingAction };
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
      isOpeningTurn: isFreshOpeningTurn,
      isFinalTurn,
      screenedOut: blocksNegotiationBeforeFirstTurn(state.screenDecision, state.turnCount),
      action: turn.action,
      ownSuggestedRole: turn.assessment?.suggestedRoles?.ownUser,
      priorActions: history.map((prior) => prior.action),
      consultationBudgetSpent: questionsSpent >= questionBudget,
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
        // Two shapes reach here and the policy owes them different things.
        //
        // A draft that asked for something ELSE is REPLACED: the policy
        // inferred the consultation, so nothing in that draft was written to
        // be read by the client, and its reasoning/message may carry material
        // the client's question must not (the disclosure and authority
        // categories are inferred from exactly such drafts).
        //
        // A draft that already IS `ask_user` is only ADMITTED. Here the policy
        // is the gate, not the author: the agent volunteered the pause and
        // wrote the question its client reads, and it is the only party that
        // has read this negotiation. Overwriting `askUser` would discard that
        // question and park on a server template — which is what the
        // pre-contact verdict has nothing to fall back on, since a turn-0
        // park has no transcript for the client to read instead. The authored
        // payload still faces the identifier-aware safety gate below.
        const draftedOwnConsultation = turn.action === 'ask_user' && !!turn.askUser;
        // Under the checklist protocol the policy may ADMIT an ask, never
        // manufacture one. An inferred consultation carries no dimension, no
        // answerhood and no authored question by construction — the policy
        // reads action enums only — so the question-message author falls back
        // to deriving a gap from the transcript, and what reaches the client is
        // "would you be open to connecting with…?" with no options and the
        // counterparty described in it. That is the bar the plan exists to
        // abolish, and it fires precisely when the agent had open dimensions it
        // could have asked about instead.
        //
        // Seen in dev: a park whose checklist held "Pre-seed Stage Investment"
        // and "Nature of Venture" as unknown — both the client's own to settle
        // — while the delivered question asked only whether they were
        // interested in connecting.
        const policyMayInfer = !checklistActive;
        if (!draftedOwnConsultation && !policyMayInfer) {
          turnLog.info('negotiation_consultation_inference_declined', {
            taskId: state.taskId,
            opportunityId: state.opportunityId || undefined,
            seat,
            reason: policyEligibility.reason,
            action: turn.action,
          });
        }
        consultationPolicyReason = draftedOwnConsultation ? turn.askUser!.reason : policyEligibility.reason;
        if (!draftedOwnConsultation && policyMayInfer) {
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
        }
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

    // ─── Ask admissibility (checklist plan §3) ────────────────────────────
    // The five-part rule, in the part a machine can check: the ask must name a
    // dimension the frozen checklist carries, that dimension must still be
    // unknown (a scored one is answerable from the record — spending the
    // client's attention on it is what the rule exists to stop), the topic must
    // be unasked, and the answerhood map must actually distinguish two
    // outcomes. The budget is enforced upstream by the grant.
    //
    // Scoped to an ask the AGENT drafted. A policy-inferred consultation
    // (IND-508 replacing a non-ask draft) names no dimension by construction —
    // the policy sees action enums and nothing else — so running the rule over
    // one would silently retire that mechanism rather than discipline it.
    // What the two share is the budget, which binds them both at the grant.
    //
    // Fails OPEN on an unauthored checklist: with no frozen dimensions there is
    // nothing to be pivotal about, and refusing every ask there would take the
    // turn-0 pre-contact verdict away whenever authoring did not land.
    if (
      checklistActive
      && agentDraftedAsk
      && turn.action === 'ask_user'
      && isChecklistAuthored(nextChecklist)
    ) {
      const admissibility = assessAskAdmissibility({
        checklist: nextChecklist,
        dimension: turn.askUser?.dimension,
        answerhood: turn.askUser?.answerhood,
        askedDimensions,
        questionsSpent,
      });
      if (!admissibility.admissible) {
        turnLog.info('negotiation_ask_inadmissible', {
          taskId: state.taskId,
          opportunityId: state.opportunityId || undefined,
          seat,
          reason: admissibility.reason,
          dimension: turn.askUser?.dimension,
          questionsSpent,
          questionBudget,
        });
        emitWide({
          type: 'negotiation_ask_inadmissible',
          opportunityId: state.opportunityId,
          negotiationConversationId: state.conversationId,
          turnIndex: state.turnCount,
          actor: isSource ? 'source' : 'candidate',
          reason: admissibility.reason,
        });
        turn = { ...turn, action: fallbackActionFor(version, seat, isFinalTurn) };
      }
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

    // ─── Authored ask_user question: identifier-aware safety gate ─────────
    // The agent now writes the question its client reads verbatim (the
    // pre-A2H `disclosureSubject` was only an input to server-templated copy),
    // and an external registered agent can hold the personal-agent seat — so
    // this runs on every turn, dispatched or system, not just our own.
    //
    // Placed BEFORE persistence deliberately. The turn is about to become a
    // message in the shared conversation, so a rejected question must not
    // survive there either; and issue 6 reads the field back off the persisted
    // turn, which means dropping it here is what makes that read safe by
    // construction rather than by remembering to re-check.
    //
    // Rejection is a DOWNGRADE, never a failure: the turn, its action, and
    // `askUser.reason` all stand, so the consultation proceeds on today's
    // enum-only path — the same shape a v1 turn or an older agent produces.
    // A guard that could fail a turn would let malformed model output stall a
    // negotiation, which is strictly worse than asking a generic question.
    //
    // The two inputs are exactly what the api-side payload guard can never
    // have: it sees the question at the DB boundary with no idea who the
    // counterparty is or what the evaluator wrote, so it cannot tell that a
    // well-formed question is naming them or paraphrasing it.
    if (turn.askUser?.question) {
      const counterpartyName = otherUser.profile?.name?.trim();
      const seedReasoning = state.seedAssessment?.reasoning?.trim();
      const safeAuthoredQuestion = isSafeAuthoredNegotiationQuestion(turn.askUser.question, {
        ...(counterpartyName ? { forbiddenIdentifiers: [counterpartyName] } : {}),
        ...(seedReasoning ? { forbiddenSourceText: [seedReasoning] } : {}),
      });
      if (!safeAuthoredQuestion) {
        turnLog.warn('Dropping unsafe authored ask_user question; consultation continues without it', {
          taskId: state.taskId,
          opportunityId: state.opportunityId || undefined,
          seat,
          handledExternally: dispatchResult.handled,
        });
        const { question: _rejected, ...askUserWithoutQuestion } = turn.askUser;
        turn = { ...turn, askUser: askUserWithoutQuestion };
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
    turnPersisted = true;

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
          // Marks a park the counterparty has never been contacted about, so
          // the per-signal open-consult cap can count these without counting
          // mid-flight consults. Read back by `countOpenPreContactConsults`;
          // the park row is the only durable record, so the stamp lives on it.
          ...(isFreshOpeningTurn ? { [PRE_CONTACT_CONSULT_MARKER]: true } : {}),
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
        counterpartyBinding: askUserBinding.counterpartyBinding,
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
          taskId: state.taskId,
        }],
        turnCount: state.turnCount + 1,
        consecutiveTurnFailures: 0,
        lastTurn: turn,
        status: 'input_required' as const,
        ...(nextChecklist.length > 0 && { checklist: nextChecklist }),
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
        ...(nextChecklist.length > 0
          ? (() => {
              const verdictState = checklistVerdictState(nextChecklist);
              return {
                checklist: {
                  dimensions: nextChecklist.length,
                  conflicts: verdictState.conflicts.length,
                  unknowns: verdictState.unknowns.length,
                },
              };
            })()
          : {}),
        durationMs: Date.now() - agentStart,
      });
    }

    return {
      // `taskId` is what makes this turn part of THIS session's block in the
      // attributed prior dialogue (IND-569). Persisted with the current task
      // id above; carried onto the state message so `buildAttributedDialogue`
      // can match it. Dropping it silently emptied the "[Current opportunity —
      // under negotiation now]" block, which — because the attributed
      // rendering replaces the flat history in the prompt — left every turn
      // after the opening blind to the exchange it was answering.
      messages: [{
        id: message.id,
        senderId: message.senderId,
        role: "agent" as const,
        parts: message.parts,
        createdAt: message.createdAt,
        taskId: state.taskId,
      }],
      turnCount: state.turnCount + 1,
      // This turn landed, so the failure run ends here: the bound counts
      // CONSECUTIVE failures, not failures over the negotiation's life.
      consecutiveTurnFailures: 0,
      currentSpeaker: (isSource ? "candidate" : "source") as "source" | "candidate",
      lastTurn: turn,
      memoryBySide: { [ownSide]: ownMemory },
      ...(nextChecklist.length > 0 && { checklist: nextChecklist }),
      // Record the in-task outreach so a later `withdraw` is legal (IND-564).
      ...(turn.action === 'outreach' && { outreachOpened: true }),
      ...(deadlockShiftRecord && { deadlockShift: deadlockShiftRecord }),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    turnLog.error("Agent invocation failed", { error: errMsg, stack: err instanceof Error ? err.stack : undefined, turnCount: state.turnCount });
    traceEmitter?.({ type: "agent_end", name: agentName, durationMs: Date.now() - agentStart, summary: `error: ${errMsg}` });
    // A FAILED TURN IS NOT A DECISION. This used to synthesize a seat-
    // appropriate reject, and finalize maps any reject-like last turn to
    // opportunity `rejected` — so a provider timeout, a dropped connection or
    // a throw in the park machinery permanently declined the match on the
    // client's behalf, with reasoning that says "Agent error".
    //
    // Seen repeatedly in dev on turn 2, which is where an ask is drafted and
    // therefore the slowest turn in the flow: the agent decided to ask its
    // client, the call exceeded the turn budget, and the negotiation recorded
    // a withdrawal. The intent to ask became a rejection.
    //
    // A FAILED TURN IS ALSO NOT A TURN. Incrementing `turnCount` here spent a
    // slice of the dialogue budget on an exchange that never happened, and
    // finalize then reported an exhausted budget as if six turns of argument
    // had failed to reach agreement — the observed shape being a negotiation
    // "stalled after 6 turns" holding exactly one message. The count stays
    // put; what advances instead is the consecutive-failure run, and the same
    // seat retries.
    //
    // What the failure leaves behind is the record below. Before it, a failed
    // turn wrote nothing at all — no message, no status, no metadata — so this
    // class could only be investigated by timing arithmetic over the rows that
    // did get written.
    const failure: NegotiationTurnFailure = {
      at: new Date().toISOString(),
      seat: actingSeat,
      turnIndex: state.turnCount,
      error: errMsg,
    };
    const turnFailures = appendTurnFailure(state.turnFailures, failure);
    const consecutiveTurnFailures = state.consecutiveTurnFailures + 1;
    const boundReached = turnFailureBoundReached(consecutiveTurnFailures);
    const retryable = !turnPersisted && !boundReached;

    turnLog.warn('negotiation_turn_failed', {
      taskId: state.taskId,
      opportunityId: state.opportunityId || undefined,
      seat: actingSeat,
      turnIndex: state.turnCount,
      consecutiveTurnFailures,
      boundReached,
      turnPersisted,
      error: errMsg,
    });
    emitWide({
      type: 'negotiation_turn_failed',
      opportunityId: state.opportunityId,
      negotiationConversationId: state.conversationId,
      turnIndex: state.turnCount,
      actor: state.currentSpeaker,
      consecutiveTurnFailures,
      boundReached,
      error: errMsg,
    });
    // Durable trace, fail-open: the optional hook keeps existing fakes and
    // wireups valid, and a metadata write that fails must not turn one failed
    // turn into two.
    if (state.taskId) {
      await deps.database.setTaskFailedTurns?.(
        state.taskId,
        turnFailures as unknown as Array<Record<string, unknown>>,
        state.continuationExecution,
      ).catch((writeErr) => {
        turnLog.error('Failed to persist the failed-turn trace', { taskId: state.taskId, error: writeErr });
      });
    }

    // Below the bound the graph routes back into `turn` (see `routeAfterTurn`)
    // and the same seat tries again on an unchanged turn count. At the bound
    // the run ends: `error` is what routes to finalize, and it is set ONLY
    // here, so every other consumer of `state.error` keeps its meaning.
    if (retryable) return { turnFailures, consecutiveTurnFailures };
    return {
      turnFailures,
      consecutiveTurnFailures,
      // A turn that reached the conversation still counts, whatever failed
      // after it: the message is the record, and an outcome that disowned it
      // would be as untrue as the fake budget this work removes.
      ...(turnPersisted ? { turnCount: state.turnCount + 1 } : {}),
      error: turnPersisted
        ? `Turn failed after its message was persisted: ${errMsg}`
        : `Turn failed ${consecutiveTurnFailures}x consecutively: ${errMsg}`,
    };
  }
}
