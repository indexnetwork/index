/**
 * QuestionerAdapter — the negotiation-settlement core that survived the card
 * question retirement (docs/plans/2026-08-18-conversational-questions.md,
 * "Retirements").
 *
 * The QuestionerAgent's generation/read/answer surface is gone. What remains
 * is load-bearing for the conversational loop:
 * - the exact-task park/resume settlement machinery: authoritative admission
 *   re-resolution, the advisory → cohort → settlement-row lock ladder, the
 *   ask_user answer-window expiry, the DM answer settle
 *   (`settleInflightNegotiationAnswerFromDm`, #1435), and the fenced
 *   continuation-execution claims;
 * - `recordOpportunityUserAnswer` (the deduped metadata.userAnswers append);
 * - `getAnsweredNegotiationQuestionsForOpportunity` (Lens C evidence reads
 *   over answered history);
 * - `voidLeftoverQuestion` (transition-window void-on-contact for leftover
 *   card rows).
 *
 * TODO(questions-table drop): the `questions` table itself outlives this
 * surface only for leftover rows. Drop it in a dedicated migration once its
 * remaining readers are retired or repointed: `voidLeftoverQuestion` and the
 * settlement paths' leftover-row dismissals here, the Lens C answered-history
 * read above, and the activity-summary pending counts in
 * chat.database.adapter (`pendingQuestionsByMode`).
 *
 * Per adapter layering rules the local types are defined here; structural
 * alignment with protocol interfaces is verified by the compile-time
 * alignment spec.
 */

import { eq, and, sql, or, isNull, desc } from 'drizzle-orm/sql';

import { intentNetworks, intents, networkMembers, networks, questions, opportunities } from '../schemas/database.schema';
import { tasks } from '../schemas/conversation.schema';
import { log } from '../lib/log';
import type { DrizzleDB } from '../lib/drizzle/drizzle';
import { computeIntentFingerprint } from '../lib/intent/intent.fingerprint';
import { isValidNegotiationDetectionContract } from '../lib/question/negotiation-question.contract';
import { consultationExpiryReadiness } from '../lib/negotiation/consultation-expiry';
import { RESUMABLE_OPPORTUNITY_STATUSES, claimContinuationExecution, completeContinuationExecution, heartbeatContinuationExecution, parkContinuationExecution, releaseContinuationExecution } from './negotiation-continuation.atomic';
import type { ContinuationClaimResult, ContinuationExecutionFence, ContinuationReceipt } from './negotiation-continuation.atomic';


const settleLogger = log.lib.from('questioner-adapter');

