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
  AbSides,
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

/**
 * The saved-config shape, re-exported from the ops core for the same reason as
 * the wire types above: one definition, compiler-enforced. `import type` is
 * erased, so the zod schema it is inferred from never enters the bundle.
 */
export type { ConfigProfile } from '../../../../packages/protocol/eval/ops/ops.profiles';

import type { ConfigProfile } from '../../../../packages/protocol/eval/ops/ops.profiles';
import type { HistoricalParticipantMetric, HistoricalQualityMeasurement, HistoricalStageFunnel } from '../../../../packages/protocol/eval/shared/artifact';

export type {
  HistoricalParticipantMetric,
  HistoricalQualityMeasurement,
  HistoricalStageFunnel,
} from '../../../../packages/protocol/eval/shared/artifact';

/**
 * Guided-configuration metadata shapes, re-exported from the ops core for the
 * same one-definition reason as the wire types above. ops.metadata.ts is a
 * dependency-free module (like ops.allowlist.ts), and these are `import type`
 * only — nothing from the protocol enters the bundle at runtime.
 */
export type {
  AgentMeta,
  EnvFlagMeta,
  FlagMeta,
  ModelMeta,
} from '../../../../packages/protocol/eval/ops/ops.metadata';

import type { AgentMeta, EnvFlagMeta, FlagMeta, ModelMeta } from '../../../../packages/protocol/eval/ops/ops.metadata';

/** Exactly what GET /api/configs/metadata serves. */
export interface ConfigMetadata {
  env: readonly EnvFlagMeta[];
  models: readonly ModelMeta[];
  harnessAgents: Record<OpsHarness, readonly AgentMeta[]>;
  flags: readonly FlagMeta[];
}

import type { HarnessDescriptor, IndexIssue, IndexResult, OpsHarness, RunRecord, RunSpec, RunStatus } from '../../../../packages/protocol/eval/ops/ops.types';

/**
 * The 202 from a launch: the run record, plus the keys a saved config set that
 * this harness does not read.
 *
 * `unreadEnvKeys` rides alongside the record and is present only when non-empty,
 * so a client that ignores it sees exactly the RunRecord it saw before. It is a
 * note, not an error — a saved config is harness-agnostic and may legitimately
 * carry a key this harness never reads because it is shared with one that does.
 */
export interface LaunchedRun extends RunRecord {
  unreadEnvKeys?: readonly string[];
}

export interface RunsResult {
  runs: RunRecord[];
  issues: IndexIssue[];
}

/**
 * One configuration value recorded on a case row.
 *
 * `before` is null when the configuration was applied around the call rather
 * than replacing an established value, which is what discovery does
 * (`abConfigDeltas`, services/api/src/cli/discovery.main.ts). For that
 * harness this is the ONLY on-disk record of what each side was: the governed
 * envelope and scorecard schemas are `.strict()`, so a run-level configuration
 * block has no legal home in them.
 */
export interface ArtifactConfigDelta {
  key: string;
  before: string | null;
  after: string | null;
}

/** One scored case within an artifact's payload. */
export interface ArtifactCase {
  caseId: string;
  rule: string;
  runs: number;
  passes: number;
  passRate: number;
  flaky: boolean;
  /**
   * Optional because only the harnesses that vary configuration write it. The
   * shared case schema is `.passthrough()`, so it survives the ops server's
   * `parseEvalArtifact` and reaches this app unchanged.
   */
  configDeltas?: ArtifactConfigDelta[];
  /**
   * Where the expected target came back in the final ordering, or null when it
   * did not come back at all.
   *
   * Not a trace: this and `evidenceTypes` are the outcome measures of retrieval
   * itself, which is exactly what a discovery run varies. A configuration
   * that keeps every case passing while pushing the target from rank 1 to rank 4
   * changed the retrieval outcome, and pass rates alone cannot say so.
   *
   * Optional for the same reason as `configDeltas`: only the discovery harnesses
   * write it, and it reaches this app through the `.passthrough()` case schema.
   */
  targetRank?: number | null;
  /** Which evidence the target was found through (`intent`, `premise`, …). */
  evidenceTypes?: string[];
}

/**
 * One rule's roll-up. For discovery a "rule" is a SIDE (`a` or `b`), because
 * the engine files each side as the row id every slot is aggregated under.
 */
export interface ArtifactRule {
  rule: string;
  caseCount: number;
  passRate: number;
}

/** One strict historical-quality transport row carried in payload.cases. */
export interface HistoricalQualityCase extends ArtifactCase {
  kind: 'historical-quality-pilot';
  logicalCaseId: string;
  trigger: 'intent' | 'enrichment';
  /** Zero-based repetition index on the wire. */
  repetition: number;
  configurationFingerprint: string;
  completed: boolean;
  participantMetrics: HistoricalParticipantMetric[];
  stageFunnel: HistoricalStageFunnel | null;
}

