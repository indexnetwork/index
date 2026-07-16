import { createHash } from 'node:crypto';

import { CREDENTIAL_ORGANIZATION_EXCLUSIVITY_CASES } from './cases/credential-organization-exclusivity.cases.js';
import { ENTITY_LOCATION_SUBSTITUTION_CASES } from './cases/entity-location-substitution.cases.js';
import { HYDE_CORPUS_MANIFEST } from './cases/hyde.corpus.manifest.js';
import { PROFILE_CONTEXT_CONTAMINATION_CASES } from './cases/profile-context-contamination.cases.js';
import { ROLE_POLARITY_CONTROLS_CASES } from './cases/role-polarity-controls.cases.js';
import { TIME_NUMERIC_SCALE_CASES } from './cases/time-numeric-scale.cases.js';
import { USER_CONTEXT_CASES } from './cases/user-context.cases.js';
import { HYDE_BACKGROUND_SOURCE_GRAPH_MAPPING, HYDE_CORPUS_VERSION, HYDE_EXPECTED_CANDIDATE_COUNT, HYDE_EXPECTED_CANDIDATES_PER_CASE, HYDE_EXPECTED_CASE_COUNT, HYDE_EXPECTED_SOURCE_CASE_COUNTS, HYDE_MIN_CASES_PER_STRATUM } from './hyde.policy.js';
import { HYDE_EVAL_STRATA, type HydeEvalCase } from './hyde.types.js';

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => compareAscii(left, right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

/** Stable content fingerprint for the ordered authored corpus. */
export function fingerprintHydeCorpus(cases: readonly HydeEvalCase[]): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(cases))).digest('hex');
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Frozen construction corpus. Authored grades are corpus-building labels only;
 * canonical run metrics will consume independently resolved human grades.
 */
