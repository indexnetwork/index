/**
 * Shared vocabulary for the negotiation graph's nodes.
 *
 * The nodes were closures inside `NegotiationGraphFactory.createGraph()`,
 * capturing the injected database, dispatcher and queues. They are top-level
 * functions now, each taking an explicit {@link NegotiationGraphDeps}; this
 * module owns the bag itself and the helpers more than one node needs.
 */

import { StateGraph } from "@langchain/langgraph";

import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { requestContext, type TraceEmitter } from "../shared/observability/request-context.js";
import type { NegotiationGraphDatabase, OpportunityStatus, NegotiationContinuationReceipt } from "../shared/interfaces/database.interface.js";
import type { NegotiationTimeoutQueue } from "../shared/interfaces/negotiation-events.interface.js";
import type { AgentDispatcher, NegotiationTurnPayload } from "../shared/interfaces/agent-dispatcher.interface.js";
import { NegotiationGraphState, type NegotiationTurn, type NegotiationOutcome, type UserNegotiationContext, type NegotiationGraphLike } from "./negotiation.state.js";
import { IndexNegotiator } from "./negotiation.agent.js";
import { allowedActionsFor, ASK_USER_WINDOW_MS, fallbackActionFor, isRejectLikeAction, isTerminalAction, readProtocolVersion, rejectActionFor } from "./negotiation.protocol.js";
import { assessConsultationEligibility, consultationPromptFor, type NegotiationConsultationReason } from "./negotiation.consultation-policy.js";
import { assessDeadlock, type DeadlockAssessment, type DeadlockShiftRecord } from "./negotiation.deadlock.js";
import type { NegotiationSeat, NegotiationProtocolVersion } from "../shared/schemas/negotiation-state.schema.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { AnswerhoodSchema, type Answerhood } from "../shared/schemas/negotiation-checklist.schema.js";
import type { QuestionerEnqueueFn } from "../questions/question.module.js";
import type { ReflectEnqueueFn } from "./negotiation.reflect.js";
import type { NegotiatorMemoryEntry, NegotiatorMemoryRetrieveFn, NegotiatorMemoryScope } from "./negotiation.memory.js";
import type { NegotiatorClientDmMessage, NegotiatorClientDmRetrieveFn } from "./negotiation.client-dm.js";
import type { NegotiationStallGapAuthor } from "./negotiation.stall-gap.js";
import { NEGOTIATION_QUESTION_GENERIC_COUNTERPARTY, NEGOTIATION_QUESTION_GENERIC_NETWORK, negotiationQuestionSettlementId } from './negotiation.question-safety.js';
import { buildIntentSnapshots } from "./negotiation.intent-snapshot-provenance.js";
import { holdsNegotiationConversationLock } from "./negotiation.task-lock-policy.js";
import { isNegotiationTurnCapReached } from "./negotiation.turn-cap.js";
import { expectedNegotiationSpeaker } from "./negotiation.expected-speaker.js";
import { attributedDialogueIsEmpty, buildSeededAttribution, combineAttributedDialogue, type AttributedPriorDialogue, type TaskAttribution } from './negotiation.attribution.js';

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
  /**
   * A2H read path: the acting user's own negotiator DM for this signal.
   * System-agent grounding only — see `negotiation.client-dm.ts`; this must
   * never be forwarded to an external seat via `NegotiationTurnPayload`.
   */
  clientDmRetrieve?: NegotiatorClientDmRetrieveFn;
  /** In-process negotiator used when no personal agent answers. */
  systemAgent: IndexNegotiator;
  /** Authors the post-stall gap question at finalize (park-on-stall). */
  stallGapAuthor?: NegotiationStallGapAuthor;
}

export const logger = protocolLogger("NegotiationGraph");
export const initLog = protocolLogger("NegotiationGraph:Init");
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

/** Sender ids of every persisted `ask_user` park in this negotiation's messages. */
function askUserSenderIds(messages: Array<{ senderId: string; parts: unknown[] }>): string[] {
  return messages
    .filter((m) => {
      const dataPart = (m.parts as Array<{ kind?: string; data?: { action?: string } }>).find((p) => p.kind === "data");
      return dataPart?.data?.action === "ask_user";
    })
    .map((m) => m.senderId);
}

/**
 * Whether `userId`'s side has already spent its one `ask_user` client
 * consultation in THIS negotiation (P3.2 rationing: max one per negotiation per
 * side). Callers pass `state.messages`, which carries this negotiation's turns
 * across all of its sessions — so an earlier session of the same negotiation
 * counts, while a consultation spent on a different match with the same
 * counterparty does not.
 */
export function hasPriorAskUser(
  messages: Array<{ senderId: string; parts: unknown[] }>,
  userId: string,
): boolean {
  return askUserSenderIds(messages).includes(`agent:${userId}`);
}

/**
 * How many questions THIS principal has already been asked in this
 * negotiation — the checklist protocol's per-principal question budget
 * (`QUESTION_BUDGET_PER_PRINCIPAL`, plan §3 rule 5).
 *
 * Same substrate as {@link hasPriorAskUser}, counted rather than tested: every
 * park that suspends this negotiation on this client's answer is one draw on
 * their budget, whatever produced it — the turn-0 pre-contact consult, a
 * mid-flight consult, or a post-stall park. That is the point of a budget
 * rather than a per-flavour ration: what it bounds is how much of one person's
 * attention one negotiation may spend, and the flavour of the park is not
 * something the person experiences.
 */
