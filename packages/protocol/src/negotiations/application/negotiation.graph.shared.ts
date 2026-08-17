/**
 * Shared vocabulary for the negotiation graph's nodes.
 *
 * The nodes were closures inside `NegotiationGraphFactory.createGraph()`,
 * capturing the injected database, dispatcher and queues. They are top-level
 * functions now, each taking an explicit {@link NegotiationGraphDeps}; this
 * module owns the bag itself and the helpers more than one node needs.
 */

import { StateGraph } from "@langchain/langgraph";

import { invokeWithAbortSignal } from "../../shared/agent/model-signal.js";
import { requestContext, type TraceEmitter } from "../../shared/observability/request-context.js";
import type { NegotiationGraphDatabase, OpportunityStatus, NegotiationContinuationReceipt } from "../../shared/interfaces/database.interface.js";
import type { NegotiationTimeoutQueue } from "../../shared/interfaces/negotiation-events.interface.js";
import type { AgentDispatcher, NegotiationTurnPayload } from "../../shared/interfaces/agent-dispatcher.interface.js";
import { NegotiationGraphState, type NegotiationTurn, type NegotiationOutcome, type UserNegotiationContext, type NegotiationGraphLike } from "../domain/negotiation.state.js";
import { IndexNegotiator } from "./negotiation.agent.js";
import { allowedActionsFor, askUserAnswerWindowMs, configuredAskUserEnabled, configuredProtocolVersion, fallbackActionFor, isRejectLikeAction, isTerminalAction, readProtocolVersion, rejectActionFor } from "../domain/negotiation.protocol.js";
import { assessConsultationEligibility, consultationPromptFor, negotiationConsultationPolicyMode, type NegotiationConsultationReason } from "../domain/negotiation.consultation-policy.js";
import { blocksNegotiationBeforeFirstTurn, NegotiationScreener, type ScreenDecision, type ScreenDecisionRecord } from "./negotiation.screen.js";
import { configuredScreenMode } from "../domain/negotiation.screen.contracts.js";
import { assessDeadlock, configuredDeadlockShiftEnabled, configuredDeadlockThreshold, type DeadlockAssessment, type DeadlockShiftRecord } from "../domain/negotiation.deadlock.js";
import type { NegotiationSeat, NegotiationProtocolVersion } from "../../shared/schemas/negotiation-state.schema.js";
import { protocolLogger } from "../../shared/observability/protocol.logger.js";
import type { QuestionerEnqueueFn } from "../../questions/question.module.js";
import type { ReflectEnqueueFn } from "./negotiation.reflect.js";
import type { NegotiatorMemoryEntry, NegotiatorMemoryRetrieveFn, NegotiatorMemoryScope } from "../domain/negotiation.memory.js";
import { NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY, NEGOTIATION_QUESTION_GENERIC_NETWORK, negotiationQuestionSettlementId } from '../domain/negotiation.question-safety.js';
import { buildIntentSnapshots } from "../domain/negotiation.intent-snapshot-provenance.js";
import { holdsNegotiationConversationLock } from "../domain/negotiation.task-lock-policy.js";
import { isNegotiationTurnCapReached } from "../domain/negotiation.turn-cap.js";
import { expectedNegotiationSpeaker } from "../domain/negotiation.expected-speaker.js";
import { attributedDialogueIsEmpty, buildSeededAttribution, combineAttributedDialogue, type AttributedPriorDialogue, type TaskAttribution } from '../negotiation.attribution.js';

/** The graph's channel state, as every node sees it. */
export type NegotiationState = typeof NegotiationGraphState.State;

/** Everything the negotiation nodes reach for. Composed once by the factory. */
export interface NegotiationGraphDeps {
  database: NegotiationGraphDatabase;
  dispatcher: AgentDispatcher;
  timeoutQueue?: NegotiationTimeoutQueue;
  questionerEnqueue?: QuestionerEnqueueFn;
  reflectEnqueue?: ReflectEnqueueFn;
  memoryRetrieve?: NegotiatorMemoryRetrieveFn;
  /** In-process negotiator used when no personal agent answers. */
  systemAgent: IndexNegotiator;
  /** Outreach gate for fresh negotiations. */
  screener: NegotiationScreener;
}

export const logger = protocolLogger("NegotiationGraph");
export const initLog = protocolLogger("NegotiationGraph:Init");
export const screenNodeLog = protocolLogger("NegotiationGraph:Screen");
export const turnLog = protocolLogger("NegotiationGraph:Turn");
export const finalizeLog = protocolLogger("NegotiationGraph:Finalize");
export const negotiateCandidatesLog = protocolLogger("NegotiationGraph:negotiateCandidates");

/** Extracts the ordered NegotiationTurn list from A2A message data parts. */
export function turnsFromMessages(messages: Array<{ parts: unknown[] }>): NegotiationTurn[] {
  return messages
    .map((m) => {
      const dataPart = (m.parts as Array<{ kind?: string; data?: unknown }>).find((p) => p.kind === "data");
      return dataPart?.data as NegotiationTurn;
    })
    .filter(Boolean);
}