export const HYDE_CASES: HydeEvalCase[] = freezeDeep([
  ...PROFILE_CONTEXT_CONTAMINATION_CASES,
  ...ENTITY_LOCATION_SUBSTITUTION_CASES,
  ...TIME_NUMERIC_SCALE_CASES,
  ...CREDENTIAL_ORGANIZATION_EXCLUSIVITY_CASES,
  ...ROLE_POLARITY_CONTROLS_CASES,
  ...USER_CONTEXT_CASES,
]);

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Invalid frozen HyDE corpus: ${message}`);
}

/** Validate all corpus invariants and enforce the reviewed fingerprint manifest. */
export function assertFrozenHydeCorpus(cases: readonly HydeEvalCase[] = HYDE_CASES): void {
  invariant(cases.length === HYDE_EXPECTED_CASE_COUNT, `expected ${HYDE_EXPECTED_CASE_COUNT} cases, got ${cases.length}`);
  invariant(HYDE_CORPUS_MANIFEST.corpusVersion === HYDE_CORPUS_VERSION, 'manifest corpus version is stale');

  const caseIds = cases.map((candidate) => candidate.id);
  invariant(new Set(caseIds).size === caseIds.length, 'case IDs must be globally unique');
  invariant(
    JSON.stringify(caseIds) === JSON.stringify(HYDE_CORPUS_MANIFEST.orderedCaseIds),
    'ordered case IDs differ from the committed manifest',
  );

  const candidateIds = cases.flatMap((candidate) => candidate.candidates.map((entry) => entry.id));
  invariant(new Set(candidateIds).size === candidateIds.length, 'candidate IDs must be globally unique');
  invariant(
    JSON.stringify(candidateIds) === JSON.stringify(HYDE_CORPUS_MANIFEST.orderedCandidateIds),
    'ordered candidate IDs differ from the committed manifest',
  );

  for (const stratum of HYDE_EVAL_STRATA) {
    const count = cases.filter((candidate) => candidate.stratum === stratum).length;
    invariant(count >= HYDE_MIN_CASES_PER_STRATUM, `stratum ${stratum} must contain at least ${HYDE_MIN_CASES_PER_STRATUM} cases, got ${count}`);
  }
  for (const [backgroundSource, expectedCount] of Object.entries(HYDE_EXPECTED_SOURCE_CASE_COUNTS)) {
    const count = cases.filter((candidate) => candidate.backgroundSource === backgroundSource).length;
    invariant(count === expectedCount, `background source ${backgroundSource} must contain ${expectedCount} cases, got ${count}`);
  }

  for (const c of cases) {
    invariant(c.id.startsWith(`${c.stratum}/`), `${c.id} must be prefixed by its stratum`);
    invariant(c.description.trim().length > 0, `${c.id} has an empty description`);
    invariant(c.sourceText.trim().length > 0, `${c.id} has empty source text`);
    invariant(c.backgroundSource in HYDE_BACKGROUND_SOURCE_GRAPH_MAPPING, `${c.id} has invalid background source`);
    invariant(c.candidates.length === HYDE_EXPECTED_CANDIDATES_PER_CASE, `${c.id} must have ${HYDE_EXPECTED_CANDIDATES_PER_CASE} candidates`);
    if (c.backgroundSource === 'user-context') {
      invariant(c.profileContext === undefined, `${c.id} user-context case cannot have profileContext`);
      invariant(c.stratum !== 'profile-context-contamination', `${c.id} user-context case cannot use profile-context-contamination`);
      invariant(c.candidates.every((candidate) => candidate.corpus === 'intents'), `${c.id} user-context candidates must all use intents corpus`);
    }

    const positives = c.candidates.filter((candidate) => candidate.relevanceGrade > 0);
    const hardNegatives = c.candidates.filter((candidate) => candidate.role === 'hard-negative');
    invariant(positives.length === 2 || positives.length === 3, `${c.id} must have exactly 2 or 3 positives`);
    invariant(positives.some((candidate) => candidate.relevanceGrade === 3), `${c.id} needs at least one grade-3 positive`);
    invariant(hardNegatives.length >= 4, `${c.id} needs at least four hard negatives`);

    const positiveIds = new Set(positives.map((candidate) => candidate.id));
    for (const candidate of c.candidates) {
      invariant(candidate.id.startsWith(`${c.id}/`), `${candidate.id} must be namespaced to ${c.id}`);
      invariant(candidate.text.trim().length > 0, `${candidate.id} has empty text`);
      invariant(candidate.corpus === 'intents' || candidate.corpus === 'premises', `${candidate.id} has invalid corpus`);

      if (candidate.role === 'positive') {
        invariant(candidate.relevanceGrade > 0, `${candidate.id} positive must have grade 1-3`);
        invariant(candidate.hardNegativeOf === undefined, `${candidate.id} positive cannot link as a hard negative`);
      } else if (candidate.role === 'hard-negative') {
        invariant(candidate.relevanceGrade === 0, `${candidate.id} hard negative must have grade 0`);
        invariant(candidate.hardNegativeOf !== undefined, `${candidate.id} needs hardNegativeOf metadata`);
        invariant(
          positiveIds.has(candidate.hardNegativeOf.positiveCandidateId),
          `${candidate.id} must link to a positive in the same case`,
        );
        invariant(candidate.hardNegativeOf.axis.trim().length > 0, `${candidate.id} needs a hard-negative axis`);
        invariant(candidate.hardNegativeOf.rationale.trim().length > 0, `${candidate.id} needs a hard-negative rationale`);
      } else {
        invariant(candidate.relevanceGrade === 0, `${candidate.id} distractor must have grade 0`);
        invariant(candidate.hardNegativeOf === undefined, `${candidate.id} distractor cannot link as a hard negative`);
      }
    }
  }

  invariant(candidateIds.length === HYDE_EXPECTED_CANDIDATE_COUNT, `expected ${HYDE_EXPECTED_CANDIDATE_COUNT} candidates, got ${candidateIds.length}`);
  invariant(cases.some((c) => c.candidates.some((candidate) => candidate.corpus === 'intents')), 'intents corpus is absent');
  invariant(cases.some((c) => c.candidates.some((candidate) => candidate.corpus === 'premises')), 'premises corpus is absent');

  const fingerprint = fingerprintHydeCorpus(cases);
  invariant(
    fingerprint === HYDE_CORPUS_MANIFEST.fingerprint,
    `fingerprint ${fingerprint} differs from committed manifest ${HYDE_CORPUS_MANIFEST.fingerprint}`,
  );
}

export const HYDE_CORPUS_FINGERPRINT = fingerprintHydeCorpus(HYDE_CASES);

// Fail immediately on accidental corpus edits; manifest updates are review-only.
assertFrozenHydeCorpus(HYDE_CASES);
