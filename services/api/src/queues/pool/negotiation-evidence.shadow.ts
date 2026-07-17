/**
 * Lens C negotiation-evidence shadow hook (IND-433).
 *
 * When a discovery pipeline completes, mine neutral clarification hypotheses
 * from RECURRING negotiation evidence across the viewer's intent pool — read
 * IN PLACE at mining time, never projected into a durable transcript. This is
 * a privacy-safe SHADOW pass: it performs NO persistence, enqueues NO
 * question, and changes NO ranking/intent/premise/memory/policy. It logs only
 * aggregate telemetry (counts) and NEVER the mined hypothesis text.
 *
 * Gated by its OWN flag (`NEGOTIATION_EVIDENCE_QUESTIONS_MODE`, default off) and
 * wired independently of the Lens A pool flags, so this lens can run even when
 * pool discriminator mining is disabled. Fully failure-isolated: it never
 * throws into the caller's discovery lifecycle.
 */
import { NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES, NegotiationEvidenceMiner, negotiationEvidenceQuestionsMode, runNegotiationEvidenceShadow } from '@indexnetwork/protocol';
import type { RawEvidenceOutcome, RawEvidenceOwnerAnswer, RawEvidenceSegment, RawEvidenceTurn } from '@indexnetwork/protocol';

import { log } from '../../lib/log';
import { computeIntentFingerprint } from '../../lib/intent/intent.fingerprint';
import { chatDatabaseAdapter } from '../../adapters/database.adapter';
import { selectPoolForMining } from './mining.shared';
import type { PoolMiningTrigger } from './mining.shared';

/** Greppable logger (IND-433): search deploy logs for "NegotiationEvidenceShadow". */
const logger = log.job.from('NegotiationEvidenceShadow');

/** Lazily constructed so importing this module never requires OPENROUTER_API_KEY. */
let miner: NegotiationEvidenceMiner | null = null;

/** Coarse outcome reasons that survive the allowlist (screened_out is a private gate). */
const ALLOWED_OUTCOME_REASONS = new Set<RawEvidenceOutcome['reason']>(['turn_cap', 'timeout', 'screened_out']);

/**
 * Fire-and-forget, failure-isolated, flag-gated Lens C shadow pass over the
 * triggering intent's pool. Never throws; never persists; never enqueues.
 */