export function countPrincipalAskUserTurns(
  messages: Array<{ senderId: string; parts: unknown[] }>,
  userId: string,
): number {
  return askUserSenderIds(messages).filter((senderId) => senderId === `agent:${userId}`).length;
}

/**
 * The topics this principal has already been asked about in this negotiation,
 * oldest first: the checklist dimension each ask named, and the answerhood it
 * declared for that dimension.
 *
 * Read off the persisted asks themselves, so both things they carry survive a
 * park, a resume and a fresh process with nothing to keep in step:
 *
 *  - "a topic is asked once" needs the dimensions, and
 *  - scoring an answer against the map the ask DECLARED — rather than
 *    re-interpreting the answer freely on the resumed turn — needs the map,
 *    which the rendered turn history does not carry (it renders action,
 *    reasoning and message only).
 *
 * Asks from before the checklist protocol, and policy-inferred consultations,
 * name no dimension and contribute nothing: they spent budget, but they closed
 * no topic and declared no answerhood.
 */
export function askedChecklistTopics(
  messages: Array<{ senderId: string; parts: unknown[] }>,
  userId: string,
): Array<{ dimension: string; answerhood?: Answerhood }> {
  return messages
    .filter((message) => message.senderId === `agent:${userId}`)
    .flatMap((message) => {
      const dataPart = (message.parts as Array<{ kind?: string; data?: { action?: string; askUser?: { dimension?: unknown; answerhood?: unknown } } }>)
        .find((part) => part.kind === "data");
      const data = dataPart?.data;
      if (data?.action !== "ask_user") return [];
      const dimension = data.askUser?.dimension;
      if (typeof dimension !== "string" || dimension.trim().length === 0) return [];
      const answerhood = AnswerhoodSchema.safeParse(data.askUser?.answerhood);
      return [{
        dimension: dimension.trim(),
        ...(answerhood.success ? { answerhood: answerhood.data } : {}),
      }];
    });
}

/**
 * Whether the conclusion floor has already fired an ask on THIS principal's
 * behalf in this negotiation.
 *
 * The floor's guarantee is bounded at one per negotiation per principal, so
 * that a seat whose agent keeps drafting around its own open dimensions parks
 * its client once rather than at every turn. The bound is read back off the
 * persisted ask itself — same substrate as the budget and the asked topics —
 * because a park, its resume and a fresh process must all agree about it with
 * nothing to keep in step.
 *
 * Per-seat, not negotiation-wide: the other principal's guarantee is their own
 * to spend, exactly as their budget is.
 */
export function hasGuaranteedAsk(
  messages: Array<{ senderId: string; parts: unknown[] }>,
  userId: string,
): boolean {
  return messages
    .filter((message) => message.senderId === `agent:${userId}`)
    .some((message) => {
      const dataPart = (message.parts as Array<{ kind?: string; data?: { action?: string; askUser?: { guaranteed?: unknown } } }>)
        .find((part) => part.kind === "data");
      const data = dataPart?.data;
      return data?.action === "ask_user" && data.askUser?.guaranteed === true;
    });
}

/**
 * How many ask rounds this negotiation has already spent, BOTH sides combined.
 * A round is one persisted `ask_user` park — a mid-flight client consultation
 * or a post-stall park — each of which suspends the negotiation on a human
 * answer. Same substrate as {@link hasPriorAskUser} (the negotiation's own
 * message record, spanning all of its sessions), read negotiation-wide rather
 * than per side: the cap this feeds bounds the park → answer → resume loop for
 * the negotiation as a whole, so two agents cannot ping-pong their humans
 * indefinitely.
 */
export function countNegotiationAskRounds(
  messages: Array<{ senderId: string; parts: unknown[] }>,
): number {
  return askUserSenderIds(messages).length;
}

/**
 * P5.3 memory retrieval — never throws, never blocks a negotiation. The
 * injected fn resolves [] on its own failures; this wrapper adds the
 * graph-side guard.
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

/**
 * A2H client-DM retrieval — never throws, never blocks a negotiation. The
 * injected fn already resolves [] when the flag is off or the user has no
 * negotiator DM for this signal; this wrapper adds the graph-side failure
 * guard, exactly as `retrieveMemory` does for the memory seam.
 *
 * `userId` is always the ACTING user's — the seam has no counterparty field,
 * so the counterparty's DM cannot be requested from here.
 */
export async function retrieveClientDm(
  deps: NegotiationGraphDeps,
  userId: string,
  intentId: string,
): Promise<NegotiatorClientDmMessage[]> {
  if (!deps.clientDmRetrieve) return [];
  try {
    return await deps.clientDmRetrieve({ userId, intentId });
  } catch (err) {
    logger.warn("Negotiator client DM retrieval failed; proceeding without it", {
      userId,
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
 * IND-569: build the attributed prior dialogue passed to turn prompts. Combines the immutable seeded attribution (earlier + legacy
 * unattributed blocks, resolved once in init) with this session's own turns
 * (task-id-matched). Null when there is no seeded attribution.
 */
export function buildAttributedDialogue(
  state: NegotiationState,
): AttributedPriorDialogue | null {
  // Not gated on `isContinuation`: that now means "this negotiation has spoken",
  // and the pair's earlier matches are context worth carrying into a fresh one.
  if (!state.priorAttribution) return null;
  const currentSessionTurns = turnsFromMessages(
    state.messages.filter((m) => (m as { taskId?: string | null }).taskId === state.taskId),
  );
  const dialogue = combineAttributedDialogue(state.priorAttribution as import('./negotiation.attribution.js').SeededAttribution, currentSessionTurns);
  return attributedDialogueIsEmpty(dialogue) ? null : dialogue;
}
