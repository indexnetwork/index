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
 * Wired independently of the Lens A pool machinery, so this lens runs on its
 * own. Fully failure-isolated: it never throws into the caller's discovery
 * lifecycle.
 *
 * IND-465 slice 1: the single-network pass scope is derived from capture-time
 * negotiation TASK metadata (which always records a validated networkId)
 * instead of `opportunity.context.networkId` (only conditionally recorded at
 * discovery creation, empty on most evidence-bearing rows). All derivation
 * rules fail closed; context, when present, acts only as a contamination
 * guard and never overrides tasks. The Lens-C-local pool selection also
 * includes terminal statuses — evidence lives on decided negotiations —
 * without touching the shared Lens A live-pool selection.
 *
 * IND-465 slice 2: answeredBy-verified owner answers are projected into
 * evidence segments from the questions table ONLY — negotiation-family
 * question rows carry `answer.answeredBy`, giving verifiable authority.
 * `opportunity.metadata.userAnswers` is deliberately NEVER read for evidence:
 * it has no answeredBy, is a counterparty-visible channel, and ask_user
 * expiry writes synthetic entries containing disclosure-subject text.
 * shared_message stays impossible-by-construction (no per-message consent
 * primitive exists; deferred to IND-467).
 */
import { NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES, NegotiationEvidenceMiner, runNegotiationEvidenceShadow } from '@indexnetwork/protocol';
import type { RawEvidenceOutcome, RawEvidenceOwnerAnswer, RawEvidenceSegment, RawEvidenceTurn } from '@indexnetwork/protocol';

import { chatDatabaseAdapter } from '../../adapters/database.adapter';
import { POOL_TERMINAL_STATUSES } from '../../adapters/poolquery.shared';
import { computeIntentFingerprint } from '../../lib/intent/intent.fingerprint';
import { log } from '../../lib/log';

/**
 * One discovery-completion event. Formerly `PoolMiningTrigger` from the
 * retired pool-discriminator mining hook; the shadow keeps the same shape so
 * its log dimensions stay comparable across the retirement.
 */
export interface EvidenceShadowTrigger {
  source: 'from_intent' | 'intent_visit';
  userId: string;
  intentId?: string;
  runId?: string;
  sessionId?: string;
  isIntroducerFlow?: boolean;
  searchQuery?: string;
}

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
  status?: string | null;
  actors: Array<{ userId: string; role: string }>;
  context?: { networkId?: string | null; conversationId?: string | null } | null;
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

