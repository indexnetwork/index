/**
 * Typed API client for the local eval ops server.
 *
 * Every POST request sends Content-Type: application/json — this is a deliberate
 * anti-CSRF barrier, and the server answers 415 without it.
 */

/** Local type aliases from packages/protocol/eval/ops/ops.types.ts */
export type OpsHarness = 'matching' | 'profile' | 'premise' | 'opportunity';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'regression'
  | 'execution-error'
  | 'insufficient-evidence'
  | 'cancelled'
  | 'interrupted'
  | 'crashed';

export interface HarnessDescriptor {
  harness: OpsHarness;
  script: string;
  flags: readonly unknown[];
  defaultRuns: number;
  caseCount: number;
}

export interface ArtifactRef {
  id: string;
  harness: OpsHarness;
  kind: 'baseline' | 'run';
  path: string;
  schemaVersion?: number;
  createdAt: string;
  models: string[];
  runs: number;
  selection?: { fullCorpus: boolean; filters: Record<string, string> };
  git?: { revision: string; dirty: boolean | null };
  corpusFingerprint?: string;
  configFingerprint?: string;
  aggregatePassRate: number;
  caseCount: number;
  complete?: boolean | null;
  sizeBytes?: number;
  mtimeMs?: number;
}

export interface IndexIssue {
  path: string;
  message: string;
}

export interface IndexResult {
  refs: ArtifactRef[];
  issues: IndexIssue[];
}

export interface RunFlags {
  runs?: number;
  case?: string;
  rule?: string;
  tier?: number;
  noJudge?: boolean;
  alpha?: number;
  attemptTimeoutMs?: number;
  strictEvidence?: boolean;
}

export interface EvalRunSpec {
  kind: 'eval';
  harness: OpsHarness;
  profile: string;
  flags: RunFlags;
}

export interface FixtureResetSpec {
  kind: 'fixture-reset';
  personas: number;
  migrate: boolean;
  databaseName: string;
}

export type RunSpec = EvalRunSpec | FixtureResetSpec;

export interface RunStepRecord {
  label: string;
  argv: string[];
  cwd: string;
}

export interface RunRecord {
  id: string;
  spec: RunSpec;
  argv: string[];
  steps?: RunStepRecord[];
  env: Record<string, string>;
  profileFingerprint: string;
  experimental: boolean;
  status: RunStatus;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  pid: number | null;
  artifactPath: string | null;
  workload: number;
}

export interface RunsResult {
  runs: RunRecord[];
  issues: IndexIssue[];
}

export interface FixtureTarget {
  databaseName: string;
  redactedUrl?: string;
}

export interface FixtureStatusAllowed {
  allowed: true;
  target: FixtureTarget;
  maxPersonas: number;
  appliesMigrationsOnReset: boolean;
  personaCount: number | null;
  personaEmails: number | null;
  tables: Record<string, number> | null;
  countsError: string | null;
}

export interface FixtureStatusRefused {
  allowed: false;
  reason: string;
}

export type FixtureStatus = FixtureStatusAllowed | FixtureStatusRefused;

export interface ProfileDescriptor {
  name: string;
  models: string[];
  temperature?: number;
  maxOutputTokens?: number;
  fingerprint: string;
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
  async harnesses(): Promise<{ harnesses: HarnessDescriptor[] }> {
    return fetchJson('/api/harnesses');
  },

  async profiles(): Promise<{ profiles: ProfileDescriptor[] }> {
    return fetchJson('/api/profiles');
  },

  async artifacts(): Promise<IndexResult> {
    return fetchJson('/api/artifacts');
  },

  async artifact(id: string): Promise<unknown> {
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
    return fetchJson(`/api/compare?reference=${reference}&subject=${subject}`);
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