export async function maybeRunNegotiationEvidenceShadow(trigger: PoolMiningTrigger): Promise<void> {
  // Own flag gate — independent of the Lens A pool flags.
  if (negotiationEvidenceQuestionsMode() === 'off') return;
  // Introducer flow candidates are matches for someone else, not the viewer's
  // own pool; and this lens is strictly intent-scoped.
  if (trigger.isIntroducerFlow) return;
  if (!trigger.intentId) return;

  const { userId, intentId } = trigger;
  try {
    const intent = await chatDatabaseAdapter.getIntent(intentId);
    if (intent?.userId !== userId) return;
    const intentFingerprint = computeIntentFingerprint(intent.payload, intent.summary);

    // Same exact-trigger selector the Lens A hook uses.
    const pool = await selectPoolForMining(userId, intentId, trigger.sessionId);

    // Keep the pass single-network: group by context.networkId and mine only
    // the largest network group so evidence never crosses network boundaries.
    const byNetwork = new Map<string, typeof pool>();
    for (const o of pool) {
      const networkId = o.context?.networkId;
      if (!networkId) continue;
      const group = byNetwork.get(networkId) ?? [];
      group.push(o);
      byNetwork.set(networkId, group);
    }
    let passNetworkId: string | undefined;
    let passPool: typeof pool = [];
    for (const [networkId, group] of byNetwork) {
      if (group.length > passPool.length) {
        passNetworkId = networkId;
        passPool = group;
      }
    }
    if (!passNetworkId || passPool.length === 0) {
      logger.debug('negotiation-evidence shadow skipped: no single-network pool', {
        source: trigger.source,
        runId: trigger.runId ?? null,
        intentId,
      });
      return;
    }

    const selected = passPool.slice(0, NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES);

    const segments: RawEvidenceSegment[] = [];
    for (const o of selected) {
      const counterpartyUserId = o.actors.find(
        (a) => a.userId !== userId && a.role !== 'introducer',
      )?.userId;
      if (!counterpartyUserId) continue;

      const task = await chatDatabaseAdapter.getNegotiationTaskForOpportunity(o.id);
      if (!task) continue;

      // Turns: read in place. Copy ONLY the allowlisted projection — never
      // assessment/reasoning/askUser/disclosureSubject, and never mark a turn
      // sharedTagged (no explicit shared-consent marker exists in the schema,
      // so shared messages are excluded by default).
      const messages = await chatDatabaseAdapter.getMessagesForConversation(task.conversationId);
      const turns: RawEvidenceTurn[] = [];
      for (const message of messages) {
        const dataPart = (message.parts as Array<{ kind?: string; data?: unknown }>).find(
          (p) => p.kind === 'data',
        );
        if (!dataPart?.data) continue;
        const data = dataPart.data as { action?: string; message?: string | null };
        turns.push({
          senderUserId: message.senderId,
          action: data.action ?? '',
          message: data.message ?? null,
        });
      }

      // Outcome: coarse structured facts only. Never copy evaluator reasoning.
      const artifacts = await chatDatabaseAdapter.getArtifactsForTask(task.id);
      const outcomeArtifact = artifacts.find((a) => a.name === 'negotiation-outcome');
      let outcome: RawEvidenceOutcome | undefined;
      if (outcomeArtifact) {
        const dataPart = (outcomeArtifact.parts as Array<{ kind?: string; data?: unknown }>).find(
          (p) => p.kind === 'data',
        );
        const data = dataPart?.data as
          | { hasOpportunity?: boolean; reason?: string; agreedRoles?: Array<{ userId: string; role: string }> }
          | undefined;
        if (data) {
          const reason = ALLOWED_OUTCOME_REASONS.has(data.reason as RawEvidenceOutcome['reason'])
            ? (data.reason as RawEvidenceOutcome['reason'])
            : undefined;
          outcome = {
            hasOpportunity: data.hasOpportunity ?? false,
            ...(reason ? { reason } : {}),
            ...(data.agreedRoles ? { agreedRoles: data.agreedRoles } : {}),
          };
        }
      }

      // Owner answers: the recipient's own authoritative answers. Read from the
      // opportunity metadata (the adapter surface exposes no dedicated reader).
      const rawAnswers = Array.isArray(o.metadata?.userAnswers)
        ? (o.metadata.userAnswers as Array<{ selectedOptions?: string[]; freeText?: string }>)
        : [];
      const ownerAnswers: RawEvidenceOwnerAnswer[] = rawAnswers.map((a) => ({
        answererUserId: userId,
        selectedOptions: a.selectedOptions ?? [],
        ...(a.freeText !== undefined ? { freeText: a.freeText } : {}),
      }));

      segments.push({
        recipientUserId: userId,
        intentId,
        intentFingerprint,
        opportunityId: o.id,
        taskId: task.id,
        conversationId: task.conversationId,
        networkId: passNetworkId,
        counterpartyUserId,
        turns,
        ...(outcome ? { outcome } : {}),
        ownerAnswers,
      });
    }

    if (segments.length < 1) {
      logger.debug('negotiation-evidence shadow skipped: no minable segments', {
        source: trigger.source,
        runId: trigger.runId ?? null,
        intentId,
      });
      return;
    }

    miner ??= new NegotiationEvidenceMiner();
    const result = await runNegotiationEvidenceShadow({
      scope: { recipientUserId: userId, intentId, intentFingerprint, networkId: passNetworkId },
      segments,
      miner,
    });

    // Log ONLY aggregate telemetry. NEVER log result.hypotheses or any
    // hypothesis text — shadow mode must not persist or route the hypotheses.
    logger.info('negotiation-evidence shadow result', {
      source: trigger.source,
      runId: trigger.runId ?? null,
      ...result.telemetry,
    });
  } catch (error) {
    logger.warn('negotiation-evidence shadow pass failed', {
      source: trigger.source,
      intentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
