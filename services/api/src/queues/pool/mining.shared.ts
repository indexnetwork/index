/**
 * Shared pool-discriminator mining hook (IND-417/418, generalized in P2.1).
 *
 * One discovery pipeline finishes → mine discriminators over the viewer's
 * intent pool (shadow log) and, when POOL_QUESTIONS_MODE=on, enqueue a
 * pool_discovery question for the top eligible discriminator.
 *
 * Callers (fire-and-forget from every discovery completion path):
 *   - DiscoveryRunQueue   — async MCP discover_opportunities runs
 *   - FromIntentQueue     — web intent creation / edit / re-discovery
 *
 * The pool is read from the opportunities table (durable output; the MCP
 * tool response flattens cards into message text, so no run result carries a
 * structured candidate array). These are also the exact rows P3 re-ranks, so
 * mining over them keeps the phases consistent.
 *
 * Flags: mining runs when POOL_QUESTIONS_MINING=shadow OR
 * POOL_QUESTIONS_MODE=on; question enqueue additionally requires MODE=on and
 * QUESTIONER_ENABLED (via questionerEnqueueIfEnabled). All off = no-op.
 */
import { POOL_DISCRIMINATOR_MAX_CANDIDATES, POOL_DISCRIMINATOR_MAX_PUBLIC_CONTEXT_CHARS, POOL_DISCRIMINATOR_MIN_POOL_SIZE, PoolDiscriminatorMiner, poolQuestionsMiningMode, poolQuestionsMode, runPoolDiscriminatorShadow, selectQuestionDiscriminators, toQuestionDiscriminator } from '@indexnetwork/protocol';
import type { PoolCandidate } from '@indexnetwork/protocol';

import { log } from '../../lib/log';
import { chatDatabaseAdapter } from '../../adapters/database.adapter';
import { embedderAdapter } from '../../adapters/embedder.adapter';
import { questionerEnqueueIfEnabled } from '../questioner.queue';

/** Greppable logger (IND-417): search deploy logs for "PoolDiscriminatorMiner". */
const logger = log.job.from('PoolDiscriminatorMiner');

/** Statuses that make an opportunity part of the viewer's live candidate pool. */
const POOL_STATUSES = ['draft', 'latent', 'pending', 'negotiating'] as const;

/** Max chars of bio / match-reason folded into one candidate's publicContext. */
const POOL_FIELD_MAX_CHARS = 100;

/** Lazily constructed so importing this module never requires OPENROUTER_API_KEY. */
let poolDiscriminatorMiner: PoolDiscriminatorMiner | null = null;

/** One discovery-completion event, normalized across trigger sources. */
export interface PoolMiningTrigger {
  /** Which pipeline finished (log dimension). */
  source: 'discovery_run' | 'from_intent';
  userId: string;
  /** Triggering intent — required for questions; optional for shadow-only ad-hoc pools. */
  intentId?: string;
  /** Discovery run id, when the source has one. */
  runId?: string;
  /** Chat session that scoped the discovery (includes that session's drafts in the pool). */
  sessionId?: string;
  /** True for introducer-flow discovery: candidates are matches for someone else — skip. */
  isIntroducerFlow?: boolean;
  /** Ad-hoc query fallback for intent text (shadow-only pools). */
  searchQuery?: string;
}

