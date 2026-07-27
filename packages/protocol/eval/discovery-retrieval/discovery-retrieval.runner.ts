import { executeRuns, type EvalEvidencePolicy, type EvalRunBatch } from "../shared/index.js";
import { RETRIEVAL_EVAL_ATTEMPT_TIMEOUT_MS, RETRIEVAL_EVAL_MAX_ATTEMPTS, RETRIEVAL_EVAL_RETRY_DELAY_MS } from "./discovery-retrieval.constants.js";
import type { DiscoveryRetrievalCase, ProfileRepresentation, RankedUser, RetrievalMode } from "./discovery-retrieval.types.js";

/** Minimal embedding seam so provider-free specs never construct a real client. */
export interface EmbedderLike {
  generate(texts: string[]): Promise<number[][]>;
}

/** Minimal HyDE seam; the CLI adapts the real protocol graph to this shape. */
export interface HydeLike {
  invoke(input: {
    sourceType: "query";
    sourceText: string;
    forceRegenerate: boolean;
  }): Promise<{ hydeEmbeddings: Record<string, number[]> }>;
}

export interface CandidateDocument {
  userId: string;
  representation: ProfileRepresentation;
  text: string;
  embedding: number[];
}

export interface CaseCandidateDocuments {
  premiseDocuments: CandidateDocument[];
  contextDocuments: CandidateDocument[];
}

export interface ModeRunOutput {
  mode: RetrievalMode;
  ranking: RankedUser[];
}

export interface RunModeInput {
  mode: RetrievalMode;
  c: DiscoveryRetrievalCase;
  hyde: HydeLike;
  embedder: EmbedderLike;
  documents?: CaseCandidateDocuments;
}

export interface RunCaseOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
  attemptTimeoutMs?: number;
  policy?: EvalEvidencePolicy;
  signal?: AbortSignal;
}

export interface CaseRunBatches {
  batches: Record<RetrievalMode, EvalRunBatch<ModeRunOutput>>;
}

const MODES: RetrievalMode[] = ["intent_to_premise", "intent_to_context", "context_to_context"];

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cosine(left: number[], right: number[]): number {
  if (left.length !== right.length) {
    throw new Error(`Cannot rank embeddings with different dimensions (${left.length} and ${right.length})`);
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  return leftMagnitude === 0 || rightMagnitude === 0 ? 0 : dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

/** Build one document per premise and exactly one document per candidate context. */
export async function buildCaseCandidateDocuments(
  c: DiscoveryRetrievalCase,
  embedder: EmbedderLike,
): Promise<CaseCandidateDocuments> {
  const premiseInputs = c.candidates.flatMap((candidate) =>
    candidate.premises.map((text) => ({ userId: candidate.userId, representation: "premise" as const, text })),
  );
  const contextInputs = c.candidates.map((candidate) => ({
    userId: candidate.userId,
    representation: "user_context" as const,
    text: candidate.userContext,
  }));
  const [premiseEmbeddings, contextEmbeddings] = await Promise.all([
    embedder.generate(premiseInputs.map((document) => document.text)),
    embedder.generate(contextInputs.map((document) => document.text)),
  ]);
  if (premiseEmbeddings.length !== premiseInputs.length || contextEmbeddings.length !== contextInputs.length) {
    throw new Error(`Candidate embedding count mismatch for ${c.id}`);
  }
  return {
    premiseDocuments: premiseInputs.map((document, index) => ({ ...document, embedding: premiseEmbeddings[index]! })),
    contextDocuments: contextInputs.map((document, index) => ({ ...document, embedding: contextEmbeddings[index]! })),
  };
}

/**
 * Rank documents in memory using each user's best matching document. Equal scores
 * are resolved by user ID so rankings do not depend on provider/object iteration.
 */
export function rankAcrossQueries(
  queryEmbeddings: readonly number[][],
  documents: readonly CandidateDocument[],
  topK: number,
): RankedUser[] {
  const bestByUser = new Map<string, { score: number; text: string; representation: ProfileRepresentation }>();
  for (const queryEmbedding of queryEmbeddings) {
    for (const document of documents) {
      const score = cosine(queryEmbedding, document.embedding);
      const prior = bestByUser.get(document.userId);
      if (!prior || score > prior.score) {
        bestByUser.set(document.userId, { score, text: document.text, representation: document.representation });
      }
    }
  }
  return [...bestByUser.entries()]
    .map(([userId, result]) => ({ userId, ...result }))
    .sort((left, right) => right.score - left.score || compareIds(left.userId, right.userId))
    .slice(0, topK);
}

/** Rank one source embedding against one representation pool. */
export function rankDocuments(
  sourceEmbedding: number[],
  documents: readonly CandidateDocument[],
  topK: number,
): RankedUser[] {
  return rankAcrossQueries([sourceEmbedding], documents, topK);
}

/** Execute exactly one retrieval representation/mode. */
export async function runMode(input: RunModeInput): Promise<ModeRunOutput> {
  const documents = input.documents ?? await buildCaseCandidateDocuments(input.c, input.embedder);
  if (input.mode === "context_to_context") {
    const [sourceEmbedding] = await input.embedder.generate([input.c.source.userContext]);
    if (!sourceEmbedding) throw new Error(`Source context embedding missing for ${input.c.id}`);
    return {
      mode: input.mode,
      ranking: rankDocuments(sourceEmbedding, documents.contextDocuments, input.c.expect.topK),
    };
  }

  const generated = await input.hyde.invoke({
    sourceType: "query",
    sourceText: input.c.source.intent,
    forceRegenerate: true,
  });
  const queryEmbeddings = Object.values(generated.hydeEmbeddings).filter((embedding) => embedding.length > 0);
  if (queryEmbeddings.length === 0) throw new Error(`HyDE returned no query embeddings for ${input.c.id}`);
  return {
    mode: input.mode,
    ranking: rankAcrossQueries(
      queryEmbeddings,
      input.mode === "intent_to_premise" ? documents.premiseDocuments : documents.contextDocuments,
      input.c.expect.topK,
    ),
  };
}

/** Run all three retrieval modes, embedding candidates within every governed attempt. */
export async function runCase(
  deps: { hyde: HydeLike; embedder: EmbedderLike },
  c: DiscoveryRetrievalCase,
  runs: number,
  options: RunCaseOptions = {},
): Promise<CaseRunBatches> {
  const settings = {
    maxAttempts: options.maxAttempts ?? RETRIEVAL_EVAL_MAX_ATTEMPTS,
    retryDelayMs: options.retryDelayMs ?? RETRIEVAL_EVAL_RETRY_DELAY_MS,
    attemptTimeoutMs: options.attemptTimeoutMs ?? RETRIEVAL_EVAL_ATTEMPT_TIMEOUT_MS,
    policy: options.policy,
    signal: options.signal,
    label: "discovery retrieval eval",
  };
  const batches = {} as Record<RetrievalMode, EvalRunBatch<ModeRunOutput>>;
  for (const mode of MODES) {
    batches[mode] = await executeRuns(
      () => runMode({ mode, c, hyde: deps.hyde, embedder: deps.embedder }),
      runs,
      { ...settings, caseId: `${c.id}/${mode}` },
    );
  }
  return { batches };
}