/**
 * Execution completeness, as the artifact states it.
 *
 * The first five fields exist on every artifact; the rest arrive with schema v2
 * (`EvalCompletenessV2Schema`), so they are optional here — a v1 artifact
 * records no attempt evidence and cannot be read as complete or incomplete.
 */
export interface ArtifactCompleteness {
  caseCount: number;
  ruleCount: number;
  totalRuns: number;
  totalPasses: number;
  flakyCaseCount: number;
  requestedRuns?: number;
  completedRuns?: number;
  failedRuns?: number;
  recoveredRuns?: number;
  totalAttempts?: number;
  complete?: boolean;
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
  /** Absent on schema-v1 artifacts, which carry no execution evidence. */
  completeness?: ArtifactCompleteness;
  /** Present only on descriptive V2 measurements, never ordinary scorecards. */
  measurement?: HistoricalQualityMeasurement;
  payload: {
    cases: ArtifactCase[];
    aggregatePassRate: number;
    rules?: ArtifactRule[];
  };
}

/** Browser-facing specialization selected only by measurement.kind. */
export interface HistoricalQualityArtifact extends Artifact {
  measurement: HistoricalQualityMeasurement & { kind: 'historical-quality-pilot' };
  payload: Omit<Artifact['payload'], 'cases'> & { cases: HistoricalQualityCase[] };
}