/** Splits free text into novelty-reference sentences (short fragments dropped). */
function toReferenceSentences(text: string): string[] {
  return text
    .split(/[.!?\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 15);
}

/**
 * Fire-and-forget entry point: never awaited by the caller's lifecycle and
 * never allowed to fail the discovery pipeline. Both flags off = no-op.
 */
export function maybeMinePoolDiscriminators(trigger: PoolMiningTrigger): void {
  if (poolQuestionsMiningMode() !== 'shadow' && poolQuestionsMode() !== 'on') return;
  // Introducer flow: the discovered candidates are matches for someone else,
  // not the viewer's own pool — discriminator questions don't apply.
  if (trigger.isIntroducerFlow) return;
  void minePoolDiscriminators(trigger).catch((err) => {
    logger.warn('shadow mining pass failed', {
      source: trigger.source,
      runId: trigger.runId ?? null,
      userId: trigger.userId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

async function minePoolDiscriminators(trigger: PoolMiningTrigger): Promise<void> {
  const { userId, intentId } = trigger;
  const pool = await chatDatabaseAdapter.getOpportunitiesForUser(userId, {
    statuses: [...POOL_STATUSES],
    limit: 50,
    ...(intentId ? { scopeType: 'intent' as const, scopeId: intentId } : {}),
    // Chat-scoped MCP discovery creates this session's candidates as drafts;
    // passing the session id includes them in the pool.
    ...(trigger.sessionId ? { conversationId: trigger.sessionId } : {}),
  });

  const withCounterpart = pool
    .map((o) => ({
      opportunity: o,
      counterpartUserId: o.actors.find((a) => a.userId !== userId && a.role !== 'introducer')?.userId,
    }))
    .filter((x): x is typeof x & { counterpartUserId: string } => Boolean(x.counterpartUserId));

  if (withCounterpart.length < POOL_DISCRIMINATOR_MIN_POOL_SIZE) {
    logger.debug('shadow mining skipped: pool below k-anonymity floor', {
      source: trigger.source,
      runId: trigger.runId ?? null,
      poolSize: withCounterpart.length,
      minPoolSize: POOL_DISCRIMINATOR_MIN_POOL_SIZE,
    });
    return;
  }

  const top = withCounterpart
    .sort((a, b) => (b.opportunity.interpretation?.confidence ?? 0) - (a.opportunity.interpretation?.confidence ?? 0))
    .slice(0, POOL_DISCRIMINATOR_MAX_CANDIDATES);

  // Thin per-candidate context: profile name/bio + ≤3 active premise
  // snippets — the same public corpus the presenter exposes.
  const uniqueUserIds = [...new Set(top.map((c) => c.counterpartUserId))];
  const profilesByUser = new Map<string, { name: string; bio: string }>();
  await Promise.all(uniqueUserIds.map(async (uid) => {
    try {
      const profile = await chatDatabaseAdapter.getProfile(uid);
      if (profile) profilesByUser.set(uid, { name: profile.identity.name, bio: profile.identity.bio });
    } catch {
      // Profile is enrichment only — a failed lookup never blocks mining.
    }
  }));
  const premisesByUser = new Map<string, string>();
  await Promise.all(uniqueUserIds.map(async (uid) => {
    try {
      const premises = await chatDatabaseAdapter.getPremisesForUser(uid, 'ACTIVE');
      const snippets = premises.slice(0, 3).map((p) => p.assertion.text.slice(0, 90));
      if (snippets.length > 0) premisesByUser.set(uid, snippets.join('; '));
    } catch {
      // Premises are enrichment only — a failed lookup never blocks mining.
    }
  }));

  const candidates: PoolCandidate[] = top.map((c) => {
    const profile = profilesByUser.get(c.counterpartUserId);
    const matchReason = c.opportunity.interpretation?.reasoning?.slice(0, POOL_FIELD_MAX_CHARS);
    const publicContext = [
      profile?.name ? `Name: ${profile.name}.` : null,
      profile?.bio ? `Bio: ${profile.bio.slice(0, POOL_FIELD_MAX_CHARS)}` : null,
      matchReason ? `Match: ${matchReason}` : null,
      premisesByUser.has(c.counterpartUserId) ? `Premises: ${premisesByUser.get(c.counterpartUserId)}` : null,
    ].filter(Boolean).join(' ').slice(0, POOL_DISCRIMINATOR_MAX_PUBLIC_CONTEXT_CHARS);
    return { id: c.opportunity.id, publicContext, score: c.opportunity.interpretation?.confidence ?? 0 };
  });

  // Intent text: prefer the triggering intent record; fall back to the ad-hoc query.
  let intentText = trigger.searchQuery ?? '';
  if (intentId) {
    const intent = await chatDatabaseAdapter.getIntent(intentId);
    if (intent) intentText = `${intent.payload}${intent.summary ? ` (${intent.summary})` : ''}`;
  }

  // Novelty references: the owner's own intent sentences + active premises —
  // axes the user has effectively already answered should score ~0.
  let ownerPremises: string[] = [];
  try {
    ownerPremises = (await chatDatabaseAdapter.getPremisesForUser(userId, 'ACTIVE'))
      .slice(0, 12)
      .map((p) => p.assertion.text);
  } catch {
    // Novelty degrades gracefully without references.
  }
  const referenceTexts = [...toReferenceSentences(intentText), ...ownerPremises];

  poolDiscriminatorMiner ??= new PoolDiscriminatorMiner();
  const shadow = await runPoolDiscriminatorShadow({
    intentText,
    candidates,
    referenceTexts,
    miner: poolDiscriminatorMiner,
    embedder: embedderAdapter,
  });

  const round = (n: number): number => Math.round(n * 1000) / 1000;
  logger.info('shadow mining result', {
    source: trigger.source,
    runId: trigger.runId ?? null,
    userId,
    intentId: intentId ?? null,
    poolSize: shadow.poolSize,
    discriminators: shadow.discriminators.map((d) => ({
      label: d.label,
      questionSeed: d.questionSeed,
      sides: d.sides,
      voi: round(d.voi),
      entropy: round(d.entropy),
      coverage: round(d.coverage),
      novelty: round(d.novelty),
      evidenceRate: round(d.evidenceRate),
    })),
  });

  // IND-418: turn the top eligible discriminator into a pool_discovery
  // question. QUESTIONER_ENABLED gates via questionerEnqueueIfEnabled;
  // budget + dedup enforcement lives in the QuestionerQueue worker.
  if (poolQuestionsMode() !== 'on' || !intentId) return;
  const enqueue = questionerEnqueueIfEnabled();
  if (!enqueue) return;
  const eligible = selectQuestionDiscriminators(shadow.discriminators);
  if (eligible.length === 0) {
    logger.debug('no discriminator cleared the question bar', {
      source: trigger.source,
      runId: trigger.runId ?? null,
      intentId,
    });
    return;
  }
  await enqueue({
    mode: 'pool_discovery',
    userId,
    sourceType: 'intent',
    sourceId: intentId,
    triggeredByIntentId: intentId,
    context: {
      intentId,
      intentText,
      poolSize: shadow.poolSize,
      ...(trigger.runId ? { runId: trigger.runId } : {}),
      minedAt: new Date().toISOString(),
      discriminators: eligible.map(toQuestionDiscriminator),
    },
  });
  logger.info('pool question enqueued', {
    source: trigger.source,
    runId: trigger.runId ?? null,
    intentId,
    eligible: eligible.length,
  });
}
