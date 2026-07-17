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
import type { RawEvidenceOutcome, RawEvidenceSegment, RawEvidenceTurn } from '@indexnetwork/protocol';

import { chatDatabaseAdapter } from '../../adapters/database.adapter';
import { computeIntentFingerprint } from '../../lib/intent/intent.fingerprint';
import { log } from '../../lib/log';
import { selectPoolForMining } from './mining.shared';
import type { PoolMiningTrigger } from './mining.shared';

/** Greppable logger (IND-433): search deploy logs for "NegotiationEvidenceShadow". */
const logger = log.job.from('NegotiationEvidenceShadow');

/** Lazily constructed so importing this module never requires OPENROUTER_API_KEY. */
let miner: NegotiationEvidenceMiner | null = null;

/** Coarse outcome reasons that survive the allowlist (screened_out is a private gate). */
const ALLOWED_OUTCOME_REASONS = new Set<RawEvidenceOutcome['reason']>(['turn_cap', 'timeout', 'screened_out']);
const MAX_ERROR_LABEL_CHARS = 64;

interface ShadowIntent {
  userId: string;
  payload: string;
  summary: string | null;
  archivedAt: Date | null;
  status: string | null;
}

interface ShadowOpportunity {
  id: string;
  actors: Array<{ userId: string; role: string }>;
  context?: { networkId?: string | null } | null;
}

interface ShadowTask {
  id: string;
  conversationId: string;
  state: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ShadowMessage {
  senderId: string;
  parts: unknown;
}

interface ShadowArtifact {
  name: string | null;
  parts: unknown[];
}

interface ShadowLogger {
  debug: (message: string, metadata?: Record<string, unknown>) => void;
  info: (message: string, metadata?: Record<string, unknown>) => void;
  warn: (message: string, metadata?: Record<string, unknown>) => void;
}

/** Injectable boundaries keep the shadow producer unit-testable without DB/LLM access. */
export interface NegotiationEvidenceShadowDeps {
  database: {
    getIntent: (intentId: string) => Promise<ShadowIntent | null>;
    getNegotiationTasksForOpportunity: (opportunityId: string) => Promise<ShadowTask[]>;
    getMessagesByTaskIds: (taskIds: string[]) => Promise<Map<string, ShadowMessage[]>>;
    getArtifactsForTask: (taskId: string) => Promise<ShadowArtifact[]>;
  };
  selectPool: (
    userId: string,
    intentId: string,
    sessionId: string | undefined,
  ) => Promise<ShadowOpportunity[]>;
  getMiner: () => NegotiationEvidenceMiner;
  runShadow: typeof runNegotiationEvidenceShadow;
  logger: ShadowLogger;
}

const DEFAULT_DEPS: NegotiationEvidenceShadowDeps = {
  database: chatDatabaseAdapter,
  selectPool: (userId, intentId, sessionId) => selectPoolForMining(userId, intentId, sessionId),
  getMiner: () => {
    miner ??= new NegotiationEvidenceMiner();
    return miner;
  },
  runShadow: runNegotiationEvidenceShadow,
  logger,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedErrorLabel(value: string, fallback: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, MAX_ERROR_LABEL_CHARS);
  return normalized || fallback;
}

/** Convert an exception to bounded class/code labels without retaining payload text. */
export function toBoundedErrorTelemetry(error: unknown): { errorClass: string; errorCode: string } {
  const errorClass = error instanceof Error
    ? boundedErrorLabel(error.name, 'Error')
    : 'NonError';
  const rawCode = isRecord(error) && (typeof error.code === 'string' || typeof error.code === 'number')
    ? String(error.code)
    : 'UNCLASSIFIED';
  return {
    errorClass,
    errorCode: boundedErrorLabel(rawCode, 'UNCLASSIFIED'),
  };
}

/** Return the exact bilateral counterparty only when opportunity actors are valid. */
export function getValidatedCounterpartyUserId(
  opportunity: ShadowOpportunity,
  recipientUserId: string,
): string | null {
  const participantIds = new Set(
    opportunity.actors
      .filter((actor) => actor.role !== 'introducer')
      .map((actor) => actor.userId),
  );
  if (participantIds.size !== 2 || !participantIds.has(recipientUserId)) return null;
  return [...participantIds].find((userId) => userId !== recipientUserId) ?? null;
}

/** Canonicalize only the two exact negotiation-agent sender IDs. */
export function canonicalizeNegotiationSender(
  senderId: string,
  sourceUserId: string,
  candidateUserId: string,
): string | null {
  if (senderId === `agent:${sourceUserId}`) return sourceUserId;
  if (senderId === `agent:${candidateUserId}`) return candidateUserId;
  return null;
}

/** Read only immutable task-creation provenance; legacy tasks fail closed. */
function captureTimeIntentFingerprint(
  metadata: Record<string, unknown>,
  recipientUserId: string,
  intentId: string,
): string | null {
  const intentSnapshots = metadata.intentSnapshots;
  if (!Array.isArray(intentSnapshots)) return null;

  const matches = intentSnapshots.filter(
    (snapshot) => isRecord(snapshot)
      && snapshot.userId === recipientUserId
      && snapshot.intentId === intentId,
  );
  if (matches.length !== 1) return null;
  const capturedIntent = matches[0];
  if (typeof capturedIntent.description !== 'string'
    || typeof capturedIntent.title !== 'string') {
    return null;
  }
  return computeIntentFingerprint(capturedIntent.description, capturedIntent.title);
}

function validateTask(
  task: ShadowTask,
  input: {
    opportunityId: string;
    networkId: string;
    recipientUserId: string;
    counterpartyUserId: string;
    intentId: string;
    currentIntentFingerprint: string;
  },
): { sourceUserId: string; candidateUserId: string; intentFingerprint: string } | null {
  const metadata = task.metadata;
  if (!metadata
    || metadata.type !== 'negotiation'
    || metadata.opportunityId !== input.opportunityId
    || metadata.networkId !== input.networkId) {
    return null;
  }

  const sourceUserId = metadata.sourceUserId;
  const candidateUserId = metadata.candidateUserId;
  if (typeof sourceUserId !== 'string'
    || typeof candidateUserId !== 'string'
    || sourceUserId === candidateUserId) {
    return null;
  }
  const taskParticipants = new Set([sourceUserId, candidateUserId]);
  if (taskParticipants.size !== 2
    || !taskParticipants.has(input.recipientUserId)
    || !taskParticipants.has(input.counterpartyUserId)) {
    return null;
  }

  const intentFingerprint = captureTimeIntentFingerprint(
    metadata,
    input.recipientUserId,
    input.intentId,
  );
  if (intentFingerprint !== input.currentIntentFingerprint) return null;

  return { sourceUserId, candidateUserId, intentFingerprint };
}

function readDataPart(parts: unknown): Record<string, unknown> | null {
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    if (isRecord(part) && part.kind === 'data' && isRecord(part.data)) return part.data;
  }
  return null;
}