export function isHistoricalQualityArtifact(
  artifact: Artifact | null,
): artifact is HistoricalQualityArtifact {
  return artifact?.measurement?.kind === 'historical-quality-pilot';
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

/** One side of a run-vs-run comparison, labelled from its run record. */
export interface RunSide {
  id: string;
  profile: string;
  profileFingerprint: string;
  /** False when the run finished with incomplete execution evidence. */
  complete: boolean | null;
}

/**
 * What GET /api/compare?referenceRun=…&subjectRun=… serves: the same outcome
 * as artifact compare, plus the two runs' labels. `runs` is optional so a
 * CompareResult from artifact mode can be widened without a type lie.
 */
export type RunCompareResult = CompareResult & {
  runs?: { reference: RunSide; subject: RunSide };
};

/**
 * The two ways the server can tell this app that its session does not admit it.
 *
 * `GET /api/auth/status` is public and only ever answers `authenticated` true or
 * false, so it cannot report the domain refusal at all. The 403 in the HTTP
 * contract is produced in exactly one place — the server's auth gate, on a route
 * that requires a session — so a gated API call is the only surface where a
 * browser observes it. A sign-in the domain policy refuses never gets that far:
 * it is refused at /callback, which renders the server's own refusal page and
 * establishes no session, so this app is never loaded for that identity.
 *
 * The status code alone is not the signal. The same server answers 403 for a
 * cross-origin write, for a foreign `Host`, and for a fixture reset against a
 * database that is not disposable; showing "your account is not permitted" for
 * any of those would be a lie. The discriminator is the `permitted: false` field,
 * which only the auth gate sets.
 */
export type AuthRefusal = 'unauthenticated' | 'not-permitted';

const authRefusalListeners = new Set<(refusal: AuthRefusal) => void>();

/**
 * Subscribes to session refusals seen by any API call. Returns an unsubscribe.
 *
 * This exists so the shell can stop rendering the dashboard the moment a call
 * comes back refused, rather than leaving every route to render its own 401 as
 * an ordinary error message.
 */
export function onAuthRefusal(listener: (refusal: AuthRefusal) => void): () => void {
  authRefusalListeners.add(listener);
  return () => {
    authRefusalListeners.delete(listener);
  };
}

/** Publishes a refusal to every subscriber. */
function notifyAuthRefusal(refusal: AuthRefusal): void {
  for (const listener of authRefusalListeners) listener(refusal);
}

/** Returns the refusal a failed response reports, or null when it reports something else. */
function classifyAuthRefusal(status: number, body: unknown): AuthRefusal | null {
  if (typeof body !== 'object' || body === null) return null;
  const frame = body as { authenticated?: unknown; permitted?: unknown };
  if (status === 401 && frame.authenticated === false) return 'unauthenticated';
  if (status === 403 && frame.authenticated === true && frame.permitted === false) return 'not-permitted';
  return null;
}

/** Fetch helper that throws an Error containing the server's error field on non-2xx. */
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    const refusal = classifyAuthRefusal(response.status, body);
    if (refusal !== null) notifyAuthRefusal(refusal);
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  // A 204 (the config DELETE) has no body to parse; response.json() would throw.
  if (response.status === 204) return undefined as T;
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

/** PATCH helper; the JSON content type is the same anti-CSRF barrier as POST. */
async function patchJson<T>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** DELETE helper. The server answers 204 with no body. */
async function deleteJson(url: string): Promise<void> {
  await fetchJson<unknown>(url, { method: 'DELETE' });
}

/**
 * How this server expects a browser to prove who it is, as `POST /api/auth/login`
 * reports it.
 *
 * A discriminated union because the two postures are genuinely different
 * exchanges, not one exchange with optional fields:
 *
 *  - `bridge` — the local posture. Navigate to `url`: `<WEB_APP_URL>/cli-auth`
 *    mints a revocable API key against the operator's existing Index session and
 *    redirects it to the ops server's loopback `/callback`.
 *  - `token` — the deployed posture. The bridge cannot complete off loopback
 *    (`validateCliCallbackUrl` in apps/web accepts only `http:` on 127.0.0.1),
 *    so fetch a better-auth JWT from `${apiUrl}/api/auth/token` with the
 *    browser's own API cookie and post it to `POST /api/auth/session`, which
 *    resolves it server-side. `webAppUrl` is where the operator signs in to Index
 *    when the API says it has no session for them.
 *
 * The server sends exactly these fields. It is not a route that reports server
 * configuration in general, and it must not become one.
 */
export type SignInStart =
  | { kind: 'bridge'; url: string }
  | { kind: 'token'; apiUrl: string; webAppUrl: string };

export const api = {
  async authStatus(): Promise<{ authenticated: boolean; email?: string; name?: string }> {
    return fetchJson('/api/auth/status');
  },

  async login(): Promise<SignInStart> {
    return postJson('/api/auth/login', {});
  },

  /**
   * Submits a better-auth token and, if the server resolves it to a permitted
   * identity, receives the ops session cookie.
   *
   * The token is a bearer credential and this is its only use: it is passed in,
   * sent once, and never stored, rendered or logged. The server answers 401 when
   * the API rejects the token and 403 with `permitted: false` when the identity
   * behind it is not admitted — `fetchJson` publishes both through
   * `onAuthRefusal`, so the shell reacts the same way it does to any other
   * refusal.
   */
  async submitToken(token: string): Promise<{ authenticated: boolean; email?: string; name?: string }> {
    return postJson('/api/auth/session', { token });
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

  async configs(): Promise<{ repo: ConfigProfile[]; saved: ConfigProfile[] }> {
    return fetchJson('/api/configs');
  },

  async configMetadata(): Promise<ConfigMetadata> {
    return fetchJson('/api/configs/metadata');
  },

  async createConfig(profile: ConfigProfile): Promise<ConfigProfile> {
    return postJson('/api/configs', profile);
  },

  async updateConfig(
    name: string,
    patch: Partial<Omit<ConfigProfile, 'name'>>,
  ): Promise<ConfigProfile> {
    return patchJson(`/api/configs/${encodeURIComponent(name)}`, patch);
  },

  async deleteConfig(name: string): Promise<void> {
    await deleteJson(`/api/configs/${encodeURIComponent(name)}`);
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

  async launch(spec: RunSpec): Promise<LaunchedRun> {
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

  async compareRuns(referenceRun: string, subjectRun: string): Promise<RunCompareResult> {
    return fetchJson(
      `/api/compare?referenceRun=${encodeURIComponent(referenceRun)}&subjectRun=${encodeURIComponent(subjectRun)}`,
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
 *
 * The stream is gated like every other route, but `EventSource` exposes no status
 * code — a 401 arrives as the same bare `error` event as a dropped connection, so
 * it never reaches `fetchJson` and never reaches `onAuthRefusal`. A stream that
 * fails before any status frame is therefore checked against the public status
 * route: when nobody is signed in, the refusal is published here so the shell
 * demotes, instead of the run page reporting "no run with that id" for what is an
 * expired session and EventSource reconnecting against a 401 forever.
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
  let sawStatus = false;
  let probed = false;

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
      sawStatus = true;
      handlers.onStatus(record);
    } catch {
      // Malformed frame: ignore to keep the stream alive
    }
  });

  source.addEventListener('error', (event) => {
    // Once only, and only before a status frame: a mid-stream reconnect is an
    // ordinary drop, and probing on every retry would be a request loop of its own.
    if (!sawStatus && !probed) {
      probed = true;
      void publishRefusalIfSignedOut();
    }
    handlers.onError(event);
  });

  return () => source.close();
}

/**
 * Asks the public status route who is signed in, and publishes the refusal the
 * SSE stream could not report.
 *
 * Silent on anything else. A status call that fails or answers `authenticated:
 * true` says the stream failed for some other reason, and claiming a refusal
 * there would throw the operator out of a working session.
 */
async function publishRefusalIfSignedOut(): Promise<void> {
  try {
    const status = await api.authStatus();
    if (!status.authenticated) notifyAuthRefusal('unauthenticated');
  } catch {
    // Unanswerable is not refused: leave the stream's own error reporting alone.
  }
}
