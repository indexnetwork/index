/**
 * Negotiation graph, stage 3: one negotiator turn.
 */

import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { requestContext } from "../shared/observability/request-context.js";
import type { NegotiationContinuationReceipt } from "../../platform/database.js";
import type { NegotiationTurnPayload } from "../shared/interfaces/agent-dispatcher.interface.js";
import { type NegotiationTurn, type NegotiationOutcome } from "./negotiation.state.js";
import { allowedActionsFor, ASK_USER_WINDOW_MS, fallbackActionFor, isRejectLikeAction, isTerminalAction, negotiationAskRoundsCap, negotiationHasMadeContact, readProtocolVersion } from "./negotiation.protocol.js";
import { assessConsultationEligibility, consultationPromptFor, countOpenPreContactConsults, NEGOTIATION_CONSULTATION_POLICY_MODE, isPreContactConsultResume, MAX_OPEN_PRE_CONTACT_CONSULTS_PER_INTENT, PRE_CONTACT_CONSULT_MARKER, type NegotiationConsultationReason } from "./negotiation.consultation-policy.js";
import { assessDeadlock, type DeadlockAssessment, type DeadlockShiftRecord } from "./negotiation.deadlock.js";
import type { NegotiationSeat, NegotiationProtocolVersion } from "../../protocol/schemas/negotiation-state.schema.js";
import { NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY, NEGOTIATION_QUESTION_GENERIC_NETWORK, isSafeAuthoredNegotiationQuestion, negotiationQuestionSettlementId } from './negotiation.question-safety.js';
import type { NegotiationAntiEcho, NegotiationConcludeFloor } from "./negotiation.agent.js";
import { buildIntentSnapshots } from "./negotiation.intent-snapshot-provenance.js";
import { holdsNegotiationConversationLock } from "./negotiation.task-lock-policy.js";
import { isNegotiationTurnCapReached } from "./negotiation.turn-cap.js";
import { appendTurnFailure, turnFailureBoundReached, type NegotiationTurnFailure } from "./negotiation.turn-failure.js";
import { expectedNegotiationSpeaker } from "./negotiation.expected-speaker.js";
import { buildSeededAttribution } from './negotiation.attribution.js';
import { askedChecklistTopics, buildAttributedDialogue, countNegotiationAskRounds, countPrincipalAskUserTurns, finalizeLog, hasGuaranteedAsk, initLog, memoryQueryText, negotiateCandidatesLog, resolveTaskAttribution, retrieveClientDm, retrieveMemory, turnLog, turnsFromMessages } from "./negotiation.graph.shared.js";
import { askableUnknowns, assessAskAdmissibility, assessConcludeAdmissibility, assessDeclineAdmissibility, authorChecklist, checklistFromTurns, checklistVerdictState, configuredQuestionBudgetPerPrincipal, dimensionKey, isChecklistAuthored, reconcileChecklist, ChecklistDraftSchema, type AskInadmissibility, type ChecklistItem } from "./negotiation.checklist.contracts.js";
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
    // The opening turn, before anything is sent. `outreachOpened` is per-run
    // and history is this negotiation's own record, so this is true exactly
    // once per negotiation — and stays true across a pre-contact park, whose
    // resume re-enters holding nothing but its own `ask_user` turn.
    const isFreshOpeningTurn = state.turnCount === 0 && !state.isContinuation;
    const isPreContactResume = state.turnCount === 0 && isPreContactConsultResume(history);
    // Has this negotiation ever addressed the counterparty — in this task or an
    // earlier one? `outreachOpened` alone answers only for THIS task, which is
    // exactly the blind spot that let a recovered stall be re-labelled as
    // never-contacted; `history` carries the negotiation's own prior turns
    // across every session it has run.
    const contactMade = state.outreachOpened || negotiationHasMadeContact(history);
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
    // The frozen dimensions, re-derived from this negotiation's own turns
    // rather than carried in the channel: `state.messages` is scoped to this
    // negotiation and spans its sessions, so a continuation, a retry and a
    // fresh process all read the same checklist.
    const frozenChecklist: ChecklistItem[] = checklistFromTurns(history);
    const questionsSpent = countPrincipalAskUserTurns(state.messages, ownUser.id);
    const askedTopics = askedChecklistTopics(state.messages, ownUser.id);
    const askedDimensions = askedTopics.map((topic) => topic.dimension);
    // One question budget per principal per negotiation, the turn-0
    // pre-contact consult included. Under `advocate` the budget is 1, which is
    // exactly the legacy `hasPriorAskUser` ration expressed as a count.
    const questionBudget = configuredQuestionBudgetPerPrincipal();
    const askUserWiringAvailable =
      version === 'v2'
      && !isFinalTurn
      && !!deps.questionerEnqueue
      && !!deps.timeoutQueue?.enqueueAskUserExpiry
      && !!state.opportunityId
      && !!ownIntentId
      && !!state.indexContext.networkId
      && (!isFreshOpeningTurn || preContactConsultShapeAvailable)
      && questionsSpent < questionBudget
      && countNegotiationAskRounds(state.messages) < negotiationAskRoundsCap({ checklist: true });
    const askUserAvailable = askUserWiringAvailable
      && (!preContactConsultShapeAvailable
        || await preContactConsultsUnderCap(deps, ownUser.id, ownIntentId!, state.taskId));

    // Dev-facing lifecycle event: this makes every withheld consultation
    // visible without logging private prompt or client-answer content.
    turnLog.info('negotiation_turn_started', {
      taskId: state.taskId,
      opportunityId: state.opportunityId || undefined,
      conversationId: state.conversationId,
      turnIndex: state.turnCount,
      seat,
      version,
      isFinalTurn,
      isContinuation: state.isContinuation,
      contactMade,
      askUserAvailable,
      askUserEligibility: {
        versionV2: version === 'v2',
        nonFinal: !isFinalTurn,
        questionerWired: !!deps.questionerEnqueue,
        expiryWired: !!deps.timeoutQueue?.enqueueAskUserExpiry,
        opportunityBound: !!state.opportunityId,
        intentBound: !!ownIntentId,
        networkBound: !!state.indexContext.networkId,
        budgetRemaining: questionsSpent < questionBudget,
        askRoundsRemaining: countNegotiationAskRounds(state.messages) < negotiationAskRoundsCap({ checklist: true }),
      },
      questionsSpent,
      questionBudget,
      checklistDimensions: frozenChecklist.length,
    });

    // ─── The conclusion floor (floor plan §2) ────────────────────────────
    // Scope, decided here because both halves of the floor read it.
    //
    // The OPENING turn is excluded, and that is a judgment rather than an
    // oversight. The checklist is AUTHORED on turn 0, and the authoring
    // instruction requires at least one dimension the record does not settle —
    // so on turn 0 an askable unknown is not evidence that the agent dodged
    // anything, it is the shape the protocol asked for. A floor that bound
    // there would park every negotiation before it ever made contact, which is
    // both a swamp and the wrong mechanism: turn 0 already has a designed
    // consult — the pre-contact verdict — that the agent chooses and the
    // per-signal cap bounds. The floor exists for the turns AFTER contact,
    // where the observed dodging happened.
    const floorApplies = !isFreshOpeningTurn && !isPreContactResume;
    // Whether this seat's one guaranteed ask is already spent, read off the
    // negotiation's own record so a park, its resume and a fresh process all
    // agree. Per principal: the counterparty's guarantee is their own.
    const guaranteedAskSpent = hasGuaranteedAsk(state.messages, ownUser.id);

    // ─── Deadlock detection → persuasion→bargaining stance (IND-428) ──────
    // Deterministic trailing-run inspection of the persisted history — no
    // LLM in the decision. Gated on the strict default-off flag AND v2,
    // checked alongside the protocol-version plumbing so v1 semantics stay
    // untouched. Fail-open: any detection error means "no deadlock" and
    // the legacy path proceeds byte-identically. The shift changes the
    // system agent's drafting stance only — allowedActions, the dispatch
    // payload, and all termination rules are untouched.
    let deadlock: DeadlockAssessment | null = null;
    if (version === 'v2') {
      try {
        deadlock = assessDeadlock(history);
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
      checklist: frozenChecklist,
      questionBudget: { spent: questionsSpent, total: questionBudget },
      ...(askedDimensions.length > 0 && { askedDimensions }),
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

    // The in-process draft, as a callable rather than a straight-line branch:
    // the copy-loop guard below re-issues THIS turn once, and a re-issue has to
    // be the same draft under one added instruction, not a different prompt
    // assembled twice. The A2H excerpt is memoized across both calls — one read
    // per turn, whatever the guard does.
    //
    // The re-issue always runs here, even when the refused draft came from an
    // externally dispatched personal agent. Re-dispatching would reopen the
    // whole dispatch contract mid-turn (a `waiting` result would suspend the
    // graph holding a discarded draft, a timeout would end the turn with
    // nothing), and the in-process negotiator is the one seat that is always
    // available. What the external agent's draft cost it is one turn, not the
    // negotiation.
    let clientDmForPrompt: Awaited<ReturnType<typeof retrieveClientDm>> | null = null;
    const draftFromSystemAgent = async (
      reissue?: { antiEcho?: NegotiationAntiEcho; concludeFloor?: NegotiationConcludeFloor },
    ): Promise<NegotiationTurn> => {
      const agentPriorDialogue = buildAttributedDialogue(state);

      // ─── A2H: the acting user's own negotiator DM for this signal ──────
      // Retrieved HERE, in the system-agent draft, rather than beside
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
      // v2-only: a v1 negotiation has no A2H vocabulary, so its prompt stays
      // byte-identical.
      // Dropped from the gate are the per-turn conditions that used to ride
      // along inside `askUserAvailable`: final turn, budget spent, ask-rounds
      // cap, pre-contact bound. Those decide whether the agent may ASK, not
      // whether it may know what its client already said.
      if (clientDmForPrompt === null) {
        clientDmForPrompt = version === 'v2' && ownIntentId
          ? await retrieveClientDm(deps, ownUser.id, ownIntentId)
          : [];
      }
      const clientDm = clientDmForPrompt;
      return deps.systemAgent.invoke({
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
        checklist: frozenChecklist,
        questionsSpent,
        ...(askedTopics.length > 0 && { askedTopics }),
        ...(bargainingMode && { bargaining: { consecutiveNonConvergent: deadlock!.consecutiveNonConvergent } }),
        ...(ownMemory.length > 0 && { memory: ownMemory }),
        ...(clientDm.length > 0 && { clientDm }),
        ...(state.privateConsultation?.recipientUserId === ownUser.id
          ? { privateConsultation: state.privateConsultation }
          : {}),
        ...(reissue?.antiEcho ? { antiEcho: reissue.antiEcho } : {}),
        ...(reissue?.concludeFloor ? { concludeFloor: reissue.concludeFloor } : {}),
      });
    };

    const scope = { action: 'manage:negotiations', scopeType: 'network', scopeId: state.indexContext.networkId };

    const dispatchResult = await deps.dispatcher.dispatch(ownUser.id, scope, payload, { timeoutMs: state.timeoutMs });

    let turn: NegotiationTurn;
    let turnSource: 'personal_agent' | 'system_agent';

    if (dispatchResult.handled) {
      // Personal agent responded. Under v2, coerce out-of-seat actions to
      // the conservative fallback — the polling/respond surfaces reject
      // these with a 400, but locally-dispatched turns land here directly.
      turn = dispatchResult.turn;
      turnSource = 'personal_agent';
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
      turn = await draftFromSystemAgent();
      turnSource = 'system_agent';
    }

    turnLog.info('negotiation_turn_drafted', {
      taskId: state.taskId,
      opportunityId: state.opportunityId || undefined,
      conversationId: state.conversationId,
      turnIndex: state.turnCount,
      seat,
      source: turnSource,
      action: turn.action,
      hasAskUserPayload: !!turn.askUser,
      askUserReason: turn.askUser?.reason,
      askUserDimension: turn.askUser?.dimension,
    });

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
    //
    // A function rather than a straight-line block because the copy-loop guard
    // below can replace the drafted turn with a re-issued one, and a re-issue
    // arrives carrying its OWN raw checklist draft. Persisting that unreconciled
    // would let `checklistFromTurns` read it back as the frozen dimensions on
    // the next turn — the freeze, defeated by the very guard meant to protect
    // the exchange. Whatever is persisted has been through here.
    const applyChecklistDiscipline = (
      draftTurn: NegotiationTurn,
      opts?: { reissue?: boolean },
    ): { turn: NegotiationTurn; checklist: ChecklistItem[] } => {
      // `askUser.guaranteed` is the graph's own mark — the durable record that
      // the conclusion floor already fired an ask for this seat, which is what
      // bounds the guarantee to one per negotiation per principal. The system
      // agent can no longer claim it: `AskUserGenerationSchema` omits the field
      // from what a model is offered at all, which is also what stopped a
      // drafted `guaranteed: false` from killing the whole turn. What still
      // arrives by another route is an EXTERNAL agent's turn — dispatched
      // personal agents draft against the permissive persisted shape, not the
      // generation schema — so the claim is dropped here, and the floor stays
      // the field's only writer whichever way the draft came in.
      const draftTurnUnmarked = draftTurn.askUser?.guaranteed === true
        ? (() => {
            const { guaranteed: _claimed, ...askUser } = draftTurn.askUser;
            turnLog.warn('Dropping an agent-claimed guaranteed mark from an ask payload', {
              taskId: state.taskId, seat, handledExternally: dispatchResult.handled,
            });
            return { ...draftTurn, askUser };
          })()
        : draftTurn;
      let next = draftTurnUnmarked;
      const parsedDraft = ChecklistDraftSchema.safeParse(draftTurnUnmarked.checklist ?? []);
      const draft = parsedDraft.success ? parsedDraft.data : [];
      if (!parsedDraft.success) {
        turnLog.warn('Checklist draft failed schema validation; keeping the frozen scores', {
          taskId: state.taskId,
          seat,
          handledExternally: dispatchResult.handled,
          ...(opts?.reissue && { reissue: true }),
        });
      }
      const reconciled = isChecklistAuthored(frozenChecklist)
        ? reconcileChecklist(frozenChecklist, draft)
        : (authorChecklist(draft) ?? []);
      if (reconciled.length > 0) {
        next = { ...next, checklist: reconciled };
      } else if (next.checklist) {
        // An authoring that produced nothing usable must not leave the raw
        // draft on the turn: `checklistFromTurns` would read it back as the
        // frozen dimensions on the next turn, which is exactly the freeze this
        // path declined to grant.
        const { checklist: _unusable, ...rest } = next;
        next = rest;
      }
      if (!isChecklistAuthored(frozenChecklist)) {
        turnLog.info('negotiation_checklist_authored', {
          taskId: state.taskId,
          opportunityId: state.opportunityId || undefined,
          seat,
          dimensions: reconciled.length,
          authored: reconciled.length > 0,
          ...(opts?.reissue && { reissue: true }),
        });
      }
      return { turn: next, checklist: reconciled };
    };

    let nextChecklist: ChecklistItem[] = frozenChecklist;
    {
      const disciplined = applyChecklistDiscipline(turn);
      turn = disciplined.turn;
      nextChecklist = disciplined.checklist;
    }

    // A few model drafts have carried a valid own-client consultation payload
    // while selecting `counter` and merely narrating that they need to ask the
    // client. A counter cannot create the client-DM question or pause the task,
    // so preserve the structured intent and send it through the normal
    // admission gate. Invalid or unavailable asks are still deterministically
    // coerced by that gate below.
    if (turn.action !== 'ask_user' && turn.askUser?.reason) {
      turnLog.warn('negotiation_mixed_ask_user_action_normalized', {
        taskId: state.taskId,
        opportunityId: state.opportunityId || undefined,
        seat,
        action: turn.action,
        reason: turn.askUser.reason,
      });
      turn = { ...turn, action: 'ask_user' };
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
    // flows into the quiet `screened_out` path — no message is
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
    //
    // The whole guard is scoped to a negotiation that has never spoken.
    // `outreachOpened` is per-TASK, so on a continuation of a CONTACTED
    // negotiation (an error-stalled run recovered through run-existing) it
    // reads false while an outreach sits on the counterparty's thread. A
    // withdraw there is a real move against a real message and must persist as
    // one — routing it here would relabel a live negotiation as never-contacted
    // and end it quietly under `screened_out`.
    if (turn.action === 'withdraw' && !contactMade && (!state.continuationExecution || isPreContactResume)) {
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
    // A function of the DRAFT rather than a value computed once, because the
    // conclusion floor below can replace this turn with a re-issued one whose
    // action is different — and admission is a judgment about the action that
    // will actually be persisted. Every input other than the draft's own
    // action/role is fixed for the turn, so the two calls differ in exactly
    // what the policy is entitled to see.
    const consultationEligibilityFor = (candidate: NegotiationTurn) => assessConsultationEligibility({
      protocolVersion: version,
      seat,
      isOpeningTurn: isFreshOpeningTurn,
      isFinalTurn,
      action: candidate.action,
      ownSuggestedRole: candidate.assessment?.suggestedRoles?.ownUser,
      priorActions: history.map((prior) => prior.action),
      consultationBudgetSpent: questionsSpent >= questionBudget,
      hasExactResumeCoordinate: Boolean(
        deps.questionerEnqueue
        && deps.timeoutQueue?.enqueueAskUserExpiry
        && state.taskId
        && state.opportunityId
        && ownIntentId
        && state.indexContext.networkId,
      ),
      lifecycleValid: Boolean(state.taskId && state.opportunityId && ownIntentId && state.indexContext.networkId),
    });
    const policyEligibility = consultationEligibilityFor(turn);
    const emitConsultationTelemetry = (stage: 'eligible' | 'asked', reason: NegotiationConsultationReason) => {
      turnLog.info('negotiation_consultation_policy', { stage, mode: NEGOTIATION_CONSULTATION_POLICY_MODE, reason });
      emitWide({ type: 'negotiation_consultation_policy', stage, mode: NEGOTIATION_CONSULTATION_POLICY_MODE, reason });
    };
    if (policyEligibility.eligible && policyEligibility.reason) {
      emitConsultationTelemetry('eligible', policyEligibility.reason);
      {
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
        if (!draftedOwnConsultation) {
          turnLog.info('negotiation_consultation_inference_declined', {
            taskId: state.taskId,
            opportunityId: state.opportunityId || undefined,
            seat,
            reason: policyEligibility.reason,
            action: turn.action,
          });
        }
        // Under the checklist protocol the policy never rewrites a draft into
        // an ask_user of its own: the agent is the only party that has read
        // this negotiation, so an inferred question would be about the wrong
        // unknown. It admits the agent's own ask, or it declines and says so.
        consultationPolicyReason = draftedOwnConsultation ? turn.askUser!.reason : policyEligibility.reason;
        emitConsultationTelemetry('asked', consultationPolicyReason);
      }
    }

    // ─── Ask admission: reachability, availability, policy, the five-part rule
    //
    // A function rather than three straight-line blocks, for the reason the
    // checklist discipline and the decline law are functions: the conclusion
    // floor below can replace this turn with a re-issued one, and a re-issued
    // ASK has to face every gate the first draft faced. Before this, all three
    // gates sat above the re-issue seam — so an ask arriving from a re-issue
    // would have entered the shared record having passed none of them.
    //
    // Order is for the telemetry, not the outcome: the conditions are
    // conjunctive, and each refusal names the one that actually bound.
    const enforceAskAdmission = (
      candidate: NegotiationTurn,
      checklist: ChecklistItem[],
      opts: { agentDrafted: boolean; reissue?: boolean },
    ): NegotiationTurn => {
      if (candidate.action !== 'ask_user') return candidate;

      // Policy admission for a RE-ISSUED ask. The eligibility above was
      // computed from the refused draft's action — typically a terminal
      // verdict, which the policy excludes outright — so without this an ask
      // the floor asked for would be admitted by the floor and then coerced
      // away by a verdict about a draft that no longer exists. Re-running it
      // gives the policy the action it is actually judging. Scoped to the
      // re-issue so the ordinary path stays byte-identical.
      if (opts.reissue && !consultationPolicyReason) {
        const eligibility = consultationEligibilityFor(candidate);
        if (eligibility.eligible && eligibility.reason) {
          emitConsultationTelemetry('eligible', eligibility.reason);
          consultationPolicyReason = candidate.askUser?.reason ?? eligibility.reason;
          emitConsultationTelemetry('asked', consultationPolicyReason);
        }
      }

      // Safety net: a spontaneous ask_user is admissible only when the
      // deterministic policy just authorized it, so no unbounded pause can
      // enter shared history.
      if (!askUserAvailable || !consultationPolicyReason) {
        turnLog.warn('ask_user emitted while unavailable, coercing to conservative fallback', {
          seat, isFinalTurn, taskId: state.taskId, ...(opts.reissue && { reissue: true }),
        });
        return { ...candidate, action: fallbackActionFor(version, seat, isFinalTurn) };
      }

      // ─── The five-part rule (checklist plan §3) ─────────────────────────
      // The ask must name a dimension the frozen checklist carries, that
      // dimension must still be unknown (a scored one is answerable from the
      // record — spending the client's attention on it is what the rule exists
      // to stop), the topic must be unasked, and the answerhood map must
      // actually distinguish two outcomes. The budget is enforced upstream by
      // the grant.
      //
      // Scoped to an ask the AGENT drafted. A policy-inferred consultation
      // (IND-508 replacing a non-ask draft) names no dimension by construction
      // — the policy sees action enums and nothing else — so running the rule
      // over one would silently retire that mechanism rather than discipline
      // it. The floor's own guaranteed ask is excluded for the mirror-image
      // reason: it names a dimension the graph itself read off the checklist
      // as unknown and unasked, so the rule could only re-derive its own
      // inputs, and it declares no answerhood because no author was involved.
      // What all three share is the budget, which binds them at the grant.
      //
      // Fails OPEN on an unauthored checklist: with no frozen dimensions there
      // is nothing to be pivotal about, and refusing every ask there would take
      // the turn-0 pre-contact verdict away whenever authoring did not land.
      if (opts.agentDrafted && isChecklistAuthored(checklist)) {
        const admissibility = assessAskAdmissibility({
          checklist,
          dimension: candidate.askUser?.dimension,
          answerhood: candidate.askUser?.answerhood,
          askedDimensions,
          questionsSpent,
        });
        if (!admissibility.admissible) {
          turnLog.info('negotiation_ask_inadmissible', {
            taskId: state.taskId,
            opportunityId: state.opportunityId || undefined,
            seat,
            reason: admissibility.reason,
            dimension: candidate.askUser?.dimension,
            questionsSpent,
            questionBudget,
            ...(opts.reissue && { reissue: true }),
          });
          emitWide({
            type: 'negotiation_ask_inadmissible',
            opportunityId: state.opportunityId,
            negotiationConversationId: state.conversationId,
            turnIndex: state.turnCount,
            actor: isSource ? 'source' : 'candidate',
            reason: admissibility.reason,
          });
          return { ...candidate, action: fallbackActionFor(version, seat, isFinalTurn) };
        }
      }

      return candidate;
    };

    turn = enforceAskAdmission(turn, nextChecklist, { agentDrafted: agentDraftedAsk });

    // ─── Decline verdict law, mechanically (checklist plan §6) ────────────
    // "An unknown is not a reason to end anything; pass stays reserved for
    // conflict." That law was prompt-only, and the prompt lost: observed in dev
    // as a decline citing "repeated lack of clarity … despite five inquiries"
    // over a checklist that held unknowns and no conflict at all. Nothing had
    // been decided against — the counterparty simply could not answer, because
    // the fact was its own unreachable principal's.
    //
    // Scoped like every other checklist rule: the assessing stances only, an
    // authored checklist only (fails open — same rationale as ask
    // admissibility), and read from `nextChecklist`, the reconciled scores this
    // very turn is deciding on rather than the ones it inherited.
    //
    // `withdraw` is deliberately NOT covered. The initiator's turn-0 refusal is
    // screen semantics — it decides whether to make contact at all, on evidence
    // that predates any checklist — and the opening-withdraw guard above has
    // already returned by this point. Governing in-flight declines is what this
    // is for.
    //
    // A function for the same reason the checklist discipline is one: the
    // copy-loop guard below can replace the drafted turn, and a re-issued
    // decline is as bound by the verdict law as the first one was.
    const enforceDeclineVerdictLaw = (
      candidate: NegotiationTurn,
      checklist: ChecklistItem[],
      opts?: { reissue?: boolean },
    ): NegotiationTurn => {
      if (
        (candidate.action !== 'decline' && candidate.action !== 'reject')
        || !isChecklistAuthored(checklist)
      ) return candidate;
      const declineAdmissibility = assessDeclineAdmissibility({ checklist });
      if (declineAdmissibility.admissible) return candidate;
      // The final turn is the one place the law cannot simply be enforced: the
      // seat's vocabulary there is accept-or-decline, so refusing the decline
      // would either manufacture an accept nobody chose or emit an action the
      // seat's schema does not carry. The cap wins — but not quietly. The
      // violation is logged and traced with the unknowns that stood in for a
      // conflict, so "the turn budget forced a verdict" is a readable fact
      // about the row rather than something an investigation has to
      // reconstruct from the checklist.
      turnLog.info('negotiation_decline_inadmissible', {
        taskId: state.taskId,
        opportunityId: state.opportunityId || undefined,
        seat,
        reason: declineAdmissibility.reason,
        unknowns: declineAdmissibility.unknowns,
        turnIndex: state.turnCount,
        isFinalTurn,
        coerced: !isFinalTurn,
        ...(opts?.reissue && { reissue: true }),
      });
      emitWide({
        type: 'negotiation_decline_inadmissible',
        opportunityId: state.opportunityId,
        negotiationConversationId: state.conversationId,
        turnIndex: state.turnCount,
        actor: isSource ? 'source' : 'candidate',
        reason: declineAdmissibility.reason,
        unknowns: declineAdmissibility.unknowns,
        isFinalTurn,
        coerced: !isFinalTurn,
      });
      if (isFinalTurn) return candidate;
      // The message is dropped with the action it belonged to. It was written
      // to end the negotiation; carried onto a `counter` it would announce a
      // decline the record does not contain, which is the same class of
      // dishonesty as the decline itself. The reasoning stays — it is the
      // trace of what the agent tried to do.
      return { ...candidate, action: fallbackActionFor(version, seat, isFinalTurn), message: null };
    };

    turn = enforceDeclineVerdictLaw(turn, nextChecklist);

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
    //
    // A function, like the two gates above, so the copy-loop guard's re-issued
    // turn faces it as well: "a rejected question must not survive in the
    // shared record" is a property of what gets PERSISTED, not of one draft.
    const enforceAuthoredQuestionSafety = (candidate: NegotiationTurn): NegotiationTurn => {
      if (!candidate.askUser?.question) return candidate;
      const counterpartyName = otherUser.profile?.name?.trim();
      const seedReasoning = state.seedAssessment?.reasoning?.trim();
      const safeAuthoredQuestion = isSafeAuthoredNegotiationQuestion(candidate.askUser.question, {
        ...(counterpartyName ? { forbiddenIdentifiers: [counterpartyName] } : {}),
        ...(seedReasoning ? { forbiddenSourceText: [seedReasoning] } : {}),
      });
      if (safeAuthoredQuestion) return candidate;
      turnLog.warn('Dropping unsafe authored ask_user question; consultation continues without it', {
        taskId: state.taskId,
        opportunityId: state.opportunityId || undefined,
        seat,
        handledExternally: dispatchResult.handled,
      });
      const { question: _rejected, ...askUserWithoutQuestion } = candidate.askUser;
      return { ...candidate, askUser: askUserWithoutQuestion };
    };

    turn = enforceAuthoredQuestionSafety(turn);

    // ─── The conclusion floor, part 1: a premature verdict is re-issued ───
    // The decline law above closed ONE exit: a decline with no conflict behind
    // it. This closes the rest of them, and it is the same law read forwards.
    //
    // A week of live traffic produced zero `ask_user` turns against 23
    // policy-recognized consultation moments. Every one of those agents had a
    // cheaper move than asking — assume the unknown away and accept, put the
    // question to the counterparty who does not hold the answer, or conclude
    // and be done — and every one of them took it. The prompt has said "an
    // unknown is not a reason to end anything" since the checklist shipped;
    // the prompt lost, the same way it lost on the decline.
    //
    // So while a dimension this turn scored `unknown` is still one this
    // principal could be asked about, concluding is not an available move.
    // The draft is discarded, and the turn is re-issued ONCE with those
    // dimensions named and exactly two moves left: score it from a stated
    // commitment, or ask the client whose fact it is.
    //
    // What keeps this from being a deadlock is `askUserAvailable`, which is
    // false the moment the budget is spent, the ask-rounds cap is reached, the
    // principal is unreachable, or the turn is the last one. Every one of those
    // reopens the verdict immediately — the floor holds only while there is a
    // real question left to ask.
    //
    // CRITICAL, and the opposite of the anti-echo re-issue below: an `ask_user`
    // drafted on THIS re-issue is the outcome the floor exists to produce, so
    // it is offered in the seat vocabulary and flows through the ordinary
    // admission and park path. The anti-echo re-issue hard-refuses `ask_user`
    // because its trigger — a repeated message — says nothing about whether a
    // consultation is warranted; this one's trigger is precisely that one is.
    if (floorApplies && isTerminalAction(turn.action)) {
      const concludeAdmissibility = assessConcludeAdmissibility({
        checklist: nextChecklist,
        askedDimensions,
        askUserAvailable,
      });
      if (!concludeAdmissibility.admissible) {
        turnLog.info('negotiation_conclude_premature', {
          taskId: state.taskId,
          opportunityId: state.opportunityId || undefined,
          seat,
          reason: concludeAdmissibility.reason,
          action: turn.action,
          unknowns: concludeAdmissibility.unknowns,
          turnIndex: state.turnCount,
          questionsSpent,
          questionBudget,
          handledExternally: dispatchResult.handled,
        });
        emitWide({
          type: 'negotiation_conclude_premature',
          opportunityId: state.opportunityId,
          negotiationConversationId: state.conversationId,
          turnIndex: state.turnCount,
          actor: isSource ? 'source' : 'candidate',
          reason: concludeAdmissibility.reason,
          action: turn.action,
          unknowns: concludeAdmissibility.unknowns,
        });

        const reissued = applyChecklistDiscipline(
          await draftFromSystemAgent({ concludeFloor: { askableDimensions: concludeAdmissibility.unknowns } }),
          { reissue: true },
        );
        let retryTurn = reissued.turn;

        // The re-issue inherits this turn's seat vocabulary INCLUDING the ask
        // — see the note above. An out-of-seat action is still coerced exactly
        // as a dispatched one is, and its `askUser` payload goes with it.
        if (version === 'v2' && !allowedActionsFor(version, seat, isFinalTurn, { askUser: askUserAvailable }).includes(retryTurn.action)) {
          turnLog.warn('Conclusion-floor re-issue returned an action this turn cannot take, coercing to conservative fallback', {
            taskId: state.taskId,
            seat,
            action: retryTurn.action,
            isFinalTurn,
          });
          const { askUser: _refused, ...rest } = retryTurn;
          retryTurn = { ...rest, action: fallbackActionFor(version, seat, isFinalTurn) };
        }
        // Every gate the first draft passed, applied to what replaces it. The
        // decline law binds a re-issued decline as it bound the first; the ask
        // gates bind a re-issued ask, which is the whole reason they became a
        // function.
        retryTurn = enforceDeclineVerdictLaw(retryTurn, reissued.checklist, { reissue: true });
        retryTurn = enforceAskAdmission(retryTurn, reissued.checklist, {
          agentDrafted: !!retryTurn.askUser,
          reissue: true,
        });
        retryTurn = enforceAuthoredQuestionSafety(retryTurn);

        turnLog.info('negotiation_conclude_premature_reissued', {
          taskId: state.taskId,
          opportunityId: state.opportunityId || undefined,
          seat,
          turnIndex: state.turnCount,
          action: retryTurn.action,
          asked: retryTurn.action === 'ask_user',
        });
        turn = retryTurn;
        nextChecklist = reissued.checklist;
      }
    }

    // ─── The copy-loop guard: no turn may repeat a message on the record ──
    // Observed live: a counterparty asked what a phrase in the client's signal
    // meant; the answering agent could not consult its own (unreachable)
    // principal and its record did not settle the phrase, so with no good move
    // it copied the question back verbatim. From there both models locked —
    // reproducing text already in context is close to deterministic — and the
    // negotiation spent its remaining turns exchanging two byte-identical
    // messages before one side declined citing "repeated lack of clarity".
    //
    // The comparison is exact text, not similarity: it is the failure that was
    // actually observed (identical `parts` objects, identical md5 over the
    // message), and an exact match cannot be a false positive — no legitimate
    // turn advances a negotiation by re-sending a message already in it. Two
    // agents making the same POINT in different words is a real exchange and
    // must stay untouched, which a similarity threshold could not promise.
    //
    // Messages only, and non-terminal turns only.
    //
    // `null`/absent messages cover `ask_user` and every turn that carries
    // reasoning alone; there is nothing on the record for those to duplicate.
    //
    // TERMINAL turns are exempt on principle, not convenience: this guard
    // exists to stop a LOOP, and a turn that ends the negotiation cannot loop.
    // The cost of covering them would be paid in the wrong direction — an
    // `accept` that happens to close by restating the outreach it is accepting
    // would be refused, and a successful match would end as a stall. Refusing a
    // terminal turn destroys the outcome; letting a cosmetic repeat through
    // costs a duplicated line in a transcript that is already over.
    //
    // Deadlock detection (IND-428) does not cover this and cannot: it needs
    // four consecutive non-convergent turns, which on a six-turn cap arrives
    // one turn before the end — after the loop has already consumed the
    // negotiation. This runs on the first repeat, before it is persisted.
    const priorMessages = new Set(
      history
        .map((prior) => (typeof prior.message === 'string' ? prior.message.trim() : ''))
        .filter((message) => message.length > 0),
    );
    const repeatsPriorMessage = (candidate: NegotiationTurn): string | null => {
      if (isTerminalAction(candidate.action)) return null;
      const message = typeof candidate.message === 'string' ? candidate.message.trim() : '';
      return message.length > 0 && priorMessages.has(message) ? message : null;
    };

    const repeatedMessage = repeatsPriorMessage(turn);
    if (repeatedMessage) {
      turnLog.warn('negotiation_turn_repetition', {
        taskId: state.taskId,
        opportunityId: state.opportunityId || undefined,
        seat,
        turnIndex: state.turnCount,
        action: turn.action,
        attempt: 'draft',
        handledExternally: dispatchResult.handled,
      });
      emitWide({
        type: 'negotiation_turn_repetition',
        opportunityId: state.opportunityId,
        negotiationConversationId: state.conversationId,
        turnIndex: state.turnCount,
        actor: isSource ? 'source' : 'candidate',
        attempt: 'draft',
      });

      // The duplicate is discarded — never persisted — and the turn is re-issued
      // ONCE, told what it repeated. Coercion is deterministic on purpose: the
      // agent gets one chance to contribute something new, and if it cannot, the
      // negotiation ends honestly rather than filling its remaining turns with
      // copies and calling the result a decision.
      const reissued = applyChecklistDiscipline(
        await draftFromSystemAgent({ antiEcho: { repeatedMessage } }),
        { reissue: true },
      );
      let retryTurn = reissued.turn;

      // The re-issue inherits this turn's seat vocabulary, and nothing else it
      // could have earned earlier in the node. An out-of-seat action is coerced
      // exactly as a dispatched one is; `ask_user` is refused outright, because
      // the consultation decision — grant, policy admission, admissibility —
      // was already taken above for this turn, and re-running it from here
      // would let a repeated message become a park that skipped every one of
      // those gates. Its `askUser` payload goes with it: no other action may
      // carry one into the record.
      if (version === 'v2' && !allowedActionsFor(version, seat, isFinalTurn, { askUser: false }).includes(retryTurn.action)) {
        turnLog.warn('Anti-echo re-issue returned an action this turn cannot take, coercing to conservative fallback', {
          taskId: state.taskId,
          seat,
          action: retryTurn.action,
          isFinalTurn,
        });
        const { askUser: _refused, ...rest } = retryTurn;
        retryTurn = { ...rest, action: fallbackActionFor(version, seat, isFinalTurn) };
      }
      // The gates the first draft passed, applied to what would replace it.
      retryTurn = enforceDeclineVerdictLaw(retryTurn, reissued.checklist, { reissue: true });
      retryTurn = enforceAuthoredQuestionSafety(retryTurn);

      const repeatedAgain = repeatsPriorMessage(retryTurn);
      if (repeatedAgain) {
        // Twice is not a slip. Nothing is persisted, the turn count does not
        // move, and the negotiation ends as what it is: stalled on repetition.
        // NOT a decline — no side decided anything, and finalize must not be
        // able to read a verdict out of this. That is why it travels as its own
        // channel rather than as `error`, which means the agent produced no
        // turn at all.
        turnLog.error('negotiation_repetition_stalled', {
          taskId: state.taskId,
          opportunityId: state.opportunityId || undefined,
          seat,
          turnIndex: state.turnCount,
          action: retryTurn.action,
        });
        emitWide({
          type: 'negotiation_turn_repetition',
          opportunityId: state.opportunityId,
          negotiationConversationId: state.conversationId,
          turnIndex: state.turnCount,
          actor: isSource ? 'source' : 'candidate',
          attempt: 'reissue',
          stalled: true,
        });
        traceEmitter?.({ type: "agent_end", name: agentName, durationMs: Date.now() - agentStart, summary: "repetition_stalled" });
        return { repetitionStalled: true };
      }

      turnLog.info('negotiation_turn_repetition_recovered', {
        taskId: state.taskId,
        opportunityId: state.opportunityId || undefined,
        seat,
        turnIndex: state.turnCount,
        action: retryTurn.action,
      });
      turn = retryTurn;
      nextChecklist = reissued.checklist;
    }

    // ─── The conclusion floor, part 2: the system fires the arrow itself ──
    // Part 1 removes the exits. This is what happens when the model refuses
    // the door anyway — which, given a week of evidence that it always does,
    // is the half the mission actually turns on. After this ships, a question
    // is a consequence of an askable unknown existing, not of a model choosing
    // to ask one.
    //
    // Placed LAST, after every gate and after the copy-loop guard, because it
    // is a statement about the turn that will actually be PERSISTED: whatever
    // survived to here is what the negotiation is about to say, and if that
    // still leaves the arrow unfired while a real question stands, the graph
    // asks it.
    //
    // Shape: the drafted turn is COERCED to `ask_user`, carrying the dimension
    // rather than an authored question. Coercion rather than "persist the turn
    // and park beside it" for two reasons that are not stylistic:
    //
    //  1. Every accounting the protocol has — the per-principal budget, the
    //     asked-topics record, the negotiation-wide ask-rounds cap — is read
    //     back off persisted `ask_user` turns (`negotiation.graph.shared.ts`).
    //     A park that rode alongside a `counter` would spend a person's
    //     attention while the record showed nothing spent, and the same
    //     dimension would be askable again next turn.
    //  2. After part 1 the drafted action is frequently a terminal verdict, and
    //     persisting THAT would end the negotiation — there is no "in addition"
    //     available. One shape has to cover both cases, and only this one does.
    //
    // What coercion costs is the drafted message, and that cost is paid only
    // where it should be: a TERMINAL turn's message was written to end the
    // negotiation, so it is dropped with the action it belonged to (the same
    // rule the decline law applies, and for the same reason — carried onto an
    // ask it would announce a verdict the record does not contain). A
    // non-terminal message is kept and persisted: it is a real contribution to
    // the exchange, and the seat simply parks after making it instead of
    // handing the turn over.
    //
    // This is NOT the pre-#1455 inferred consultation. That one fired from
    // action enums with no content behind them and produced "would you be open
    // to connecting?"; this fires from a named dimension the agent itself wrote
    // and itself scored unknown. That dimension already reaches the api's
    // question-message author, which reads `askUser.dimension` off the parked
    // turn — so what the client is asked is a question about the dimension, not
    // a gap guessed from the transcript. The park payload below carries it too.
    //
    // Bounded at one per negotiation per principal so a seat whose agent keeps
    // drafting around its own open dimensions parks its client once, not every
    // turn. The mark is durable — it rides on the persisted ask.
    if (
      floorApplies
      && askUserAvailable
      && !guaranteedAskSpent
      // The arrow is unfired unless this turn is an `ask_user` that can
      // actually be delivered. An `ask_user` carrying no reason is not one: it
      // parks the negotiation and enqueues nothing, so the client waits out the
      // answer window on a question that was never written. And the payload
      // alone proves nothing — a refused ask keeps its `askUser` while its
      // action is coerced away, so the action is what has to be read.
      && !(turn.action === 'ask_user' && !!turn.askUser?.reason)
    ) {
      const askable = askableUnknowns(nextChecklist, askedDimensions);
      const dimension = askable[0];
      if (dimension) {
        const droppedTerminalMessage = isTerminalAction(turn.action);
        turnLog.info('negotiation_ask_guaranteed', {
          taskId: state.taskId,
          opportunityId: state.opportunityId || undefined,
          seat,
          turnIndex: state.turnCount,
          draftedAction: turn.action,
          dimension: dimension.name,
          dimensionKind: dimension.kind,
          askable: askable.map((item) => item.name),
          questionsSpent,
          questionBudget,
          droppedTerminalMessage,
        });
        emitWide({
          type: 'negotiation_ask_guaranteed',
          opportunityId: state.opportunityId,
          negotiationConversationId: state.conversationId,
          turnIndex: state.turnCount,
          actor: isSource ? 'source' : 'candidate',
          draftedAction: turn.action,
          dimension: dimension.name,
        });
        turn = {
          ...turn,
          action: 'ask_user',
          ...(droppedTerminalMessage ? { message: null } : {}),
          askUser: {
            // The floor fires on a dimension whose answer is the principal's
            // own to give, which is what this category names. It is admission
            // metadata, never copy — the question is written from the
            // dimension, downstream.
            reason: 'unresolved_owner_constraint',
            dimension: dimension.name,
            guaranteed: true,
          },
        };
        // The park's own admission gate reads this, and the policy never saw
        // an ask to admit: the draft it judged was the one the floor replaced.
        consultationPolicyReason = 'unresolved_owner_constraint';
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
    turnLog.info('negotiation_turn_persisted', {
      taskId: state.taskId,
      opportunityId: state.opportunityId || undefined,
      conversationId: state.conversationId,
      messageId: message.id,
      turnIndex: state.turnCount,
      seat,
      action: turn.action,
      askUserReason: turn.askUser?.reason,
      askUserDimension: turn.askUser?.dimension,
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
      // The checklist dimension this park is about, resolved against the
      // frozen dimensions so what travels is the AUTHORED name and kind rather
      // than whatever the ask spelled. Carried on the payload for whatever
      // authors the client-facing question: a guaranteed ask has no authored
      // question at all, and without the dimension the author falls back to
      // deriving a gap from the transcript — the "would you be open to
      // connecting?" shape this whole protocol exists to abolish.
      //
      // Additive and optional: an author that does not read it degrades to
      // exactly today's behaviour, which is what makes shipping this ahead of
      // the api-side read safe.
      const askedDimensionKey = turn.askUser?.dimension ? dimensionKey(turn.askUser.dimension) : '';
      const askedDimensionItem = askedDimensionKey.length > 0
        ? nextChecklist.find((item) => dimensionKey(item.name) === askedDimensionKey)
        : undefined;
      const askedDimension = askedDimensionItem
        ? {
            name: askedDimensionItem.name,
            kind: askedDimensionItem.kind,
            ...(turn.askUser?.answerhood ? { answerhood: turn.askUser.answerhood } : {}),
            ...(turn.askUser?.guaranteed ? { guaranteed: true } : {}),
          }
        : undefined;

      // The task is WORKING before the binding is captured. The capture locks
      // the task row `state = 'working'` and refuses anything else — a fence on
      // the coordinate the timeout/answer paths later settle against — while
      // the graph only ever announced `working` at the END of a completed turn,
      // below. On a task's FIRST turn the row therefore still held its creation
      // state (`submitted`), and every first-turn park died on
      // "Ask-user material binding is no longer valid": the turn was already on
      // the record, so the failure was not even retryable and the negotiation
      // stalled. Latent since the pre-contact consult shipped; the conclusion
      // floor made first-turn asks routine, and a run-existing continuation's
      // turn 0 is the common one.
      //
      // Announced HERE rather than at the top of the turn deliberately. A task
      // that dies before putting anything on the record is reclaimed by the
      // watchdog's ten-minute `submitted` rule; flipping at turn start would
      // hide such a task under the twelve-hour `working` rule instead. At this
      // point the turn IS on the record, so `working` is simply true — and the
      // end-of-turn flip below stays for every path that does not park.
      await deps.database.updateTaskState(state.taskId, 'working', undefined, state.continuationExecution);

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
      turnLog.info('negotiation_ask_user_binding_captured', {
        taskId: state.taskId,
        opportunityId: state.opportunityId,
        seat,
        settlementId,
        recipientIntentId: ownIntentId,
        reason: consultationReason,
        dimension: askedDimension?.name,
      });

      // Arm the timer BEFORE flipping state: it is the durable recovery
      // trigger even when generation enqueues no job or persists no row.
      const windowMs = ASK_USER_WINDOW_MS;
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
      turnLog.info('negotiation_ask_user_expiry_armed', {
        taskId: state.taskId,
        opportunityId: state.opportunityId,
        settlementId,
        windowMs,
      });

      // Persistence admission requires the exact task to be input_required.
      // Flip before enqueue; if the structured ask_user fields fail the
      // deterministic privacy gate, the timer alone closes the exact task.
      await deps.database.updateTaskState(state.taskId, 'input_required', undefined, state.continuationExecution);
      turnLog.info('negotiation_ask_user_task_parked', {
        taskId: state.taskId,
        opportunityId: state.opportunityId,
        settlementId,
        recipientIntentId: ownIntentId,
      });
      if (safeAskUser) {
        const userContext = (await deps.database.getUserContext(ownUser.id, null).catch(() => null))?.text ?? '';
        try {
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
              ...(askedDimension && { dimension: askedDimension }),
              ...(userContext && { userContext }),
            },
          });
          turnLog.info('negotiation_ask_user_question_enqueued', {
            taskId: state.taskId,
            opportunityId: state.opportunityId,
            settlementId,
            recipientIntentId: ownIntentId,
            reason: consultationReason,
            dimension: askedDimension?.name,
          });
        } catch (error) {
          turnLog.error('Failed to enqueue safe ask_user question; timeout recovery remains armed', {
            taskId: state.taskId,
            opportunityId: state.opportunityId,
            error,
          });
        }
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
