/**
 * Typed API client for the local eval ops server.
 *
 * Every POST request sends Content-Type: application/json — this is a deliberate
 * anti-CSRF barrier, and the server answers 415 without it.
 */

/**
 * Wire types re-exported straight from the ops core.
 *
 * `ops.types.ts` is a zero-dependency pure-interface module, so `import type` is
 * fully erased at build time and nothing from the protocol enters the browser
 * bundle. Importing rather than re-declaring is deliberate: hand-maintained
 * mirrors of these interfaces drifted three separate times during this build,
 * and nothing in CI could catch it because a copy always typechecks against
 * itself. There is now exactly one definition and the compiler enforces it.
 */
export type {
  ArtifactRef,
  EvalRunSpec,
  FixtureResetSpec,
  HarnessDescriptor,
  HarnessFlag,
  HarnessFlagName,
  IndexIssue,
  IndexResult,
  OpsHarness,
  RunFlags,
  RunRecord,
  RunSpec,
  RunStatus,
  RunStepRecord,
} from '../../../../packages/protocol/eval/ops/ops.types';

import type { HarnessDescriptor, IndexIssue, IndexResult, OpsHarness, RunRecord, RunSpec, RunStatus } from '../../../../packages/protocol/eval/ops/ops.types';

export interface RunsResult {
  runs: RunRecord[];
  issues: IndexIssue[];
}

/** One scored case within an artifact's payload. */
export interface ArtifactCase {
  caseId: string;
  rule: string;
  runs: number;
  passes: number;
  passRate: number;
  flaky: boolean;
}

/**
 * The parts of a stored eval artifact this app renders. The envelope carries more
 * (see packages/protocol/eval/shared/artifact.ts); these are the fields the
 * scorecard and provenance views read.
 */
export interface Artifact {
  artifactType: string;
  schemaVersion: number;
  harness: OpsHarness;
  harnessVersion: string;
  createdAt: string;
  models: string[];
  runs: number;
  selection: { fullCorpus: boolean; filters: Record<string, string> };
  corpusFingerprint: string;
  configFingerprint: string;
  git: { revision: string; dirty: boolean | null };
  payload: {
    cases: ArtifactCase[];
    aggregatePassRate: number;
  };
}

const TERMINAL_STATUSES: readonly RunStatus[] = [
  'passed',
  'regression',
  'execution-error',
  'insufficient-evidence',
  'cancelled',
  'interrupted',
  'crashed',
];

/** True once a run can produce no further output. Mirrors the server's TERMINAL set. */
export function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * Encodes a path relative to eval/ as an artifact id.
 *
 * Must stay byte-identical to encodeArtifactId in
 * packages/protocol/eval/ops/ops.artifacts.ts — an id produced here is resolved
 * there. Pinned by a parity test in tests/client.test.ts.
 */
export function encodeArtifactId(relPath: string): string {
  return btoa(relPath).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export interface FixtureTarget {
  databaseName: string;
  host: string;
  redactedUrl?: string;
}

export interface FixtureStatusAllowed {
  allowed: true;
  target: FixtureTarget;
  maxPersonas: number;
  appliesMigrationsOnReset: boolean;
  seedApiKeysPath: string;
  personaCount: number | null;
  personaEmails: string[] | null;
  tables: Record<string, number> | null;
  countsError: string | null;
}

export interface FixtureStatusRefused {
  allowed: false;
  reason: string;
}

export type FixtureStatus = FixtureStatusAllowed | FixtureStatusRefused;

/**
 * Exactly what GET /api/profiles serves: the committed ConfigProfile from
 * packages/protocol/eval/ops/ops.profiles.ts. The fingerprint lives on
 * ResolvedProfile, which that route does not return, so it is deliberately absent.
 */
export interface ProfileDescriptor {
  name: string;
  description: string;
  models: Record<string, string>;
  env: Record<string, string>;
}

export interface Regression {
  id: string;
  kind: 'case' | 'rule';
  before: number;
  after: number;
  /** One-sided posterior-predictive p-value for the current pass count or lower under the baseline. */
  pValue: number;
}

export interface BaselineDiff {
  regressions: Regression[];
  skippedCaseIds: string[];
  addedCaseIds: string[];
  removedCaseIds: string[];
  unscoredCaseIds: string[];
}

export interface ComparabilityFinding {
  dimension: 'harness' | 'corpusFingerprint' | 'configFingerprint' | 'selection';
  reference: string;
  subject: string;
}

export type CompareResult =
  | { comparable: false; findings: ComparabilityFinding[] }
  | {
      comparable: true;
      regressions: BaselineDiff;
      improvements: BaselineDiff;
      aggregate: { reference: number; subject: number; delta: number };
    };

/** Fetch helper that throws an Error containing the server's error field on non-2xx. */
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return response.json();
}