/**
 * Whether `userId`'s side has already spent its one `ask_user` client
 * consultation in this conversation (P3.2 rationing: max one per negotiation
 * per side, checked against the full message history so continuations count
 * prior sessions' consultations too).
 */
export function hasPriorAskUser(
  messages: Array<{ senderId: string; parts: unknown[] }>,
  userId: string,
): boolean {
  const sender = `agent:${userId}`;
  return messages.some((m) => {
    if (m.senderId !== sender) return false;
    const dataPart = (m.parts as Array<{ kind?: string; data?: { action?: string } }>).find((p) => p.kind === "data");
    return dataPart?.data?.action === "ask_user";
  });
}

/**
 * P5.3 memory retrieval — never throws, never blocks a negotiation. The
 * injected fn already resolves [] when NEGOTIATOR_MEMORY_INJECT is off;
 * this wrapper adds the graph-side failure guard.
 */
export async function retrieveMemory(
  deps: NegotiationGraphDeps,
  userId: string,
  counterpartyUserId: string,
  queryText: string,
  scope: NegotiatorMemoryScope,
): Promise<NegotiatorMemoryEntry[]> {
  if (!deps.memoryRetrieve) return [];
  try {
    return await deps.memoryRetrieve({ userId, counterpartyUserId, queryText, scope });
  } catch (err) {
    logger.warn("Negotiator memory retrieval failed; proceeding without memory", {
      userId,
      scope,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Similarity query text: seed reasoning + counterparty context. */
export function memoryQueryText(
  state: NegotiationState,
  counterparty: UserNegotiationContext,
): string {
  return [
    state.discoveryQuery ? `Search: ${state.discoveryQuery}` : "",
    state.seedAssessment?.reasoning ?? "",
    counterparty?.profile?.name ?? "",
    counterparty?.profile?.bio ?? "",
    (counterparty?.intents ?? []).slice(0, 5).map((i) => `${i.title}: ${i.description}`).join("\n"),
  ].filter(Boolean).join("\n");
}

/**
 * IND-569: resolve a prior negotiation task's attribution metadata for the
 * per-opportunity prior-dialogue labels. Never throws — any failure returns
 * null so the turns degrade to the unattributed block instead of leaking
 * into the current opportunity's context.
 */
export async function resolveTaskAttribution(
  deps: NegotiationGraphDeps,
  taskId: string,
): Promise<TaskAttribution | null> {
try {
  const task = await deps.database.getTask(taskId);
  if (!task) return null;
  const md = (task.metadata ?? {}) as Record<string, unknown>;
  const opportunityId = typeof md.opportunityId === 'string' && md.opportunityId.length > 0 ? md.opportunityId : null;
  const snapshots = Array.isArray(md.intentSnapshots) ? (md.intentSnapshots as Array<Record<string, unknown>>) : [];
  const sourceIntentId = typeof md.sourceIntentId === 'string' ? md.sourceIntentId : null;
  const snap = snapshots.find((s) => s && s.intentId === sourceIntentId) ?? snapshots[0];
  const opportunityTitle = snap && typeof snap.title === 'string' && snap.title.trim().length > 0 ? (snap.title as string) : null;
  let outcome: string | null = null;
  try {
    const artifacts = await deps.database.getArtifactsForTask(taskId);
    const outArtifact = artifacts.find((a) => a.name === 'negotiation-outcome');
    if (outArtifact) {
      const firstPart = Array.isArray(outArtifact.parts) ? (outArtifact.parts[0] as Record<string, unknown> | undefined) : undefined;
      const data = firstPart?.data as Record<string, unknown> | undefined;
      if (data && typeof data.hasOpportunity === 'boolean') {
        outcome = data.hasOpportunity ? 'accepted' : (data.reason === 'screened_out' ? 'not pursued' : 'declined');
      } else if (typeof outArtifact.metadata?.continuationOutcome === 'string') {
        outcome = outArtifact.metadata.continuationOutcome as string;
      }
    }
  } catch { /* outcome stays null; header degrades to "outcome unknown" */ }
  const concludedAt = task.updatedAt instanceof Date
    ? task.updatedAt.toISOString()
    : (task.updatedAt ? new Date(task.updatedAt as unknown as string).toISOString() : null);
  return { opportunityId, opportunityTitle, outcome, concludedAt };
} catch {
  return null;
}
}

/**
 * IND-569: build the attributed prior dialogue passed to the screener and
 * turn prompts. Combines the immutable seeded attribution (earlier + legacy
 * unattributed blocks, resolved once in init) with this session's own turns
 * (task-id-matched). Null when there is no seeded attribution.
 */
export function buildAttributedDialogue(
  state: NegotiationState,
): AttributedPriorDialogue | null {
  if (!state.isContinuation || !state.priorAttribution) return null;
  const currentSessionTurns = turnsFromMessages(
    state.messages.filter((m) => (m as { taskId?: string | null }).taskId === state.taskId),
  );
  const dialogue = combineAttributedDialogue(state.priorAttribution as import('../negotiation.attribution.js').SeededAttribution, currentSessionTurns);
  return attributedDialogueIsEmpty(dialogue) ? null : dialogue;
}