class InflightConsultationPausePendingError extends Error {
  constructor() {
    super('External consultation pause has not committed');
    this.name = 'InflightConsultationPausePendingError';
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// ─── Local adapter types (structurally aligned with protocol contracts) ───────

/** Structural mirror of the protocol's `NegotiationCounterpartyBinding` (adapters may not import the protocol package). */
type NegotiationCounterpartyBinding =
  | { kind: 'intent'; id: string }
  | { kind: 'premise'; id: string };

/** Union of all question modes the adapter stores. */
export type AdapterQuestionMode = 'intent' | 'negotiation' | 'negotiation_inflight' | 'chat' | 'pool_discovery';

/** Detection context describing how/where a question was generated. */
export type AdapterNegotiationQuestionPurpose = 'uptake' | 'stalled_followup' | 'inflight_consultation';

export interface AdapterNegotiationQuestionCandidate {
  purpose: AdapterNegotiationQuestionPurpose;
  recipientUserId: string;
  recipientIntentId: string;
  opportunityId: string;
  taskId?: string;
  networkId: string;
  /** Uptake only: exact counterparty whose low-authority state triggered the advisory. */
  counterpartyUserId?: string;
  counterpartyIntentId?: string;
  counterpartyFelicityAuthority?: number;
}

export interface AdapterNegotiationQuestionProvenance extends AdapterNegotiationQuestionCandidate {
  version: 1;
  intentFingerprint: string;
  opportunityStatus: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired';
  opportunityUpdatedAt: string;
  taskState?: 'submitted' | 'working' | 'input_required' | 'completed' | 'failed' | 'canceled' | 'rejected' | 'auth_required' | 'waiting_for_agent' | 'claimed';
  taskUpdatedAt?: string;
  questionOrdinal: number;
}

export interface AdapterNegotiationContinuationKey {
  taskId: string;
  settlementId: string;
  opportunityId: string;
  userId: string;
  recipientIntentId: string;
  networkId: string;
}

export interface AdapterNegotiationContinuationCoordinates extends AdapterNegotiationContinuationKey {
  /** Server-only external consultation generation; absent for in-process graph pauses. */
  consultationAttemptId?: string;
  /** Exact external claim that was allowed to commit this attempt. */
  claimedByAgentId?: string;
  intentFingerprint: string;
  opportunityStatus: string;
  opportunityUpdatedAt: string;
  counterpartyUserId: string;
  /** Intent- or premise-bound counterparty identity, verified at resume. */
  counterpartyBinding: NegotiationCounterpartyBinding;
}

interface AdapterNegotiationQuestionSettlement {
  version: 1;
  settlementId: string;
  taskId: string;
  consultationAttemptId?: string;
  recipientUserId: string;
  recipientIntentId: string;
  opportunityId: string;
  networkId: string;
  intentFingerprint: string;
  opportunityStatus: string;
  opportunityUpdatedAt: string;
  counterpartyUserId: string;
  /**
   * Intent- or premise-bound counterparty identity. Settlements written before
   * the binding existed carry a flat `counterpartyIntentId`; the parser below
   * normalizes those so a park already in flight resumes across the deploy.
   */
  counterpartyBinding: NegotiationCounterpartyBinding;
  kind: 'answer' | 'dismiss' | 'timeout';
  questionId?: string;
  /**
   * Row-less DM-path settlement only: the client's answer stored inline so the
   * continuation claim can read its private consultation without a QUESTIONS
   * row. Card-path settlements keep the answer on the question row instead.
   */
  answer?: { selectedOptions: string[]; freeText?: string; answeredAt: string };
  /**
   * 'unresumable' is a terminal record: the answer was heard on a park whose
   * negotiation cannot continue (terminal opportunity / archived signal). No
   * continuation was requested and none may ever claim it.
   */
  continuationStatus: 'requested' | 'completed' | 'unresumable';
  settledAt: string;
  completedAt?: string;
}

export interface AdapterQuestionDetection {
  mode: AdapterQuestionMode;
  /** Internal generation purpose, orthogonal to mode and QUD metadata. */
  purpose?: import('@indexnetwork/protocol').QuestionPurpose;
  /** Exact negotiation recipient/intent/task routing provenance. */
  negotiation?: AdapterNegotiationQuestionProvenance;
  sourceType: string;
  sourceId: string;
  triggeredBy?: string;
  timestamp: string;
  /** Generation strategy persisted as internal metadata. */
  strategy?: import('@indexnetwork/protocol').QuestionStrategy;
  /** QUD repair category persisted as internal metadata. */
  underspecificationType?: import('@indexnetwork/protocol').UnderspecificationType | null;
  /** ID of the assistant message that triggered this question. */
  messageId?: string;
  /** Durable server-only session binding used to validate messageId. */
  sessionId?: string;
  /**
   * pool_discovery only: mined pool snapshot (assignments + chain alternates).
   * INTERNAL — the service/controller read paths strip this before any
   * payload leaves the server.
   */
  pool?: import('@indexnetwork/protocol').QuestionPoolSnapshot;
  /** Post-discovery intent recovery snapshot. Never exposed publicly. */
  recovery?: import('@indexnetwork/protocol').QuestionRecoverySnapshot;
  /** Durable request marker written before Redis enqueue. Never exposed publicly. */
  pushRequestedAt?: string;
  /** Last bounded recovery sweep that selected this request. Never exposed publicly. */
  pushRecoveryAttemptedAt?: string;
  /** Durable request outcome. Never exposed publicly. */
  pushRequestStatus?: import('@indexnetwork/protocol').QuestionPoolPushRequestStatus;
  /** Permanent suppression reason for an unclaimed request. Never exposed publicly. */
  pushRequestReason?: import('@indexnetwork/protocol').QuestionPoolPushRequestReason;
  /** Timestamp at which an unclaimed request was suppressed. Never exposed publicly. */
  pushRequestSuppressedAt?: string;
  /** Internal proactive push state. Never exposed publicly. */
  push?: import('@indexnetwork/protocol').QuestionPoolPush;
  /** Internal reason this row was lifecycle-voided. */
  voidedReason?: import('@indexnetwork/protocol').QuestionVoidedReason;
  /** Authoritative successful-delivery ledger timestamp. */
  pushedAt?: string;
}

/** An actor targeted by a question (typically the user who should answer). */
export interface AdapterQuestionActor {
  userId: string;
  networkId?: string;
  role: 'subject';
}

/** The user-facing question payload (title, prompt, options). */
export interface AdapterQuestionPayload {
  title: string;
  prompt: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
  /** Optional provenance chip line (e.g. "based on 18 people matching this intent"). */
  evidence?: string;
}

/** Answer recorded when a user responds to a question. */
export interface AdapterQuestionAnswer {
  selectedOptions: string[];
  freeText?: string;
  answeredBy: string;
  answeredAt: string;
}

/** Input shape for persisting a new question (no DB id or status yet). */
export interface AdapterPersistableQuestion {
  detection: AdapterQuestionDetection;
  actors: AdapterQuestionActor[];
  payload: AdapterQuestionPayload;
  strategy: import('@indexnetwork/protocol').QuestionStrategy;
  /** Internal QUD repair category; null when no underspecification is repaired. */
  underspecificationType?: import('@indexnetwork/protocol').UnderspecificationType | null;
  /** Conversation ID — set when the question originates from a chat session. */
  conversationId?: string;
}

/** A question row returned from the database. */
export interface AdapterPersistedQuestion {
  id: string;
  detection: AdapterQuestionDetection;
  actors: AdapterQuestionActor[];
  payload: AdapterQuestionPayload;
  status: 'pending' | 'answered' | 'dismissed';
  answer: AdapterQuestionAnswer | null;
  expiresAt: string | null;
  createdAt: string;
  conversationId: string | null;
}

export interface AnsweredNegotiationOwnerAnswer {
  questionId: string;
  answeredBy: string;
  answeredAt: string;
  selectedOptions: string[];
  freeText?: string;
  /** Capture-time intent fingerprint, when the detection recorded one. */
  intentFingerprint?: string;
}

export function isNegotiationQuestionMode(mode: AdapterQuestionMode): boolean {
  return mode === 'negotiation' || mode === 'negotiation_inflight';
}

/** Runtime validation mirrored from the protocol schema for DB-originated JSON. */
export function parseAdapterNegotiationProvenance(value: unknown): AdapterNegotiationQuestionProvenance | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const purpose = candidate.purpose;
  const taskBacked = purpose === 'stalled_followup' || purpose === 'inflight_consultation';
  if (
    candidate.version !== 1
    || (purpose !== 'uptake' && !taskBacked)
    || !isNonEmptyString(candidate.recipientUserId)
    || !isNonEmptyString(candidate.recipientIntentId)
    || !isNonEmptyString(candidate.opportunityId)
    || !isNonEmptyString(candidate.networkId)
    || !isNonEmptyString(candidate.intentFingerprint)
    || !isNonEmptyString(candidate.opportunityStatus)
    || !isNonEmptyString(candidate.opportunityUpdatedAt)
    || !Number.isInteger(candidate.questionOrdinal)
    || Number(candidate.questionOrdinal) < 0
    || Number(candidate.questionOrdinal) > 2
  ) return null;
  if (taskBacked && (
    !isNonEmptyString(candidate.taskId)
    || !isNonEmptyString(candidate.taskState)
    || !isNonEmptyString(candidate.taskUpdatedAt)
  )) return null;
  if (!taskBacked && (candidate.taskId !== undefined || candidate.taskState !== undefined || candidate.taskUpdatedAt !== undefined)) return null;
  if (purpose === 'stalled_followup' && candidate.taskState !== 'completed') return null;
  if (purpose === 'inflight_consultation' && candidate.taskState !== 'input_required') return null;
  if (Number.isNaN(Date.parse(String(candidate.opportunityUpdatedAt)))) return null;
  if (candidate.taskUpdatedAt !== undefined && Number.isNaN(Date.parse(String(candidate.taskUpdatedAt)))) return null;
  return candidate as unknown as AdapterNegotiationQuestionProvenance;
}

function settlementIdForTask(taskId: string): string {
  return `negotiation-question-settlement-v1-${taskId}`;
}

function parseAskUserBinding(value: unknown): {
  version: 2;
  settlementId: string;
  consultationAttemptId?: string;
  recipientUserId: string;
  recipientIntentId: string;
  opportunityId: string;
  networkId: string;
  intentFingerprint: string;
  opportunityStatus: string;
  opportunityUpdatedAt: string;
  counterpartyUserId: string;
  counterpartyBinding: NegotiationCounterpartyBinding;
} | null {
  if (!value || typeof value !== 'object') return null;
  const binding = value as Record<string, unknown>;
  if (
    binding.version !== 2
    || !isNonEmptyString(binding.settlementId)
    || (binding.consultationAttemptId !== undefined && !isNonEmptyString(binding.consultationAttemptId))
    || !isNonEmptyString(binding.recipientUserId)
    || !isNonEmptyString(binding.recipientIntentId)
    || !isNonEmptyString(binding.opportunityId)
    || !isNonEmptyString(binding.networkId)
    || !isNonEmptyString(binding.intentFingerprint)
    || !isNonEmptyString(binding.opportunityStatus)
    || !isNonEmptyString(binding.opportunityUpdatedAt)
    || Number.isNaN(Date.parse(binding.opportunityUpdatedAt))
    || !isNonEmptyString(binding.counterpartyUserId)
    || parseSettlementCounterpartyBinding(binding) === null
  ) return null;
  // Bindings captured before the polymorphic shape carry a flat
  // `counterpartyIntentId`; normalizing here means a park written by the
  // previous build still settles and resumes after the deploy.
  return {
    ...binding,
    counterpartyBinding: parseSettlementCounterpartyBinding(binding),
  } as ReturnType<typeof parseAskUserBinding>;
}

function parseInlineSettlementAnswer(value: unknown): { selectedOptions: string[]; freeText?: string; answeredAt: string } | null {
  if (!value || typeof value !== 'object') return null;
  const answer = value as Record<string, unknown>;
  if (
    !Array.isArray(answer.selectedOptions)
    || !answer.selectedOptions.every((option) => typeof option === 'string')
    || (answer.freeText !== undefined && typeof answer.freeText !== 'string')
    || !isNonEmptyString(answer.answeredAt)
    || Number.isNaN(Date.parse(answer.answeredAt))
  ) return null;
  return answer as { selectedOptions: string[]; freeText?: string; answeredAt: string };
}

function parseNegotiationQuestionSettlement(value: unknown): AdapterNegotiationQuestionSettlement | null {
  if (!value || typeof value !== 'object') return null;
  const settlement = value as Record<string, unknown>;
  if (
    settlement.version !== 1
    || !isNonEmptyString(settlement.settlementId)
    || !isNonEmptyString(settlement.taskId)
    || settlement.settlementId !== settlementIdForTask(settlement.taskId)
    || (settlement.consultationAttemptId !== undefined && !isNonEmptyString(settlement.consultationAttemptId))
    || !isNonEmptyString(settlement.recipientUserId)
    || !isNonEmptyString(settlement.recipientIntentId)
    || !isNonEmptyString(settlement.opportunityId)
    || !isNonEmptyString(settlement.networkId)
    || !isNonEmptyString(settlement.intentFingerprint)
    || !isNonEmptyString(settlement.opportunityStatus)
    || !isNonEmptyString(settlement.opportunityUpdatedAt)
    || Number.isNaN(Date.parse(settlement.opportunityUpdatedAt))
    || !isNonEmptyString(settlement.counterpartyUserId)
    || parseSettlementCounterpartyBinding(settlement) === null
    || (settlement.kind !== 'answer' && settlement.kind !== 'dismiss' && settlement.kind !== 'timeout')
    || (settlement.continuationStatus !== 'requested' && settlement.continuationStatus !== 'completed' && settlement.continuationStatus !== 'unresumable')
    || !isNonEmptyString(settlement.settledAt)
    || Number.isNaN(Date.parse(settlement.settledAt))
    || (settlement.questionId !== undefined && !isNonEmptyString(settlement.questionId))
    || (settlement.answer !== undefined && parseInlineSettlementAnswer(settlement.answer) === null)
    // An answer settlement carries its content either on a question row
    // (card path, questionId) or inline (row-less DM path) — never neither.
    || (settlement.kind === 'answer' && !isNonEmptyString(settlement.questionId) && settlement.answer === undefined)
  ) return null;
  return {
    ...settlement,
    counterpartyBinding: parseSettlementCounterpartyBinding(settlement),
  } as unknown as AdapterNegotiationQuestionSettlement;
}

/**
 * The counterparty binding a stored settlement carries: the discriminated
 * `counterpartyBinding` written today, or the legacy flat `counterpartyIntentId`
 * (always intent-bound by definition). Null when it carries neither, which the
 * caller treats as an unparseable settlement rather than guessing at the pair.
 */
function parseSettlementCounterpartyBinding(
  settlement: Record<string, unknown>,
): NegotiationCounterpartyBinding | null {
  const binding = settlement.counterpartyBinding;
  if (
    binding && typeof binding === 'object' && !Array.isArray(binding)
    && ((binding as Record<string, unknown>).kind === 'intent' || (binding as Record<string, unknown>).kind === 'premise')
    && isNonEmptyString((binding as Record<string, unknown>).id)
  ) {
    const value = binding as { kind: 'intent' | 'premise'; id: string };
    return { kind: value.kind, id: value.id };
  }
  return isNonEmptyString(settlement.counterpartyIntentId)
    ? { kind: 'intent', id: settlement.counterpartyIntentId as string }
    : null;
}

export class QuestionerAdapter {
  constructor(private readonly db: DrizzleDB) {}

