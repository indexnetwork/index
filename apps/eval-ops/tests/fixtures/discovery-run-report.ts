/**
 * The first live discovery run, trimmed.
 *
 * Copied from services/api/eval/discovery/runs/2026-08-04T18-17-55-461Z.json
 * — a real artifact written by the engine and re-read through the ops server's
 * own `parseEvalArtifact`, so every key, shape and value type here is one the
 * browser really receives. The only edits are size: each case's `rawCandidates`
 * and `evaluatorTraces` keep 2 of their 4 entries. Nothing was added, renamed or
 * invented.
 *
 * Note what is NOT in it: there is no top-level `configs` or `configDiff`. The
 * governed envelope and scorecard schemas are `.strict()`
 * (packages/protocol/eval/shared/artifact.ts), so each side's configuration
 * reaches disk only on its case rows, as `configDeltas`. Deriving the difference
 * from those rows is what the run view has to do.
 */
import type { Artifact } from '../../src/api/client';

const REPORT = {
  artifactType: 'index-eval/run-report',
  harness: 'discovery' as const,
  harnessVersion: '1',
  createdAt: '2026-08-04T18:19:06.257Z',
  startedAt: '2026-08-04T18:18:02.406Z',
  completedAt: '2026-08-04T18:19:06.257Z',
  models: [
    'google/gemini-3-flash-preview',
    'google/gemini-2.5-flash'
  ],
  runs: 1,
  selection: {
    fullCorpus: false,
    filters: {
      case: 'historical/builder-and-operator'
    }
  },
  corpusFingerprint: '1b834b5d4dae2535d880bc6d61d0785ef0ca7392c83c092a41a697360427735d',
  configFingerprint: 'd7c4c83bfd62911969f8337c8c13fe6ff2ea54dd8eea6eb418db33de4a30fcd3',
  git: {
    revision: '06f4f83cd4df7974753fe3406d6065871e351620',
    dirty: false
  },
  schemaVersion: 2,
  source: 'run',
  completeness: {
    caseCount: 2,
    ruleCount: 2,
    totalRuns: 2,
    totalPasses: 2,
    flakyCaseCount: 0,
    requestedRuns: 2,
    completedRuns: 2,
    failedRuns: 0,
    recoveredRuns: 0,
    totalAttempts: 2,
    complete: true
  },
  execution: {
    policy: 'strict',
    runs: [
      {
        runId: 'historical%2Fbuilder-and-operator%2Fa%2Fr1::run:1',
        caseId: 'historical/builder-and-operator/a/r1',
        runIndex: 0,
        outcome: 'success',
        recovered: false,
        attempts: [
          {
            attemptId: 'historical%2Fbuilder-and-operator%2Fa%2Fr1::run:1::attempt:1',
            runId: 'historical%2Fbuilder-and-operator%2Fa%2Fr1::run:1',
            runIndex: 0,
            attemptNumber: 1,
            startedAt: '2026-08-04T18:18:08.461Z',
            completedAt: '2026-08-04T18:19:05.185Z',
            durationMs: 56724,
            outcome: 'success',
            retryable: false,
            backoffMs: 0
          }
        ]
      },
      {
        runId: 'historical%2Fbuilder-and-operator%2Fb%2Fr1::run:1',
        caseId: 'historical/builder-and-operator/b/r1',
        runIndex: 0,
        outcome: 'success',
        recovered: false,
        attempts: [
          {
            attemptId: 'historical%2Fbuilder-and-operator%2Fb%2Fr1::run:1::attempt:1',
            runId: 'historical%2Fbuilder-and-operator%2Fb%2Fr1::run:1',
            runIndex: 0,
            attemptNumber: 1,
            startedAt: '2026-08-04T18:18:08.332Z',
            completedAt: '2026-08-04T18:19:06.122Z',
            durationMs: 57790,
            outcome: 'success',
            retryable: false,
            backoffMs: 0
          }
        ]
      }
    ]
  },
  payload: {
    generatedAt: '2026-08-04T18:19:06.233Z',
    model: 'google/gemini-3-flash-preview',
    runs: 1,
    aggregatePassRate: 1,
    rules: [
      {
        rule: 'a',
        caseCount: 1,
        passRate: 1
      },
      {
        rule: 'b',
        caseCount: 1,
        passRate: 1
      }
    ],
    cases: [
      {
        caseId: 'historical/builder-and-operator/a/r1',
        rule: 'a',
        runs: 1,
        passes: 1,
        passRate: 1,
        flaky: false,
        scoredRunIds: [
          'historical%2Fbuilder-and-operator%2Fa%2Fr1::run:1'
        ],
        rowId: 'a',
        repetition: 0,
        passed: true,
        targetRank: 1,
        evidenceTypes: [
          'intent'
        ],
        configDeltas: [
          {
            key: 'DISCOVERY_ALLOWED_TYPES',
            before: null,
            after: 'intent'
          }
        ],
        assertions: [
          {
            kind: 'target_returned',
            passed: true,
            detail: 'expected target returned at rank 1'
          },
          {
            kind: 'excluded_absent',
            passed: true,
            detail: 'excluded targets absent'
          },
          {
            kind: 'fixture_ownership',
            passed: true,
            detail: 'all candidates are fixture-owned'
          },
          {
            kind: 'allowed_evidence',
            passed: true,
            detail: 'all evidence types are allowed'
          },
          {
            kind: 'completion',
            passed: true,
            detail: 'slot completed'
          },
          {
            kind: 'judge',
            passed: true,
            detail: 'judge approved'
          }
        ],
        candidates: [
          {
            id: 'eval-discovery-matrix-user-fe7f5c1b5049fb5467759af4',
            finalRank: 1,
            evidenceTypes: [
              'intent'
            ],
            evidenceIds: {
              candidateIntentId: 'eval-discovery-matrix-intent-5e1b82fd93e8affcfcc973ba'
            }
          }
        ],
        rawCandidates: [
          {
            id: 'eval-discovery-matrix-user-932c182c43d90822a5f223fd',
            retrievalRank: 1,
            evidenceTypes: [
              'intent'
            ],
            evidenceIds: {
              candidateIntentId: 'eval-discovery-matrix-intent-183f2f693db616dbd2153708'
            },
            rawText: ''
          },
          {
            id: 'eval-discovery-matrix-user-fa3fc9221e5650e9aac4e74f',
            retrievalRank: 2,
            evidenceTypes: [
              'intent'
            ],
            evidenceIds: {
              candidateIntentId: 'eval-discovery-matrix-intent-e8b74ff979b3fbf144f9fa86'
            },
            rawText: ''
          }
        ],
        evaluatorTraces: [
          {
            id: 'eval-discovery-matrix-user-932c182c43d90822a5f223fd',
            retrievalRank: 1,
            evaluatorReturned: false,
            evaluatorScore: null,
            finalIncluded: false,
            finalRank: null
          },
          {
            id: 'eval-discovery-matrix-user-fa3fc9221e5650e9aac4e74f',
            retrievalRank: 2,
            evaluatorReturned: false,
            evaluatorScore: null,
            finalIncluded: false,
            finalRank: null
          }
        ],
        judge: {
          passed: true
        }
      },
      {
        caseId: 'historical/builder-and-operator/b/r1',
        rule: 'b',
        runs: 1,
        passes: 1,
        passRate: 1,
        flaky: false,
        scoredRunIds: [
          'historical%2Fbuilder-and-operator%2Fb%2Fr1::run:1'
        ],
        rowId: 'b',
        repetition: 0,
        passed: true,
        targetRank: 1,
        evidenceTypes: [
          'premise'
        ],
        configDeltas: [
          {
            key: 'DISCOVERY_ALLOWED_TYPES',
            before: null,
            after: 'intent,profile'
          }
        ],
        assertions: [
          {
            kind: 'target_returned',
            passed: true,
            detail: 'expected target returned at rank 1'
          },
          {
            kind: 'excluded_absent',
            passed: true,
            detail: 'excluded targets absent'
          },
          {
            kind: 'fixture_ownership',
            passed: true,
            detail: 'all candidates are fixture-owned'
          },
          {
            kind: 'allowed_evidence',
            passed: true,
            detail: 'all evidence types are allowed'
          },
          {
            kind: 'completion',
            passed: true,
            detail: 'slot completed'
          },
          {
            kind: 'judge',
            passed: true,
            detail: 'judge approved'
          }
        ],
        candidates: [
          {
            id: 'eval-discovery-matrix-user-fe7f5c1b5049fb5467759af4',
            finalRank: 1,
            evidenceTypes: [
              'premise'
            ],
            evidenceIds: {
              candidatePremiseId: 'a0fb59ca-7e04-4bba-b293-e9b1bdd3044e'
            }
          }
        ],
        rawCandidates: [
          {
            id: 'eval-discovery-matrix-user-932c182c43d90822a5f223fd',
            retrievalRank: 1,
            evidenceTypes: [
              'premise'
            ],
            evidenceIds: {
              candidatePremiseId: '748b287c-efd9-41ae-bca7-c7a816aa1c59'
            },
            rawText: ''
          },
          {
            id: 'eval-discovery-matrix-user-fa3fc9221e5650e9aac4e74f',
            retrievalRank: 2,
            evidenceTypes: [
              'premise'
            ],
            evidenceIds: {
              candidatePremiseId: 'dec9cadd-727b-4182-b805-d999f828ac7b'
            },
            rawText: ''
          }
        ],
        evaluatorTraces: [
          {
            id: 'eval-discovery-matrix-user-932c182c43d90822a5f223fd',
            retrievalRank: 1,
            evaluatorReturned: false,
            evaluatorScore: null,
            finalIncluded: false,
            finalRank: null
          },
          {
            id: 'eval-discovery-matrix-user-fa3fc9221e5650e9aac4e74f',
            retrievalRank: 2,
            evaluatorReturned: false,
            evaluatorScore: null,
            finalIncluded: false,
            finalRank: null
          }
        ],
        judge: {
          passed: true
        }
      }
    ]
  }
};

/**
 * Assigned through a variable rather than annotated inline: the app's `Artifact`
 * type covers only the fields it renders, and an inline annotation would make
 * TypeScript reject the real rows for carrying the rest of what the engine
 * writes. The assignment still proves the fixture satisfies the type the app
 * reads, so a drift in either direction fails `tsc`.
 */
export const DISCOVERY_RUN_REPORT: Artifact = REPORT;