/** AnsweredBy-verified owner answer row returned by the questions-table fetch. */
interface ShadowOwnerAnswer {
  answeredBy: string;
  selectedOptions: string[];
  freeText?: string;
  /** Capture-time intent fingerprint, when the question detection recorded one. */
  capturedIntentFingerprint?: string;
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
    getAnsweredNegotiationQuestionsForOpportunity: (
      recipientUserId: string,
      opportunityId: string,
      currentIntentFingerprint: string,
    ) => Promise<ShadowOwnerAnswer[]>;
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

/**
 * Lens-C-local pool selection (IND-465): the exact-trigger recipient+intent
 * pool INCLUDING terminal statuses — negotiation evidence lives on decided
 * negotiations. Deliberately separate from Lens A's selectPoolForMining,
 * which stays live-status-only; session scoping and the size cap mirror it.
 */
async function selectEvidencePoolForShadow(
  userId: string,
  intentId: string,
  sessionId: string | undefined,
): Promise<ShadowOpportunity[]> {
  const pool = await chatDatabaseAdapter.getEvidencePoolOpportunitiesForIntent(userId, intentId);
  return pool
    .filter((opportunity) => !sessionId
      || opportunity.context?.conversationId === sessionId)
    .slice(0, 50);
}

const DEFAULT_DEPS: NegotiationEvidenceShadowDeps = {
  database: chatDatabaseAdapter,
  selectPool: (userId, intentId, sessionId) => selectEvidencePoolForShadow(userId, intentId, sessionId),
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

interface TaskProvenanceInput {
  opportunityId: string;
  recipientUserId: string;
  counterpartyUserId: string;
  intentId: string;
  currentIntentFingerprint: string;
}

/**
 * Structural capture-time validation shared by network-binding derivation
 * (IND-465) and segment building — every fail-closed check EXCEPT the
 * pass-network equality, which only exists once a pass network is derived.
 */
function validateTaskProvenance(
  task: ShadowTask,
  input: TaskProvenanceInput,
): { sourceUserId: string; candidateUserId: string; intentFingerprint: string } | null {
  const metadata = task.metadata;
  if (!metadata
    || metadata.type !== 'negotiation'
    || metadata.opportunityId !== input.opportunityId) {
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

/**
 * Full segment-building validation: provenance PLUS pass-network equality.
 * NOT relaxed by IND-465 — with a derived pass network this still guards
 * sibling tasks of multi-task opportunities recorded under another network.
 */
function validateTask(
  task: ShadowTask,
  input: TaskProvenanceInput & { networkId: string },
): { sourceUserId: string; candidateUserId: string; intentFingerprint: string } | null {
  if (task.metadata?.networkId !== input.networkId) return null;
  return validateTaskProvenance(task, input);
}

/** Aggregate-only derivation skip reasons (IND-465) — counted, never logged with IDs/text. */
type NetworkBindingSkip = 'no_task_network' | 'network_disagreement' | 'context_mismatch';

const SKIP_COUNTER_BY_OUTCOME = {
  no_task_network: 'skippedNoTaskNetwork',
  network_disagreement: 'skippedNetworkDisagreement',
  context_mismatch: 'skippedContextMismatch',
} as const satisfies Record<NetworkBindingSkip, string>;

/**
 * Derive one opportunity's network binding from capture-time negotiation task
 * metadata (IND-465). ALL rules fail closed:
 *  - only structurally valid tasks contribute (tasks without capture-time
 *    intentSnapshots stay excluded, exactly as segment building excludes them);
 *  - exactly one distinct non-empty task networkId binds the opportunity;
 *  - zero or more than one distinct value skips it;
 *  - a present-but-different `opportunity.context.networkId` skips it
 *    (contamination guard — context never overrides tasks).
 */
export function deriveTaskNetworkBinding(
  opportunity: ShadowOpportunity,
  tasks: ShadowTask[],
  input: { recipientUserId: string; intentId: string; currentIntentFingerprint: string },
): { outcome: 'bound'; networkId: string } | { outcome: NetworkBindingSkip } {
  const counterpartyUserId = getValidatedCounterpartyUserId(opportunity, input.recipientUserId);
  if (!counterpartyUserId) return { outcome: 'no_task_network' };

  const networkIds = new Set<string>();
  for (const task of tasks) {
    const provenance = validateTaskProvenance(task, {
      opportunityId: opportunity.id,
      recipientUserId: input.recipientUserId,
      counterpartyUserId,
      intentId: input.intentId,
      currentIntentFingerprint: input.currentIntentFingerprint,
    });
    if (!provenance) continue;
    const networkId = task.metadata?.networkId;
    if (typeof networkId === 'string' && networkId.length > 0) networkIds.add(networkId);
  }
  if (networkIds.size === 0) return { outcome: 'no_task_network' };
  if (networkIds.size > 1) return { outcome: 'network_disagreement' };
  const [derivedNetworkId] = networkIds;
  const contextNetworkId = opportunity.context?.networkId;
  if (contextNetworkId && contextNetworkId !== derivedNetworkId) {
    return { outcome: 'context_mismatch' };
  }
  return { outcome: 'bound', networkId: derivedNetworkId };
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

/**
 * Re-check every fetch-side owner-answer constraint observable here (IND-465
 * slice 2), fail closed on any mismatch, and project only answer content:
 * - answerer MUST equal the segment recipient (authority re-verification);
 * - a present capture-time fingerprint MUST equal the current one (absence
 *   is tolerated — the segment-level task fingerprint guard covers drift);
 * - empty answers are dropped; question text, detection payloads, and other
 *   users' IDs are never projected.
 */
function projectOwnerAnswers(
  answers: ShadowOwnerAnswer[],
  recipientUserId: string,
  currentIntentFingerprint: string,
): RawEvidenceOwnerAnswer[] {
  return answers.flatMap((answer) => {
    if (answer.answeredBy !== recipientUserId) return [];
    if (answer.capturedIntentFingerprint !== undefined
      && answer.capturedIntentFingerprint !== currentIntentFingerprint) {
      return [];
    }
    const selectedOptions = Array.isArray(answer.selectedOptions)
      ? answer.selectedOptions.filter((option): option is string => typeof option === 'string')
      : [];
    const freeText = typeof answer.freeText === 'string' && answer.freeText.trim().length > 0
      ? answer.freeText
      : undefined;
    if (selectedOptions.length === 0 && freeText === undefined) return [];
    return [{
      answererUserId: answer.answeredBy,
      selectedOptions,
      ...(freeText !== undefined ? { freeText } : {}),
    }];
  });
}

/** Build one fail-closed evidence segment per exact validated task/continuation. */
export async function collectNegotiationEvidenceSegments(
  input: {
    opportunities: ShadowOpportunity[];
    recipientUserId: string;
    intentId: string;
    currentIntentFingerprint: string;
    networkId: string;
    /** Tasks already fetched during network-binding derivation (IND-465). */
    tasksByOpportunityId?: ReadonlyMap<string, ShadowTask[]>;
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

    const tasks = input.tasksByOpportunityId?.get(opportunity.id)
      ?? await database.getNegotiationTasksForOpportunity(opportunity.id);
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

    // IND-465 slice 2: answeredBy-verified owner answers, fetched once per
    // opportunity from the questions table ONLY (never metadata.userAnswers)
    // and attached to every continuation segment of the opportunity — the
    // extractor dedups identical content within an opportunity group.
    const ownerAnswers = projectOwnerAnswers(
      await database.getAnsweredNegotiationQuestionsForOpportunity(
        input.recipientUserId,
        opportunity.id,
        input.currentIntentFingerprint,
      ),
      input.recipientUserId,
      input.currentIntentFingerprint,
    );

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
        ...(ownerAnswers.length > 0 ? { ownerAnswers } : {}),
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
 * Fire-and-forget, failure-isolated Lens C shadow pass over the triggering
 * intent's pool. Never throws; never persists; never enqueues.
 */
export async function maybeRunNegotiationEvidenceShadow(
  trigger: EvidenceShadowTrigger,
  deps: NegotiationEvidenceShadowDeps = DEFAULT_DEPS,
): Promise<void> {
  if (trigger.isIntroducerFlow || !trigger.intentId) return;

  const { userId, intentId } = trigger;
  try {
    const intent = await deps.database.getIntent(intentId);
    if (intent?.userId !== userId) return;
    const intentFingerprint = computeIntentFingerprint(intent.payload, intent.summary);

    const pool = await deps.selectPool(userId, intentId, trigger.sessionId);

    // IND-465: bind each opportunity's network from capture-time task
    // metadata (fail closed), then keep the pass single-network by mining
    // only the largest derived-network group. Tasks are fetched here, before
    // grouping, and reused for segment building.
    const skipCounts = {
      skippedNoTaskNetwork: 0,
      skippedNetworkDisagreement: 0,
      skippedContextMismatch: 0,
    };
    const byNetwork = new Map<string, Array<{ opportunity: ShadowOpportunity; tasks: ShadowTask[] }>>();
    for (const opportunity of pool) {
      const tasks = await deps.database.getNegotiationTasksForOpportunity(opportunity.id);
      const binding = deriveTaskNetworkBinding(opportunity, tasks, {
        recipientUserId: userId,
        intentId,
        currentIntentFingerprint: intentFingerprint,
      });
      if (binding.outcome !== 'bound') {
        skipCounts[SKIP_COUNTER_BY_OUTCOME[binding.outcome]] += 1;
        continue;
      }
      const group = byNetwork.get(binding.networkId) ?? [];
      group.push({ opportunity, tasks });
      byNetwork.set(binding.networkId, group);
    }
    let passNetworkId: string | undefined;
    let passPool: Array<{ opportunity: ShadowOpportunity; tasks: ShadowTask[] }> = [];
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
        ...skipCounts,
      });
      return;
    }

    const passEntries = passPool.slice(0, NEGOTIATION_EVIDENCE_MAX_OPPORTUNITIES);
    const terminalStatusIncluded = passEntries.filter(({ opportunity }) => opportunity.status != null
      && (POOL_TERMINAL_STATUSES as readonly string[]).includes(opportunity.status)).length;

    const segments = await collectNegotiationEvidenceSegments({
      opportunities: passEntries.map(({ opportunity }) => opportunity),
      recipientUserId: userId,
      intentId,
      currentIntentFingerprint: intentFingerprint,
      networkId: passNetworkId,
      tasksByOpportunityId: new Map(passEntries.map(({ opportunity, tasks }) => [opportunity.id, tasks])),
    }, deps.database);
    if (segments.length === 0) {
      deps.logger.debug('negotiation-evidence shadow skipped: no minable segments', {
        source: trigger.source,
        runId: trigger.runId ?? null,
        intentId,
        ...skipCounts,
        terminalStatusIncluded,
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
      ...skipCounts,
      terminalStatusIncluded,
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