function projectTurns(
  messages: ShadowMessage[],
  sourceUserId: string,
  candidateUserId: string,
): RawEvidenceTurn[] {
  const turns: RawEvidenceTurn[] = [];
  for (const message of messages) {
    const senderUserId = canonicalizeNegotiationSender(
      message.senderId,
      sourceUserId,
      candidateUserId,
    );
    if (!senderUserId) continue;
    const data = readDataPart(message.parts);
    if (!data) continue;
    turns.push({
      senderUserId,
      action: typeof data.action === 'string' ? data.action : '',
      message: typeof data.message === 'string' || data.message === null ? data.message : null,
    });
  }
  return turns;
}

function projectOutcome(
  artifacts: ShadowArtifact[],
  sourceUserId: string,
  candidateUserId: string,
): RawEvidenceOutcome | undefined {
  const artifact = artifacts.find((candidate) => candidate.name === 'negotiation-outcome');
  if (!artifact) return undefined;
  const data = readDataPart(artifact.parts);
  if (!data || typeof data.hasOpportunity !== 'boolean') return undefined;

  const reason = typeof data.reason === 'string'
    && ALLOWED_OUTCOME_REASONS.has(data.reason as RawEvidenceOutcome['reason'])
    ? data.reason as RawEvidenceOutcome['reason']
    : undefined;
  const participantIds = new Set([sourceUserId, candidateUserId]);
  const allowedRoles = new Set(['agent', 'patient', 'peer']);
  let agreedRoles: Array<{ userId: string; role: string }> | undefined;
  if (data.agreedRoles !== undefined) {
    if (!Array.isArray(data.agreedRoles) || !data.agreedRoles.every(
      (role) => isRecord(role)
        && typeof role.userId === 'string'
        && participantIds.has(role.userId)
        && typeof role.role === 'string'
        && allowedRoles.has(role.role),
    )) {
      return undefined;
    }
    agreedRoles = data.agreedRoles.map((role) => ({
      userId: (role as Record<string, unknown>).userId as string,
      role: (role as Record<string, unknown>).role as string,
    }));
  }
  return {
    hasOpportunity: data.hasOpportunity,
    ...(reason ? { reason } : {}),
    ...(agreedRoles ? { agreedRoles } : {}),
  };
}

