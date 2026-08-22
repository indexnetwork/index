/**
 * Negotiation graph, stage 1: claim the conversation, task and seat.
 */

import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { requestContext } from "../shared/observability/request-context.js";
import type { NegotiationContinuationReceipt } from "../../platform/database.js";
import type { NegotiationTurnPayload } from "../shared/interfaces/agent-dispatcher.interface.js";
import { type NegotiationTurn, type NegotiationOutcome } from "./negotiation.state.js";
import { allowedActionsFor, ASK_USER_WINDOW_MS, NEGOTIATION_MAX_TURNS_AMBIENT, NEW_NEGOTIATION_PROTOCOL_VERSION, fallbackActionFor, isRejectLikeAction, isTerminalAction, readProtocolVersion, rejectActionFor } from "./negotiation.protocol.js";
import { assessConsultationEligibility, consultationPromptFor, type NegotiationConsultationReason } from "./negotiation.consultation-policy.js";
import { assessDeadlock, type DeadlockAssessment, type DeadlockShiftRecord } from "./negotiation.deadlock.js";
import type { NegotiationSeat, NegotiationProtocolVersion } from "../../protocol/schemas/negotiation-state.schema.js";
import { NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY, NEGOTIATION_QUESTION_GENERIC_NETWORK, negotiationQuestionSettlementId } from './negotiation.question-safety.js';
import { buildIntentSnapshots } from "./negotiation.intent-snapshot-provenance.js";
import { holdsNegotiationConversationLock } from "./negotiation.task-lock-policy.js";
import { isNegotiationTurnCapReached } from "./negotiation.turn-cap.js";
import { expectedNegotiationSpeaker } from "./negotiation.expected-speaker.js";
import { readNegotiationMessages } from "./negotiation.scope.js";
import { buildSeededAttribution } from './negotiation.attribution.js';
import { buildAttributedDialogue, finalizeLog, hasPriorAskUser, initLog, memoryQueryText, negotiateCandidatesLog, resolveTaskAttribution, retrieveMemory, turnLog, turnsFromMessages } from "./negotiation.graph.shared.js";
import type { NegotiationGraphDeps, NegotiationState } from "./negotiation.graph.shared.js";


