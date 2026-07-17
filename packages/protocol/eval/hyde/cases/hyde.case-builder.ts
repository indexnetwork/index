import type { HydeBackgroundSource, HydeEvalCandidate, HydeEvalCase, HydeEvalStratum } from '../hyde.types.js';

export interface CandidateDraft {
  text: string;
  corpus: 'intents' | 'premises';
}

export interface HardNegativeDraft extends CandidateDraft {
  positive: 1 | 2;
  axis: string;
  rationale: string;
}

export interface FrozenCaseDraft {
  id: string;
  stratum: HydeEvalStratum;
  backgroundSource?: HydeBackgroundSource;
  description: string;
  sourceText: string;
  profileContext?: string;
  positives: readonly [CandidateDraft, CandidateDraft];
  hardNegatives: readonly [HardNegativeDraft, HardNegativeDraft, HardNegativeDraft, HardNegativeDraft];
  distractors: readonly [CandidateDraft, CandidateDraft, CandidateDraft, CandidateDraft];
}

/** Build stable candidate IDs without hiding any authored relevance decision. */
export function buildFrozenCase(draft: FrozenCaseDraft): HydeEvalCase {
  const positiveIds = [`${draft.id}/positive-1`, `${draft.id}/positive-2`] as const;
  const positives: HydeEvalCandidate[] = draft.positives.map((candidate, index) => ({
    id: positiveIds[index],
    role: 'positive',
    relevanceGrade: index === 0 ? 3 : 2,
    ...candidate,
  }));
  const hardNegatives: HydeEvalCandidate[] = draft.hardNegatives.map((candidate, index) => ({
    id: `${draft.id}/hard-negative-${index + 1}`,
    role: 'hard-negative',
    relevanceGrade: 0,
    corpus: candidate.corpus,
    text: candidate.text,
    hardNegativeOf: {
      positiveCandidateId: positiveIds[candidate.positive - 1],
      axis: candidate.axis,
      rationale: candidate.rationale,
    },
  }));
  const distractors: HydeEvalCandidate[] = draft.distractors.map((candidate, index) => ({
    id: `${draft.id}/distractor-${index + 1}`,
    role: 'distractor',
    relevanceGrade: 0,
    ...candidate,
  }));

  return {
    id: draft.id,
    stratum: draft.stratum,
    backgroundSource: draft.backgroundSource ?? 'saved-intent',
    description: draft.description,
    sourceText: draft.sourceText,
    ...(draft.profileContext ? { profileContext: draft.profileContext } : {}),
    candidates: [...positives, ...hardNegatives, ...distractors],
  };
}