  private async resolveNegotiationAdmission(
    candidate: AdapterNegotiationQuestionCandidate,
    database: DrizzleDB,
    expected?: AdapterNegotiationQuestionProvenance,
    settled?: 'answered',
  ): Promise<Omit<AdapterNegotiationQuestionProvenance, 'questionOrdinal'> | null> {
    const taskBacked = candidate.purpose !== 'uptake';
    if (
      !isNonEmptyString(candidate.recipientUserId)
      || !isNonEmptyString(candidate.recipientIntentId)
      || !isNonEmptyString(candidate.opportunityId)
      || !isNonEmptyString(candidate.networkId)
      || (taskBacked !== isNonEmptyString(candidate.taskId))
      || (candidate.purpose === 'uptake' && (!isNonEmptyString(candidate.counterpartyUserId) || !isNonEmptyString(candidate.counterpartyIntentId) || !Number.isFinite(candidate.counterpartyFelicityAuthority)))
      || (candidate.purpose !== 'uptake' && (candidate.counterpartyUserId !== undefined || candidate.counterpartyIntentId !== undefined || candidate.counterpartyFelicityAuthority !== undefined))
    ) return null;

    const expectedOpportunityStatus = candidate.purpose === 'uptake'
      ? 'pending'
      : candidate.purpose === 'stalled_followup'
        ? 'stalled'
        : 'negotiating';
    const rows = await database.select({
      payload: intents.payload,
      summary: intents.summary,
      opportunityStatus: opportunities.status,
      opportunityUpdatedAt: opportunities.updatedAt,
    })
      .from(intents)
      .innerJoin(intentNetworks, and(
        eq(intentNetworks.intentId, intents.id),
        eq(intentNetworks.networkId, candidate.networkId),
      ))
      .innerJoin(networkMembers, and(
        eq(networkMembers.userId, candidate.recipientUserId),
        eq(networkMembers.networkId, candidate.networkId),
        isNull(networkMembers.deletedAt),
      ))
      .innerJoin(networks, and(
        eq(networks.id, candidate.networkId),
        eq(networks.isPersonal, false),
        isNull(networks.deletedAt),
      ))
      .innerJoin(opportunities, eq(opportunities.id, candidate.opportunityId))
      .where(and(
        eq(intents.id, candidate.recipientIntentId),
        eq(intents.userId, candidate.recipientUserId),
        isNull(intents.archivedAt),
        or(isNull(intents.status), eq(intents.status, 'ACTIVE')),
        eq(opportunities.status, expectedOpportunityStatus),
        sql`(
          SELECT count(*)
          FROM jsonb_array_elements(${opportunities.actors}) recipient_actor
          WHERE recipient_actor->>'userId' = ${candidate.recipientUserId}
            AND COALESCE(recipient_actor->>'role', '') <> 'introducer'
        ) = 1`,
        sql`EXISTS (
          SELECT 1
          FROM jsonb_array_elements(${opportunities.actors}) exact_actor
          WHERE exact_actor->>'userId' = ${candidate.recipientUserId}
            AND exact_actor->>'intent' = ${candidate.recipientIntentId}
            AND exact_actor->>'networkId' = ${candidate.networkId}
            AND COALESCE(exact_actor->>'role', '') <> 'introducer'
        )`,
        sql`(
          SELECT count(DISTINCT participant_actor->>'userId')
          FROM jsonb_array_elements(${opportunities.actors}) participant_actor
          WHERE participant_actor->>'networkId' = ${candidate.networkId}
            AND COALESCE(participant_actor->>'role', '') <> 'introducer'
        ) = 2`,
        sql`NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements(${opportunities.actors}) foreign_network_actor
          WHERE COALESCE(foreign_network_actor->>'role', '') <> 'introducer'
            AND foreign_network_actor->>'networkId' IS DISTINCT FROM ${candidate.networkId}
        )`,
        sql`EXISTS (
          SELECT 1
          FROM jsonb_array_elements(${opportunities.actors}) other_actor
          JOIN network_members visible_member
            ON visible_member.user_id = other_actor->>'userId'
           AND visible_member.network_id = ${candidate.networkId}
           AND visible_member.deleted_at IS NULL
          WHERE other_actor->>'userId' <> ${candidate.recipientUserId}
            AND other_actor->>'networkId' = ${candidate.networkId}
            AND COALESCE(other_actor->>'role', '') <> 'introducer'
        )`,
      ))
      .limit(2);
    if (rows.length !== 1) return null;
    const row = rows[0];
    const intentFingerprint = computeIntentFingerprint(row.payload, row.summary);
    const opportunityUpdatedAt = row.opportunityUpdatedAt.toISOString();
    if (
      expected
      && (expected.intentFingerprint !== intentFingerprint
        || expected.opportunityStatus !== row.opportunityStatus
        || expected.opportunityUpdatedAt !== opportunityUpdatedAt
        || expected.counterpartyUserId !== candidate.counterpartyUserId
        || expected.counterpartyIntentId !== candidate.counterpartyIntentId
        || expected.counterpartyFelicityAuthority !== candidate.counterpartyFelicityAuthority)
    ) return null;

    let taskState: AdapterNegotiationQuestionProvenance['taskState'];
    let taskUpdatedAt: string | undefined;
    if (taskBacked) {
      const expectedTaskState = candidate.purpose === 'stalled_followup'
        ? 'completed'
        : settled === 'answered'
          ? 'canceled'
          : 'input_required';
      const taskRows = await database.select({ state: tasks.state, updatedAt: tasks.updatedAt })
        .from(tasks)
        .where(and(
          eq(tasks.id, candidate.taskId!),
          eq(tasks.state, expectedTaskState),
          sql`${tasks.metadata}->>'type' = 'negotiation'`,
          sql`${tasks.metadata}->>'opportunityId' = ${candidate.opportunityId}`,
          sql`${tasks.metadata}->>'networkId' = ${candidate.networkId}`,
          sql`${tasks.metadata}->'participantBindings' @> ${JSON.stringify([{
            userId: candidate.recipientUserId,
            intentId: candidate.recipientIntentId,
            networkId: candidate.networkId,
          }])}::jsonb`,
          ...(candidate.purpose === 'stalled_followup'
            ? [
                sql`${tasks.metadata}->>'sourceUserId' = ${candidate.recipientUserId}`,
                sql`${tasks.metadata}->>'sourceIntentId' = ${candidate.recipientIntentId}`,
              ]
            : [sql`${tasks.metadata}->'turnContext'->'askUserBinding' @> ${JSON.stringify({
                recipientUserId: candidate.recipientUserId,
                recipientIntentId: candidate.recipientIntentId,
                opportunityId: candidate.opportunityId,
                networkId: candidate.networkId,
              })}::jsonb`]),
          ...(settled === 'answered'
            ? [sql`${tasks.statusMessage}->>'reason' = 'ask_user_answered'`]
            : []),
        ))
        .limit(2);
      if (taskRows.length !== 1) return null;
      taskState = taskRows[0].state;
      taskUpdatedAt = taskRows[0].updatedAt.toISOString();
      if (expected && !settled && (expected.taskState !== taskState || expected.taskUpdatedAt !== taskUpdatedAt)) return null;
    }

    return {
      version: 1,
      ...candidate,
      intentFingerprint,
      opportunityStatus: row.opportunityStatus,
      opportunityUpdatedAt,
      ...(taskState ? { taskState } : {}),
      ...(taskUpdatedAt ? { taskUpdatedAt } : {}),
    };
  }