/** POST helper that always sends Content-Type: application/json. */
async function postJson<T>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const api = {
  async authStatus(): Promise<{ authenticated: boolean; email?: string; name?: string }> {
    return fetchJson('/api/auth/status');
  },

  async login(): Promise<{ url: string }> {
    return postJson('/api/auth/login', {});
  },

  async logout(): Promise<void> {
    await postJson('/api/auth/logout', {});
  },

  async harnesses(): Promise<{ harnesses: HarnessDescriptor[] }> {
    return fetchJson('/api/harnesses');
  },

  async profiles(): Promise<{ profiles: ProfileDescriptor[] }> {
    return fetchJson('/api/profiles');
  },

  async artifacts(): Promise<IndexResult> {
    return fetchJson('/api/artifacts');
  },

  async artifact(id: string): Promise<Artifact> {
    return fetchJson(`/api/artifacts/${id}`);
  },

  async runs(): Promise<RunsResult> {
    return fetchJson('/api/runs');
  },

  async launch(spec: RunSpec): Promise<RunRecord> {
    return postJson('/api/runs', spec);
  },

  async cancel(id: string): Promise<{ run: RunRecord; accepted: boolean }> {
    return postJson(`/api/runs/${id}/cancel`, {});
  },

  async fixture(): Promise<FixtureStatus> {
    return fetchJson('/api/fixture');
  },

  async reset(input: {
    confirmDatabaseName: string;
    personas: number;
  }): Promise<RunRecord> {
    return postJson('/api/fixture/reset', input);
  },

  async compare(reference: string, subject: string): Promise<CompareResult> {
    return fetchJson(
      `/api/compare?reference=${encodeURIComponent(reference)}&subject=${encodeURIComponent(subject)}`,
    );
  },
};

/**
 * Subscribes to a run's SSE stream. Returns an unsubscribe function.
 *
 * The server's SSE stream replays the log from byte 0 and then follows, emitting
 * both log and status events. The server JSON-encodes all event data, so both log
 * chunks and status records require parsing.
 *
 * EventSource will auto-reconnect on network failures. Each reconnect replays from
 * byte 0, so consumers may see duplicate log lines. The stream ends when the run
 * reaches a terminal status.
 */
export function subscribeToRun(
  id: string,
  handlers: {
    onLog: (chunk: string) => void;
    onStatus: (status: RunRecord) => void;
    onError: (event: Event) => void;
  },
): () => void {
  const source = new EventSource(`/api/runs/${id}/stream`);

  source.addEventListener('log', (event) => {
    try {
      const chunk = JSON.parse((event as MessageEvent<string>).data);
      handlers.onLog(chunk);
    } catch {
      // Malformed frame: ignore to keep the stream alive
    }
  });

  source.addEventListener('status', (event) => {
    try {
      const record = JSON.parse((event as MessageEvent<string>).data);
      handlers.onStatus(record);
    } catch {
      // Malformed frame: ignore to keep the stream alive
    }
  });

  source.addEventListener('error', (event) => {
    handlers.onError(event);
  });

  return () => source.close();
}
