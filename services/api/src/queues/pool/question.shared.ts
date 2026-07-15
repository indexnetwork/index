/**
 * Shared pool_discovery question construction (IND-418).
 *
 * Used by the QuestionerQueue worker (initial question after a mining pass)
 * and the answer-reaction handler (interview-mode chaining). Synthesis is
 * deterministic — `synthesizePoolQuestion` in @indexnetwork/protocol — and
 * the mined pool snapshot (assignments + remaining alternates) rides along
 * in `detection.pool`, which the client read paths strip.
 */
import { synthesizePoolQuestion } from '@indexnetwork/protocol';
import type { QuestionPoolDiscriminator } from '@indexnetwork/protocol';

import type { AdapterPersistableQuestion, QuestionerAdapter } from '../../adapters/questioner.adapter';
import { QuestionEvents } from '../../events/question.event';

/** Normalized form used for axis dedup (re-asking an already-seen axis). */
export function normalizePoolLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Drops discriminators whose label was already asked for this intent. */
export function dedupDiscriminators(
  discriminators: QuestionPoolDiscriminator[],
  askedLabels: string[],
): QuestionPoolDiscriminator[] {
  const asked = new Set(askedLabels.map(normalizePoolLabel));
  return discriminators.filter((d) => !asked.has(normalizePoolLabel(d.label)));
}

/** Input for building one persistable pool question. */
export interface BuildPoolQuestionInput {
  userId: string;
  intentId: string;
  poolSize: number;
  /** ISO-8601 timestamp of the mining pass. */
  minedAt: string;
  runId?: string;
  /** Intent payload snippet — folds into the evidence chip so the card self-identifies on any surface. */
  intentText?: string;
  /** VoI-descending, deduped: first entry is asked, the rest become alternates. */
  discriminators: QuestionPoolDiscriminator[];
}

/** Builds the persistable row, or null when synthesis declines (guards). */
export function buildPoolQuestion(input: BuildPoolQuestionInput): AdapterPersistableQuestion | null {
  const [top, ...alternates] = input.discriminators;
  if (!top) return null;
  const synthesized = synthesizePoolQuestion({
    discriminator: top,
    alternates,
    poolSize: input.poolSize,
    minedAt: input.minedAt,
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.intentText ? { intentText: input.intentText } : {}),
  });
  if (!synthesized) return null;
  return {
    detection: {
      mode: 'pool_discovery',
      sourceType: 'intent',
      sourceId: input.intentId,
      triggeredBy: input.intentId,
      timestamp: new Date().toISOString(),
      pool: synthesized.pool,
    },
    actors: [{ userId: input.userId, role: 'subject' }],
    payload: synthesized.payload,
    strategy: 'refine_intent',
  };
}

/** Persists one pool question and fires the created event. Returns the id. */
export async function persistPoolQuestion(
  adapter: Pick<QuestionerAdapter, 'persist'>,
  question: AdapterPersistableQuestion,
  userId: string,
): Promise<string | null> {
  const [id] = await adapter.persist([question]);
  if (!id) return null;
  QuestionEvents.onCreated({
    questionId: id,
    userId,
    mode: question.detection.mode,
    sourceType: question.detection.sourceType,
    sourceId: question.detection.sourceId,
  });
  return id;
}