export async function initNode(state: NegotiationState, deps: NegotiationGraphDeps) {
  try {
    // Exact continuations reuse the prior conversation and preclaimed
    // successor; they must not create any mutable state before the fence.
    const agentIdA = `agent:${state.sourceUser.id}`;
    const agentIdB = `agent:${state.candidateUser.id}`;
    const execution = state.continuationExecution;
    const conversation = execution
      ? { id: execution.conversationId }
      : await deps.database.getOrCreateDM(agentIdA, agentIdB, 'agent');

    // --- Lock gate: check for an active task on this conversation ---
    // Two reads with two jobs. `conversationMessages` is the pair's whole shared
    // DM — CONTEXT, including negotiations for other matches, which reaches the
    // agent only as labelled prior dialogue. `negotiationMessages` is THIS
    // match's own turns, and is the sole input to this negotiation's state:
    // whether it has opened, whose turn it is, how far it has run.
    const conversationMessages = await deps.database.getMessagesForConversation(conversation.id);

    if (
      Boolean(state.resumeFromTaskId) !== Boolean(state.continuationSettlementId)
      || Boolean(state.resumeFromTaskId) !== Boolean(execution)
    ) return { error: 'invalid continuation correlation' };
    const exactContinuation = state.resumeFromTaskId && state.continuationSettlementId && execution
      ? { taskId: state.resumeFromTaskId, settlementId: state.continuationSettlementId, execution }
      : null;
    const priorTask = exactContinuation
      ? await deps.database.getTask(exactContinuation.taskId)
      : state.opportunityId
        ? await deps.database.getNegotiationTaskForOpportunity(state.opportunityId)
        : null;
    const claimedSuccessor = exactContinuation
      ? await deps.database.getTask(exactContinuation.execution.successorTaskId)
      : null;
    if (exactContinuation) {
      const settlement = priorTask?.metadata?.questionSettlement as Record<string, unknown> | undefined;
      const storedExecution = claimedSuccessor?.metadata?.continuationExecution as Record<string, unknown> | undefined;
      if (
        !priorTask
        || priorTask.conversationId !== conversation.id
        || priorTask.state !== 'canceled'
        || priorTask.metadata?.opportunityId !== state.opportunityId
        || settlement?.settlementId !== exactContinuation.settlementId
        || settlement?.taskId !== exactContinuation.taskId
        || !claimedSuccessor
        || claimedSuccessor.conversationId !== conversation.id
        || storedExecution?.token !== exactContinuation.execution.token
        || storedExecution?.fence !== exactContinuation.execution.fence
        || storedExecution?.status !== 'claimed'
      ) return { error: 'invalid exact continuation task' };
    }
    const isLocked = !exactContinuation && !!priorTask && holdsNegotiationConversationLock(priorTask);

    if (isLocked) {
      initLog.info('Conversation locked by active task, returning busy', {
        conversationId: conversation.id,
        opportunityId: state.opportunityId,
      });
      return { error: 'busy' };
    }

    // --- Load this negotiation's own prior turns ---
    // Resolved through the shared scope rule, not a local copy of it: the graph
    // and the respond/polling surfaces must agree on what "this negotiation's
    // messages" means, or an external agent can be told it is not its turn
    // forever. That rule also owns the unkeyed case — a run with no opportunity
    // has no identity apart from its conversation.
    const negotiationMessages = await readNegotiationMessages({
      byNegotiation: (id) => deps.database.getNegotiationMessages(id),
      byConversation: async () => conversationMessages,
    }, {
      conversationId: conversation.id,
      metadata: { opportunityId: state.opportunityId },
    });
    const priorTurns: NegotiationTurn[] = turnsFromMessages(negotiationMessages);

    // `isContinuation` means THIS negotiation has already spoken — not that the
    // pair has history. A fresh match in a long-running DM is not a
    // continuation, and must still open.
    const isContinuation = priorTurns.length > 0;

    // Determine scenario-based maxTurns
    const scope = { action: 'manage:negotiations', scopeType: 'network', scopeId: state.indexContext.networkId };
    const [sourceHasAgent, candidateHasAgent] = await Promise.all([
      deps.dispatcher.hasExternalAgent(state.sourceUser.id, scope),
      deps.dispatcher.hasExternalAgent(state.candidateUser.id, scope),
    ]);

    let maxTurns = state.maxTurns;
    if (maxTurns == null) {
      maxTurns = (sourceHasAgent && candidateHasAgent) ? 0 : NEGOTIATION_MAX_TURNS_AMBIENT;
    }

    // --- Initiator seat resolution (v2: rigid per match, stamped at discovery) ---
    // 1. Continuations inherit from the prior task for the same opportunity —
    //    never re-derive, so the seat cannot flip between sessions.
    // 2. Conversation-scoped tie-break: if another negotiation on this DM is
    //    active and fresh (symmetric concurrent start under a different
    //    opportunityId — the opportunity-scoped lock above cannot see it),
    //    the first created task keeps the seat; this run inherits its stamp.
    // 3. Otherwise: explicit stamp from the caller, falling back to the
    //    session's sourceUser (pre-stamp heuristic behavior, unchanged).
    const readInitiator = (metadata: Record<string, unknown> | null | undefined): string | null => {
      const v = metadata?.initiatorUserId;
      return typeof v === 'string' && v.length > 0 ? v : null;
    };
    let initiatorUserId = readInitiator(priorTask?.metadata) ?? state.initiatorUserId ?? state.sourceUser.id;
    // Conversation-scoped prior task: used only for the initiator tie-break
    // (and only when active+fresh).
    const convTask = !exactContinuation && !readInitiator(priorTask?.metadata)
      ? await deps.database.getLatestNegotiationTaskForConversation?.(conversation.id).catch(() => null)
      : null;
    if (!readInitiator(priorTask?.metadata)) {
      if (convTask && convTask.id !== priorTask?.id && holdsNegotiationConversationLock(convTask)) {
        const convInitiator = readInitiator(convTask.metadata);
        if (convInitiator) {
          initLog.info('Conversation-scoped tie-break: inheriting initiator seat from concurrent task', {
            conversationId: conversation.id,
            winningTaskId: convTask.id,
            initiatorUserId: convInitiator,
          });
          initiatorUserId = convInitiator;
        }
      }
    }

    // --- Floor: derived from this negotiation's turns, after the seat is known ---
    // Resolved here rather than above because an unopened negotiation starts
    // with its initiator, which the tie-break may only just have settled.
    const expectedSpeaker = expectedNegotiationSpeaker({
      sourceUserId: state.sourceUser.id,
      candidateUserId: state.candidateUser.id,
      initiatorUserId,
    }, negotiationMessages);
    if (!expectedSpeaker) return { error: 'invalid negotiation participants' };
    const currentSpeaker: 'source' | 'candidate' = expectedSpeaker === state.sourceUser.id
      ? 'source'
      : 'candidate';

    // --- Protocol version: pinned per negotiation, re-stamped per match ---
    // A prior task for this same negotiation (exact continuation resume or
    // a re-run of the same opportunity) pins the version, so one
    // negotiation never flips semantics mid-flight (absent field on a
    // genuine prior = pre-v2 task = v1). Everything else — including
    // continuations of older conversations between the same pair — stamps
    // fresh as v2, so the cutover reaches existing pairs on their next new
    // match instead of being pinned to v1 forever by conversation history.
    const protocolVersion: NegotiationProtocolVersion = priorTask
      ? (readProtocolVersion(priorTask.metadata) ?? 'v1')
      : NEW_NEGOTIATION_PROTOCOL_VERSION;

    const taskMetadata = {
      type: 'negotiation',
      sourceUserId: state.sourceUser.id,
      initiatorUserId,
      protocolVersion,
      candidateUserId: state.candidateUser.id,
      networkId: state.indexContext.networkId,
      sourceIntentId: state.sourceIntentId,
      candidateIntentId: state.candidateIntentId,
      participantBindings: [
        ...(state.sourceIntentId ? [{ userId: state.sourceUser.id, intentId: state.sourceIntentId, networkId: state.indexContext.networkId }] : []),
        ...(state.candidateIntentId ? [{ userId: state.candidateUser.id, intentId: state.candidateIntentId, networkId: state.indexContext.networkId }] : []),
      ],
      intentSnapshots: buildIntentSnapshots(state.sourceUser, state.candidateUser),
      ...(state.opportunityId && { opportunityId: state.opportunityId }),
      maxTurns,
      isContinuation,
      priorTurnCount: priorTurns.length,
      ...(exactContinuation ? {
        resumeFromTaskId: exactContinuation.taskId,
        continuationSettlementId: exactContinuation.settlementId,
      } : {}),
    };
    if (state.opportunityId && Boolean(state.opportunityStatus) !== Boolean(state.opportunityUpdatedAt)) {
      throw new Error('Negotiation attempt requires both opportunity status and updatedAt');
    }

    const task = exactContinuation
      ? claimedSuccessor
      : state.opportunityId && state.opportunityStatus && state.opportunityUpdatedAt
        ? await deps.database.createNegotiationTaskForAttempt({
            conversationId: conversation.id,
            opportunityId: state.opportunityId,
            expectedStatus: state.opportunityStatus,
            expectedUpdatedAt: state.opportunityUpdatedAt,
            metadata: taskMetadata,
          })
        : await deps.database.createTask(conversation.id, taskMetadata);

    if (!task) {
      throw new Error('Negotiation attempt is stale or already claimed');
    }

    // Attempt-bound discovery atomically promoted the exact persisted state
    // to `negotiating` while inserting the task. Legacy/direct invocations
    // with only an opportunity ID retain the prior best-effort status update.
    if (state.opportunityId && !state.opportunityUpdatedAt) {
      await deps.database.updateOpportunityStatus(state.opportunityId, 'negotiating').catch((err) => {
        initLog.error('Failed to set opportunity status to negotiating', { opportunityId: state.opportunityId, error: err });
      });
    }

    // Load user answers collected by the questioner between sessions
    const userAnswers = (isContinuation && state.opportunityId)
      ? await deps.database.getOpportunityUserAnswers(state.opportunityId).catch((err) => {
          initLog.error('Failed to load user answers', { opportunityId: state.opportunityId, error: err });
          return [];
        })
      : [];

    // Seed messages with THIS negotiation's prior turns (additive reducer
    // appends new turns on top). taskId is preserved so the turn/screen nodes
    // can separate this session's turns from earlier sessions of the same
    // negotiation (IND-569).
    const seedMessages = negotiationMessages.map((m) => ({
      id: m.id,
      senderId: m.senderId,
      role: 'agent' as const,
      parts: m.parts,
      createdAt: m.createdAt,
      taskId: (m as { taskId?: string | null }).taskId ?? null,
    }));

    // IND-569: attribute the pair's whole shared DM to its originating
    // negotiations, once, up front. Earlier-match and legacy unattributed
    // blocks are immutable for the session; the current block is composed per
    // turn. Keyed on the conversation, not on `isContinuation`: a fresh match
    // has no turns of its own but the pair's history is exactly the context
    // worth carrying into it.
    const priorAttribution = conversationMessages.length > 0
      ? await buildSeededAttribution(
          conversationMessages
            .map((m) => ({ taskId: (m as { taskId?: string | null }).taskId ?? null, turn: turnsFromMessages([m])[0] }))
            .filter((e): e is { taskId: string | null; turn: NegotiationTurn } => Boolean(e.turn)),
          state.opportunityId,
          (taskId: string) => resolveTaskAttribution(deps, taskId),
        )
      : null;


    return {
      conversationId: conversation.id,
      taskId: task.id,
      currentSpeaker,
      turnCount: 0,
      maxTurns,
      isContinuation,
      initiatorUserId,
      protocolVersion,
      priorTurnCount: priorTurns.length,
      ...(priorAttribution && { priorAttribution }),
      ...(userAnswers.length > 0 && { userAnswers }),
      ...(exactContinuation?.execution.consultation
        ? { privateConsultation: exactContinuation.execution.consultation }
        : {}),
      ...(exactContinuation && (() => {
        const turnContext = priorTask?.metadata?.turnContext as Record<string, unknown> | undefined;
        const reason = turnContext?.consultationPolicyReason;
        return typeof reason === 'string' ? { consultationPolicyReason: reason as NegotiationConsultationReason } : {};
      })()),
      ...(seedMessages.length > 0 && { messages: seedMessages }),
    };
  } catch (err) {
    return { error: `Init failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