/** Build one fail-closed evidence segment per exact validated task/continuation. */
export async function collectNegotiationEvidenceSegments(
  input: {
    opportunities: ShadowOpportunity[];
    recipientUserId: string;
    intentId: string;
    currentIntentFingerprint: string;
    networkId: string;
  },
  database: NegotiationEvidenceShadowDeps['database'],
): Promise<RawEvidenceSegment[]> {
  const segments: RawEvidenceSegment[] = [];

  for (const opportunity of input.opportunities) {
    const counterpartyUserId = getValidatedCounterpartyUserId(
      opportunity,
      input.recipientUserId,
    );
    if (!counterpartyUserId) continue;

    const tasks = await database.getNegotiationTasksForOpportunity(opportunity.id);
    const validatedTasks = tasks.flatMap((task) => {
      const validation = validateTask(task, {
        opportunityId: opportunity.id,
        networkId: input.networkId,
        recipientUserId: input.recipientUserId,
        counterpartyUserId,
        intentId: input.intentId,
        currentIntentFingerprint: input.currentIntentFingerprint,
      });
      return validation ? [{ task, validation }] : [];
    });
    if (validatedTasks.length === 0) continue;

    const messagesByTaskId = await database.getMessagesByTaskIds(
      validatedTasks.map(({ task }) => task.id),
    );
    for (const { task, validation } of validatedTasks) {
      const artifacts = await database.getArtifactsForTask(task.id);
      const outcome = projectOutcome(
        artifacts,
        validation.sourceUserId,
        validation.candidateUserId,
      );
      segments.push({
        recipientUserId: input.recipientUserId,
        intentId: input.intentId,
        intentFingerprint: validation.intentFingerprint,
        opportunityId: opportunity.id,
        taskId: task.id,
        conversationId: task.conversationId,
        networkId: input.networkId,
        counterpartyUserId,
        turns: projectTurns(
          messagesByTaskId.get(task.id) ?? [],
          validation.sourceUserId,
          validation.candidateUserId,
        ),
        ...(outcome ? { outcome } : {}),
      });
    }
  }

  return segments;
}

function isFinalIntentValid(
  intent: ShadowIntent | null,
  userId: string,
  expectedFingerprint: string,
): boolean {
  return Boolean(
    intent
    && intent.userId === userId
    && intent.archivedAt === null
    && (intent.status === null || intent.status === 'ACTIVE')
    && computeIntentFingerprint(intent.payload, intent.summary) === expectedFingerprint,
  );
}

/**
 * Fire-and-forget, failure-isolated, flag-gated Lens C shadow pass over the
 * triggering intent's pool. Never throws; never persists; never enqueues.
 */
export async function maybeRunNegotiationEvidenceShadow(
  trigger: PoolMiningTrigger,
  deps: NegotiationEvidenceShadowDeps = DEFAULT_DEPS,
): Promise<void> {
  if (negotiationEvidenceQuestionsMode() === 'off') return;
  if (trigger.isIntroducerFlow || !trigger.intentId) return;

  const { userId, intentId } = trigger;
  try {
    const intent = await deps.database.getIntent(intentId);
    if (intent?.userId !== userId) return;
    const intentFingerprint = computeIntentFingerprint(intent.payload, intent.summary);

    const pool = await deps.selectPool(userId, intentId, trigger.sessionId);

    // Keep the pass single-network: mine only the largest network group.
    const byNetwork = new Map<string, ShadowOpportunity[]>();
    for (const opportunity of pool) {
      const networkId = opportunity.context?.networkId;
      if (!networkId) continue;
      const group = byNetwork.get(networkId) ?? [];
      group.push(opportunity);
      byNetwork.set(networkId, group);
    }
    let passNetworkId: string | undefined;
    let passPool: ShadowOpportunity[] = [];
    for (const [networkId, group] of byNetwork) {
      if (group.length > passPool.length) {
        passNetworkId = networkId;
        passPool = group;
      }
    }
    if (!passNetworkId || passPool.length === 0) {
      deps.logger.debug('negotiation-evidence shadow skipped: no single-network pool', {
        source: trigger.source,
        runId: trigger.runId ?? null,
        intentId,
      });
      return;
    }

    const segments = await collectNegotiationEvidenceSegments({
      opportunities: passPool.slice(0, NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES),
      recipientUserId: userId,
      intentId,
      currentIntentFingerprint: intentFingerprint,
      networkId: passNetworkId,
    }, deps.database);
    if (segments.length === 0) {
      deps.logger.debug('negotiation-evidence shadow skipped: no minable segments', {
        source: trigger.source,
        runId: trigger.runId ?? null,
        intentId,
      });
      return;
    }

    // Final fail-closed lifecycle/fingerprint check immediately before the LLM pass.
    const finalIntent = await deps.database.getIntent(intentId);
    if (!isFinalIntentValid(finalIntent, userId, intentFingerprint)) return;

    const result = await deps.runShadow({
      scope: { recipientUserId: userId, intentId, intentFingerprint, networkId: passNetworkId },
      segments,
      miner: deps.getMiner(),
    });

    // Log ONLY aggregate telemetry. NEVER log hypotheses or evidence content.
    deps.logger.info('negotiation-evidence shadow result', {
      source: trigger.source,
      runId: trigger.runId ?? null,
      ...result.telemetry,
    });
  } catch (error) {
    deps.logger.warn('negotiation-evidence shadow pass failed', {
      source: trigger.source,
      intentId,
      ...toBoundedErrorTelemetry(error),
    });
  }
}
