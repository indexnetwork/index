/**
 * Negotiation graph, stage 2: the outreach gate.
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
import { buildAttributedDialogue, finalizeLog, hasPriorAskUser, initLog, memoryQueryText, negotiateCandidatesLog, resolveTaskAttribution, retrieveMemory, screenNodeLog, turnLog, turnsFromMessages } from "./negotiation.graph.shared.js";
import type { NegotiationGraphDeps, NegotiationState } from "./negotiation.graph.shared.js";

    /**
     * Screen node (P2.1) — the outreach gate. Runs between init and the first
     * turn on FRESH negotiations only (routing skips it on continuations and
     * when NEGOTIATION_SCREEN_MODE=off). The reaching client's negotiator
     * decides whether the match is worth its client's name; in shadow mode the
     * decision is recorded (task metadata + trace event + log line) but never
     * blocks — the negotiation always proceeds to the first turn. In enforce
     * mode (P2.2) a `pass` routes straight to finalize: zero turns, zero
     * counterparty involvement, outcome `reason: "screened_out"`, opportunity
     * quietly `rejected` (init had already flipped it to `negotiating`).
     * A failed screen still fails OPEN in every mode.
     */
export async function screenNode(state: NegotiationState, deps: NegotiationGraphDeps) {
  const traceEmitter = requestContext.getStore()?.traceEmitter;
  const emitWide = (event: Record<string, unknown>) =>
    (traceEmitter as ((e: Record<string, unknown>) => void) | undefined)?.(event);

  const mode = configuredScreenMode();
  const start = Date.now();
  // The client is the initiator seat's user — the side whose negotiator is
  // reaching out. Fresh runs stamp initiatorUserId in init; fall back to
  // sourceUser (what the stamp defaults to anyway).
  const initiatorId = state.initiatorUserId ?? state.sourceUser.id;
  const clientIsSource = initiatorId !== state.candidateUser.id;
  const clientUser = clientIsSource ? state.sourceUser : state.candidateUser;
  const counterpartyUser = clientIsSource ? state.candidateUser : state.sourceUser;

  // P5.3: the client's own negotiator memory informs the outreach gate.
  // Cached into state so the client's first turn reuses it.
  const clientSide: "source" | "candidate" = clientIsSource ? "source" : "candidate";
  const clientMemory = state.memoryBySide?.[clientSide]
    ?? (deps.memoryRetrieve
      ? await retrieveMemory(deps, clientUser.id, counterpartyUser.id, memoryQueryText(state, counterpartyUser), "screen")
      : []);

  let decision: ScreenDecision;
  let failedOpen = false;
  let screenError: string | undefined;
  try {
    const counterpartyContext = (await deps.database.getUserContext(counterpartyUser.id, null).catch(() => null))?.text ?? "";
    const priorDialogueAttributed = buildAttributedDialogue(state);
    decision = await deps.screener.invoke({
      clientUser,
      counterpartyUser,
      ...(counterpartyContext && { counterpartyContext }),
      ...(clientMemory.length > 0 && { memory: clientMemory }),
      // discoveryQuery belongs to the discovery session's source user; only
      // meaningful for the client when the client holds the source side.
      ...(clientIsSource && state.discoveryQuery && { discoveryQuery: state.discoveryQuery }),
      seedAssessment: state.seedAssessment,
      indexContext: state.indexContext,
      isContinuation: state.isContinuation,
      ...(state.messages.length > 0 && { priorDialogue: turnsFromMessages(state.messages) }),
      ...(priorDialogueAttributed && { priorDialogueAttributed }),
    });
  } catch (err) {
    // Fail open: a screen failure must never block a negotiation.
    failedOpen = true;
    screenError = err instanceof Error ? err.message : String(err);
    screenNodeLog.warn("Screen failed; proceeding open (reach_out)", {
      taskId: state.taskId,
      opportunityId: state.opportunityId || undefined,
      error: screenError,
    });
    decision = {
      decision: "reach_out",
      reasoning: `screen_error: ${screenError}`,
      evidence: { counterpartyPremiseFit: "", intentAlignment: "" },
    };
  }

  const durationMs = Date.now() - start;
  const record: ScreenDecisionRecord = {
    ...decision,
    mode,
    ...(failedOpen && { failedOpen, error: screenError }),
    screenedAt: new Date().toISOString(),
    durationMs,
  };

  await deps.database.setTaskScreenDecision?.(state.taskId, record as unknown as Record<string, unknown>, state.continuationExecution).catch((err) => {
    screenNodeLog.error("Failed to persist screen decision", { taskId: state.taskId, error: err });
  });

  screenNodeLog.info("negotiation_screen", {
    taskId: state.taskId,
    opportunityId: state.opportunityId || undefined,
    decision: decision.decision,
    mode,
    failedOpen,
    durationMs,
  });

  if (state.opportunityId) {
    emitWide({
      type: "negotiation_screen",
      opportunityId: state.opportunityId,
      negotiationConversationId: state.conversationId,
      decision: decision.decision,
      reasoning: decision.reasoning,
      mode,
      failedOpen,
      durationMs,
    });
  }

  // Routing happens on the conditional edge: shadow always proceeds to
  // the first turn; enforce routes a (non-failed-open) pass to finalize.
  return { screenDecision: record, memoryBySide: { [clientSide]: clientMemory } };
}
