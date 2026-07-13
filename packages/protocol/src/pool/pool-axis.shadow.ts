/**
 * Shadow orchestrator: mine axes for a pool, embed them, score VoI, and
 * return the log payload (IND-417). No persistence, no questions, no UI —
 * P1 output is consumed only by structured logs for human review.
 */
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import type { EmbeddingGenerator } from "../shared/interfaces/embedder.interface.js";
import type { PoolAxisMiner } from "./pool-axis.miner.js";
import { computeNovelty, scoreAxis } from "./pool-axis.scorer.js";
import type { MinedAxis, PoolAxisCandidate, PoolAxisShadowResult } from "./pool-axis.types.js";

const logger = protocolLogger("PoolAxisShadow");

/** Max reference texts embedded for novelty (premises + intent sentences). */
const MAX_REFERENCE_TEXTS = 24;

/** Input for one shadow mining+scoring pass. */
export interface PoolAxisShadowInput {
  /** Intent payload (+ summary) or search query that produced the pool. */
  intentText: string;
  /** The pool (already filtered/capped by the caller). */
  candidates: PoolAxisCandidate[];
  /**
   * Novelty references: the intent owner's active premise texts and intent
   * sentences. An axis semantically equal to any reference scores ~0.
   */
  referenceTexts: string[];
  miner: Pick<PoolAxisMiner, "mine">;
  embedder: EmbeddingGenerator;
  signal?: AbortSignal;
}

/** Text embedded per axis for the novelty comparison. */
function axisEmbeddingText(axis: MinedAxis): string {
  return `${axis.axis} — ${axis.questionSeed}`;
}

/**
 * Runs miner → embeddings → scorer. Throws only when *mining* fails (callers
 * are fire-and-forget); embedding failures degrade to novelty = 1 for all
 * axes rather than dropping the pass.
 */
export async function runPoolAxisShadow(input: PoolAxisShadowInput): Promise<PoolAxisShadowResult> {
  const { candidates } = input;
  const mined = await input.miner.mine(
    { intentText: input.intentText, candidates },
    input.signal ? { signal: input.signal } : undefined,
  );
  if (mined.length === 0) {
    return { poolSize: candidates.length, axes: [] };
  }

  const references = input.referenceTexts
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, MAX_REFERENCE_TEXTS);

  let novelties: number[] = mined.map(() => 1);
  if (references.length > 0) {
    try {
      const texts = [...mined.map(axisEmbeddingText), ...references];
      const embeddings = (await input.embedder.generate(texts)) as number[][];
      const axisEmbeddings = embeddings.slice(0, mined.length);
      const referenceEmbeddings = embeddings.slice(mined.length);
      novelties = axisEmbeddings.map((e) => computeNovelty(e, referenceEmbeddings));
    } catch (err) {
      logger.warn("Novelty embedding failed; defaulting novelty to 1", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const axes = mined
    .map((axis, i) => scoreAxis(axis, candidates, novelties[i]))
    .sort((a, b) => b.voi - a.voi);

  return { poolSize: candidates.length, axes };
}