  async getAnsweredNegotiationQuestionsForOpportunity(
    recipientUserId: string,
    opportunityId: string,
    currentIntentFingerprint: string,
  ): Promise<AnsweredNegotiationOwnerAnswer[]> {
    const rows = await this.db
      .select({
        id: questions.id,
        detection: questions.detection,
        actors: questions.actors,
        answer: questions.answer,
      })
      .from(questions)
      .where(and(
        eq(questions.status, 'answered'),
        sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId: recipientUserId, role: 'subject' }])}::jsonb`,
        or(
          sql`${questions.detection}->>'mode' = 'negotiation'`,
          sql`${questions.detection}->>'mode' = 'negotiation_inflight'`,
        ),
        sql`${questions.detection}->>'sourceType' = 'opportunity'`,
        sql`${questions.detection}->>'sourceId' = ${opportunityId}`,
        sql`${questions.answer}->>'answeredBy' = ${recipientUserId}`,
        sql`${questions.detection}->'negotiation'->>'version' = '1'`,
        sql`${questions.detection}->'negotiation'->>'recipientUserId' = ${recipientUserId}`,
        sql`${questions.detection}->'negotiation'->>'opportunityId' = ${opportunityId}`,
        sql`${questions.detection}->'negotiation'->>'intentFingerprint' = ${currentIntentFingerprint}`,
      ))
      .orderBy(desc(questions.createdAt));

    return rows.flatMap((row) => {
      const detection = row.detection as AdapterQuestionDetection;
      const answer = row.answer as AdapterQuestionAnswer | null;
      const actorOwned = (row.actors as AdapterQuestionActor[]).some(
        (actor) => actor.userId === recipientUserId && actor.role === 'subject',
      );
      if (!actorOwned
        || !answer
        || answer.answeredBy !== recipientUserId
        || (detection.mode !== 'negotiation' && detection.mode !== 'negotiation_inflight')
        || detection.sourceType !== 'opportunity'
        || detection.sourceId !== opportunityId) {
        return [];
      }
      const provenance = parseAdapterNegotiationProvenance(detection.negotiation);
      const capturedIntentFingerprint = provenance?.intentFingerprint;
      if (
        !provenance
        || !isValidNegotiationDetectionContract(detection, provenance)
        || provenance.recipientUserId !== recipientUserId
        || provenance.opportunityId !== opportunityId
        || capturedIntentFingerprint !== currentIntentFingerprint
      ) return [];
      if (!Array.isArray(answer.selectedOptions)
        || !answer.selectedOptions.every((option) => typeof option === 'string')) {
        return [];
      }
      const freeText = typeof answer.freeText === 'string' && answer.freeText.trim().length > 0
        ? answer.freeText
        : undefined;
      if (answer.selectedOptions.length === 0 && freeText === undefined) return [];
      return [{
        questionId: row.id,
        answeredBy: answer.answeredBy,
        answeredAt: answer.answeredAt,
        selectedOptions: answer.selectedOptions,
        ...(freeText !== undefined ? { freeText } : {}),
        ...(typeof capturedIntentFingerprint === 'string' ? { capturedIntentFingerprint } : {}),
      }];
    });
  }

  async voidLeftoverQuestion(
    questionId: string,
    userId: string,
  ): Promise<'voided' | 'settled' | 'not_found'> {
    const [updated] = await this.db.update(questions)
      .set({
        status: 'dismissed',
        detection: sql`jsonb_set(${questions.detection}, '{voidedReason}', '"retired_mode"'::jsonb, true)`,
      })
      .where(and(
        eq(questions.id, questionId),
        eq(questions.status, 'pending'),
        sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId }])}::jsonb`,
      ))
      .returning({ id: questions.id });
    if (updated) return 'voided';

    const [existing] = await this.db.select({ id: questions.id }).from(questions)
      .where(and(
        eq(questions.id, questionId),
        sql`${questions.actors}::jsonb @> ${JSON.stringify([{ userId }])}::jsonb`,
      ))
      .limit(1);
    return existing ? 'settled' : 'not_found';
  }

  /** Serialize generation and every settlement path for one exact cohort. */
  private async lockNegotiationQuestionAdvisory(
    database: DrizzleDB,
    provenance: AdapterNegotiationQuestionCandidate,
  ): Promise<void> {
    await database.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${[
      'negotiation-question', provenance.recipientUserId, provenance.recipientIntentId,
      provenance.opportunityId, provenance.taskId ?? '', provenance.purpose,
    ].join(':')}, 0))`);
  }

  /** Lock the complete exact cohort in stable ID order before provenance rows. */
  private async lockNegotiationQuestionCohort(
    database: DrizzleDB,
    provenance: AdapterNegotiationQuestionCandidate,
  ): Promise<Array<typeof questions.$inferSelect>> {
    const exactCohort = provenance.taskId
      ? sql`${questions.detection}->'negotiation'->>'taskId' = ${provenance.taskId}`
      : and(
          sql`${questions.detection}->'negotiation'->>'recipientUserId' = ${provenance.recipientUserId}`,
          sql`${questions.detection}->'negotiation'->>'recipientIntentId' = ${provenance.recipientIntentId}`,
          sql`${questions.detection}->'negotiation'->>'opportunityId' = ${provenance.opportunityId}`,
          sql`${questions.detection}->'negotiation'->>'purpose' = ${provenance.purpose}`,
        );
    return database.select().from(questions)
      .where(exactCohort)
      .orderBy(questions.id)
      .for('update');
  }

  /**
   * Lock every mutable provenance row in the one ordering shared by generation,
   * answer, dismiss, and timeout: advisory → full question cohort → intent →
   * assignment → membership → network → opportunity → task.
   */
  private async lockNegotiationSettlementRows(
    database: DrizzleDB,
    provenance: AdapterNegotiationQuestionCandidate,
  ): Promise<void> {
    await database.select({ id: intents.id }).from(intents)
      .where(eq(intents.id, provenance.recipientIntentId)).limit(1).for('update');
    await database.select({ intentId: intentNetworks.intentId }).from(intentNetworks)
      .where(and(eq(intentNetworks.intentId, provenance.recipientIntentId), eq(intentNetworks.networkId, provenance.networkId)))
      .limit(1).for('update');
    await database.select({ userId: networkMembers.userId }).from(networkMembers)
      .where(and(eq(networkMembers.userId, provenance.recipientUserId), eq(networkMembers.networkId, provenance.networkId)))
      .limit(1).for('update');
    await database.select({ id: networks.id }).from(networks)
      .where(eq(networks.id, provenance.networkId)).limit(1).for('update');
    await database.select({ id: opportunities.id }).from(opportunities)
      .where(eq(opportunities.id, provenance.opportunityId)).limit(1).for('update');
    if (provenance.taskId) {
      await database.select({ id: tasks.id }).from(tasks)
        .where(eq(tasks.id, provenance.taskId)).limit(1).for('update');
    }
  }

  /** Append one established shared negotiation-context entry without exposing uptake answers. */
  private async appendOpportunityAnswer(
    database: DrizzleDB,
    opportunityId: string,
    entry: { questionId: string; selectedOptions: string[]; freeText?: string; answeredAt: string },
  ): Promise<void> {
    await database.update(opportunities)
      .set({
        metadata: sql`jsonb_set(
          COALESCE(${opportunities.metadata}, '{}'::jsonb),
          '{userAnswers}',
          COALESCE(${opportunities.metadata}->'userAnswers', '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb,
          true
        )`,
      })
      .where(eq(opportunities.id, opportunityId));
  }

  /** System-void a stale negotiation row without emitting user lifecycle events. */
  private async voidStaleNegotiation(database: DrizzleDB, questionId: string): Promise<void> {
    await database.update(questions)
      .set({
        status: 'dismissed',
        detection: sql`jsonb_set(${questions.detection}, '{voidedReason}', '"negotiation_stale"'::jsonb, true)`,
      })
      .where(and(eq(questions.id, questionId), eq(questions.status, 'pending')));
  }

  async expireInflightQuestion(input: AdapterNegotiationContinuationCoordinates): Promise<AdapterNegotiationContinuationCoordinates | null> {
    const candidate: AdapterNegotiationQuestionCandidate = {
      purpose: 'inflight_consultation',
      recipientUserId: input.userId,
      recipientIntentId: input.recipientIntentId,
      opportunityId: input.opportunityId,
      taskId: input.taskId,
      networkId: input.networkId,
    };
    if (input.settlementId !== settlementIdForTask(input.taskId)) return null;
    return this.db.transaction(async (tx) => {
      await this.lockNegotiationQuestionAdvisory(tx as unknown as DrizzleDB, candidate);
      const cohort = await this.lockNegotiationQuestionCohort(tx as unknown as DrizzleDB, candidate);
      await this.lockNegotiationSettlementRows(tx as unknown as DrizzleDB, candidate);
      const [task] = await tx.select({
        state: tasks.state,
        claimedByAgentId: tasks.claimedByAgentId,
        metadata: tasks.metadata,
      })
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);
      if (!task) return null;
      const metadata = task.metadata as Record<string, unknown> | null;
      const existingSettlement = parseNegotiationQuestionSettlement(metadata?.questionSettlement);
      if (existingSettlement) {
        return this.settlementMatchesCoordinates(existingSettlement, input) ? input : null;
      }
      if (
        metadata
        && consultationExpiryReadiness({
          taskState: task.state,
          taskClaimedByAgentId: task.claimedByAgentId,
          taskMetadata: metadata,
          coordinates: input,
        }) === 'pending_pause'
      ) throw new InflightConsultationPausePendingError();
      const binding = parseAskUserBinding(
        (metadata?.turnContext as Record<string, unknown> | undefined)?.askUserBinding,
      );
      if (
        task.state !== 'input_required'
        || metadata?.type !== 'negotiation'
        || metadata.opportunityId !== input.opportunityId
        || metadata.networkId !== input.networkId
        || !binding
        || binding.settlementId !== input.settlementId
        || binding.consultationAttemptId !== input.consultationAttemptId
        || binding.recipientUserId !== input.userId
        || binding.recipientIntentId !== input.recipientIntentId
        || binding.opportunityId !== input.opportunityId
        || binding.networkId !== input.networkId
        || binding.intentFingerprint !== input.intentFingerprint
        || binding.opportunityStatus !== input.opportunityStatus
        || binding.opportunityUpdatedAt !== input.opportunityUpdatedAt
        || binding.counterpartyUserId !== input.counterpartyUserId
        || binding.counterpartyBinding.kind !== input.counterpartyBinding.kind
        || binding.counterpartyBinding.id !== input.counterpartyBinding.id
      ) return null;
      // Answers are authoritative over staleness; drift is logged, not fatal.
      // Expiry is a cleanup act: the coherence gate above — the exact task
      // still input_required and the binding the caller names — is all it
      // requires, so the timeout settlement lands even when the opportunity
      // went terminal or the signal was edited since the park.
      const current = await this.resolveNegotiationAdmission(candidate, tx as unknown as DrizzleDB);
      if (
        current === null
        || current.intentFingerprint !== input.intentFingerprint
        || current.opportunityStatus !== input.opportunityStatus
        || current.opportunityUpdatedAt !== input.opportunityUpdatedAt
      ) {
        settleLogger.info('negotiation_expiry_settled_despite_drift', {
          taskId: input.taskId,
          opportunityId: input.opportunityId,
          recipientUserId: input.userId,
          ...(current
            ? {
                intentFingerprintMoved: current.intentFingerprint !== input.intentFingerprint,
                opportunityStatus: { bound: input.opportunityStatus, current: current.opportunityStatus },
                opportunityUpdatedAt: { bound: input.opportunityUpdatedAt, current: current.opportunityUpdatedAt },
              }
            : { admissionResolved: false }),
        });
      }

      for (const row of cohort) {
        const detection = row.detection as AdapterQuestionDetection;
        const provenance = parseAdapterNegotiationProvenance(detection.negotiation);
        if (
          !provenance
          || provenance.purpose !== 'inflight_consultation'
          || provenance.taskId !== input.taskId
          || provenance.recipientUserId !== input.userId
          || provenance.recipientIntentId !== input.recipientIntentId
          || provenance.opportunityId !== input.opportunityId
          || provenance.networkId !== input.networkId
        ) await this.voidStaleNegotiation(tx as unknown as DrizzleDB, row.id);
      }

      const settledAt = new Date().toISOString();
      const durableSettlement: AdapterNegotiationQuestionSettlement = {
        version: 1,
        settlementId: input.settlementId,
        taskId: input.taskId,
        ...(input.consultationAttemptId ? { consultationAttemptId: input.consultationAttemptId } : {}),
        recipientUserId: input.userId,
        recipientIntentId: input.recipientIntentId,
        opportunityId: input.opportunityId,
        networkId: input.networkId,
        intentFingerprint: input.intentFingerprint,
        opportunityStatus: input.opportunityStatus,
        opportunityUpdatedAt: input.opportunityUpdatedAt,
        counterpartyUserId: input.counterpartyUserId,
        counterpartyBinding: input.counterpartyBinding,
        kind: 'timeout',
        continuationStatus: 'requested',
        settledAt,
      };
      const [claimed] = await tx.update(tasks).set({
        state: 'canceled',
        statusMessage: { reason: 'ask_user_window_expired', settlementId: input.settlementId },
        metadata: sql`jsonb_set(COALESCE(${tasks.metadata}, '{}'::jsonb), '{questionSettlement}', ${JSON.stringify(durableSettlement)}::jsonb, true)`,
        statusTimestamp: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(tasks.id, input.taskId), eq(tasks.state, 'input_required')))
        .returning({ id: tasks.id });
      if (!claimed) return null;
      await tx.update(questions).set({ status: 'dismissed' }).where(and(
        eq(questions.status, 'pending'),
        sql`${questions.detection}->'negotiation'->>'taskId' = ${input.taskId}`,
      ));
      return input;
    });
  }

  /**
   * Row-less analogue of the card answer settle for the conversational DM
   * path (docs/plans/2026-08-18-conversational-questions.md): CAS the exact
   * `input_required` task closed under the same advisory/cohort/settlement
   * locks and stamped ask-user binding checks as `answer`/`expireInflightQuestion`,
   * but with no QUESTIONS row — the answer is stored INLINE on the
   * questionSettlement, where `loadPrivateConsultation` reads it for the
   * continuation claim. Any pending question-card rows for the task are
   * dismissed; the DM answer supersedes them.
   *
   * Returns 'settled' when this call closed the task, 'already_settled' when
   * an earlier delivery stored an answer settlement for the same consult (the
   * settlement-keyed continuation enqueue is idempotent, so re-enqueueing is
   * correct), 'recorded_unresumable' when the answer was durably recorded but
   * the negotiation cannot continue (terminal opportunity / archived signal —
   * the park retires, no continuation may claim it), and 'lost' when the
   * coherence gate refuses — the task is no longer `input_required`, or a
   * dismiss/timeout settlement won the race.
   */
  async settleInflightNegotiationAnswerFromDm(input: {
    taskId: string;
    settlementId: string;
    opportunityId: string;
    recipientUserId: string;
    recipientIntentId: string;
    networkId: string;
    answer: { selectedOptions: string[]; freeText?: string; answeredAt: string };
  }): Promise<'settled' | 'already_settled' | 'recorded_unresumable' | 'lost'> {
    if (input.settlementId !== settlementIdForTask(input.taskId)) return 'lost';
    const candidate: AdapterNegotiationQuestionCandidate = {
      purpose: 'inflight_consultation',
      recipientUserId: input.recipientUserId,
      recipientIntentId: input.recipientIntentId,
      opportunityId: input.opportunityId,
      taskId: input.taskId,
      networkId: input.networkId,
    };
    return this.db.transaction(async (tx) => {
      await this.lockNegotiationQuestionAdvisory(tx as unknown as DrizzleDB, candidate);
      const cohort = await this.lockNegotiationQuestionCohort(tx as unknown as DrizzleDB, candidate);
      await this.lockNegotiationSettlementRows(tx as unknown as DrizzleDB, candidate);
      const [task] = await tx.select({ state: tasks.state, metadata: tasks.metadata })
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);
      if (!task) return 'lost';
      const metadata = task.metadata as Record<string, unknown> | null;
      const existingSettlement = parseNegotiationQuestionSettlement(metadata?.questionSettlement);
      if (existingSettlement) {
        return existingSettlement.kind === 'answer'
          && existingSettlement.settlementId === input.settlementId
          && existingSettlement.recipientUserId === input.recipientUserId
          && existingSettlement.opportunityId === input.opportunityId
          ? (existingSettlement.continuationStatus === 'unresumable' ? 'recorded_unresumable' : 'already_settled')
          : 'lost';
      }
      const binding = parseAskUserBinding(
        (metadata?.turnContext as Record<string, unknown> | undefined)?.askUserBinding,
      );
      if (
        task.state !== 'input_required'
        || metadata?.type !== 'negotiation'
        || metadata.opportunityId !== input.opportunityId
        || metadata.networkId !== input.networkId
        || !binding
        || binding.settlementId !== input.settlementId
        || binding.recipientUserId !== input.recipientUserId
        || binding.recipientIntentId !== input.recipientIntentId
        || binding.opportunityId !== input.opportunityId
        || binding.networkId !== input.networkId
      ) return 'lost';
      // Answers are authoritative over staleness; drift is logged, not fatal.
      // The coherence checks above decide whether this answer belongs to this
      // park; the world having moved since the park (signal edited,
      // opportunity touched) never blocks it — the resumed turn re-reads
      // current data. Only current reality gates: an opportunity run-existing
      // would refuse (terminal status) or an archived/retired recipient signal
      // makes the park genuinely unresumable.
      const [opportunityRow] = await tx.select({
        status: opportunities.status,
        updatedAt: opportunities.updatedAt,
      })
        .from(opportunities)
        .where(eq(opportunities.id, input.opportunityId))
        .limit(1);
      const [intentRow] = await tx.select({
        archivedAt: intents.archivedAt,
        status: intents.status,
        payload: intents.payload,
        summary: intents.summary,
      })
        .from(intents)
        .where(and(
          eq(intents.id, input.recipientIntentId),
          eq(intents.userId, input.recipientUserId),
        ))
        .limit(1);
      const resumable = opportunityRow !== undefined
        && RESUMABLE_OPPORTUNITY_STATUSES.has(opportunityRow.status)
        && intentRow !== undefined
        && intentRow.archivedAt === null
        && (intentRow.status === null || intentRow.status === 'ACTIVE');
      if (resumable) {
        const currentFingerprint = computeIntentFingerprint(intentRow.payload, intentRow.summary);
        const currentUpdatedAt = opportunityRow.updatedAt.toISOString();
        if (
          currentFingerprint !== binding.intentFingerprint
          || opportunityRow.status !== binding.opportunityStatus
          || currentUpdatedAt !== binding.opportunityUpdatedAt
        ) {
          settleLogger.info('negotiation_answer_settled_despite_drift', {
            taskId: input.taskId,
            opportunityId: input.opportunityId,
            recipientUserId: input.recipientUserId,
            intentFingerprintMoved: currentFingerprint !== binding.intentFingerprint,
            opportunityStatus: { bound: binding.opportunityStatus, current: opportunityRow.status },
            opportunityUpdatedAt: { bound: binding.opportunityUpdatedAt, current: currentUpdatedAt },
          });
        }
      }

      const durableSettlement: AdapterNegotiationQuestionSettlement = {
        version: 1,
        settlementId: binding.settlementId,
        taskId: input.taskId,
        ...(binding.consultationAttemptId ? { consultationAttemptId: binding.consultationAttemptId } : {}),
        recipientUserId: input.recipientUserId,
        recipientIntentId: input.recipientIntentId,
        opportunityId: input.opportunityId,
        networkId: input.networkId,
        intentFingerprint: binding.intentFingerprint,
        opportunityStatus: binding.opportunityStatus,
        opportunityUpdatedAt: binding.opportunityUpdatedAt,
        counterpartyUserId: binding.counterpartyUserId,
        counterpartyBinding: binding.counterpartyBinding,
        kind: 'answer',
        answer: {
          selectedOptions: input.answer.selectedOptions,
          ...(input.answer.freeText !== undefined ? { freeText: input.answer.freeText } : {}),
          answeredAt: input.answer.answeredAt,
        },
        continuationStatus: resumable ? 'requested' : 'unresumable',
        settledAt: input.answer.answeredAt,
      };
      const [claimed] = await tx.update(tasks)
        .set({
          state: 'canceled',
          statusMessage: {
            reason: resumable ? 'ask_user_answered' : 'ask_user_answered_unresumable',
            settlementId: durableSettlement.settlementId,
          },
          metadata: sql`jsonb_set(COALESCE(${tasks.metadata}, '{}'::jsonb), '{questionSettlement}', ${JSON.stringify(durableSettlement)}::jsonb, true)`,
          statusTimestamp: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(tasks.id, input.taskId), eq(tasks.state, 'input_required')))
        .returning({ id: tasks.id });
      if (!claimed) return 'lost';
      for (const row of cohort) {
        if (row.status === 'pending') {
          await tx.update(questions).set({ status: 'dismissed' })
            .where(and(eq(questions.id, row.id), eq(questions.status, 'pending')));
        }
      }
      return resumable ? 'settled' : 'recorded_unresumable';
    });
  }

  /**
   * Append one routed DM answer to `opportunity.metadata.userAnswers`, where
   * continuation prompts read between-session context. Idempotent per
   * `questionId`: an append whose key is already present is ignored, so a
   * redelivered reply records nothing twice.
   */
  async recordOpportunityUserAnswer(
    opportunityId: string,
    entry: { questionId: string; selectedOptions: string[]; freeText?: string; answeredAt: string },
  ): Promise<void> {
    await this.db.update(opportunities)
      .set({
        metadata: sql`jsonb_set(
          COALESCE(${opportunities.metadata}, '{}'::jsonb),
          '{userAnswers}',
          COALESCE(${opportunities.metadata}->'userAnswers', '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb,
          true
        )`,
      })
      .where(and(
        eq(opportunities.id, opportunityId),
        sql`NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(${opportunities.metadata}->'userAnswers', '[]'::jsonb)) existing
          WHERE existing->>'questionId' = ${entry.questionId}
        )`,
      ));
  }

  /** Atomically validate material binding, create/reuse the exact successor, and acquire its fenced lease. */
  async claimNegotiationContinuationExecution(
    input: AdapterNegotiationContinuationKey,
  ): Promise<ContinuationClaimResult> {
    if (input.settlementId !== settlementIdForTask(input.taskId)) return { status: 'invalid' };
    const [row] = await this.db.select({ metadata: tasks.metadata })
      .from(tasks)
      .where(eq(tasks.id, input.taskId))
      .limit(1);
    const settlement = parseNegotiationQuestionSettlement((row?.metadata as Record<string, unknown> | null)?.questionSettlement);
    if (
      !settlement
      || settlement.taskId !== input.taskId
      || settlement.settlementId !== input.settlementId
      || settlement.opportunityId !== input.opportunityId
      || settlement.recipientUserId !== input.userId
      || settlement.recipientIntentId !== input.recipientIntentId
      || settlement.networkId !== input.networkId
    ) return { status: 'invalid' };
    return claimContinuationExecution(this.db, {
      ...input,
      intentFingerprint: settlement.intentFingerprint,
      opportunityStatus: settlement.opportunityStatus,
      opportunityUpdatedAt: settlement.opportunityUpdatedAt,
      counterpartyUserId: settlement.counterpartyUserId,
      counterpartyBinding: settlement.counterpartyBinding,
    });
  }

  /** Extend only the current token/fence lease. */
  heartbeatNegotiationContinuationExecution(
    execution: ContinuationExecutionFence,
  ): Promise<ContinuationExecutionFence> {
    return heartbeatContinuationExecution(this.db, execution);
  }

  /** Release only the current owner after an operational failure; settlement remains requested. */
  releaseNegotiationContinuationExecution(execution: ContinuationExecutionFence): Promise<void> {
    return releaseContinuationExecution(this.db, execution);
  }

  /** Preserve the exact fence while an external recipient agent owns the next turn. */
  parkNegotiationContinuationExecution(execution: ContinuationExecutionFence): Promise<void> {
    return parkContinuationExecution(this.db, execution);
  }

  /** Complete only a positively receipted exact successor under the current token/fence. */
  completeNegotiationContinuationExecution(
    execution: ContinuationExecutionFence,
    receipt: ContinuationReceipt,
  ): Promise<void> {
    return completeContinuationExecution(this.db, execution, receipt);
  }

  private settlementMatchesCoordinates(
    settlement: AdapterNegotiationQuestionSettlement,
    input: AdapterNegotiationContinuationCoordinates,
  ): boolean {
    return settlement.taskId === input.taskId
      && settlement.settlementId === input.settlementId
      && settlement.consultationAttemptId === input.consultationAttemptId
      && settlement.opportunityId === input.opportunityId
      && settlement.recipientUserId === input.userId
      && settlement.recipientIntentId === input.recipientIntentId
      && settlement.networkId === input.networkId
      && settlement.intentFingerprint === input.intentFingerprint
      && settlement.opportunityStatus === input.opportunityStatus
      && settlement.opportunityUpdatedAt === input.opportunityUpdatedAt
      && settlement.counterpartyUserId === input.counterpartyUserId
      && settlement.counterpartyBinding.kind === input.counterpartyBinding.kind
      && settlement.counterpartyBinding.id === input.counterpartyBinding.id;
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Validate the minimal fixed-axis shape used by newborn stamping. */
