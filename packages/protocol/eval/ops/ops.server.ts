/**
 * The local JSON + SSE API over the eval ops core.
 *
 * This module is the trust boundary. The browser sends typed specs and profile
 * NAMES; it never sends argv, environment, shell strings or connection strings,
 * and a request carrying any of those fails validation instead of being ignored.
 * Nothing that leaves here contains a credential.
 *
 * There is no authentication: any process on this machine may drive this server.
 * That is an operator-trust decision about LOCAL processes, and it is not the same
 * thing as being drivable by any web page the operator happens to have open, so
 * state-changing requests are refused unless they are same-origin (see
 * `crossOriginRefusal`) and carry a JSON content type.
 */
import path from "node:path";

import { z } from "zod";

import { renderRun, RunSpecSchema } from "./ops.argv.js";
import { decodeArtifactId, FsArtifactSource, type ArtifactSource } from "./ops.artifacts.js";
import { compareArtifacts } from "./ops.compare.js";
import { LocalProcessRunExecutor, tailLog, type ExecutionStep, type RunExecutor } from "./ops.executor.js";
import { assessFixtureTarget, BunSqlFixtureInspector, buildResetPipeline, MAX_PERSONAS, redactDatabaseUrl, scrubCredentials, SEED_STEP_CWD, type FixtureInspector, type FixtureTarget } from "./ops.fixture.js";
import { loadProfiles, resolveProfile } from "./ops.profiles.js";
import { HARNESS_REGISTRY } from "./ops.registry.js";
import { RunQueue } from "./ops.queue.js";
import { FsRunStore, isTerminalStatus, type RunStore } from "./ops.store.js";
import type { RunStatus, RunStepRecord } from "./ops.types.js";

export interface OpsContext {
  /** Absolute path to packages/protocol/eval. */
  evalDir: string;
  /** Absolute path to packages/protocol: the working directory of every harness run. */
  protocolDir: string;
  /** Absolute repository root: relative step working directories resolve against it. */
  repoRoot: string;
  artifacts: ArtifactSource;
  store: RunStore;
  executor: RunExecutor;
  queue: RunQueue;
  profilesDir: string;
  /** Resolved from the server's own .env.test. Never from a request, never sent to a client. */
  databaseUrl: string | undefined;
  /** Read-only live counts. Absent when no database client is configured. */
  inspector?: FixtureInspector;
}

/** Origins a browser may legitimately be running the ops UI on: loopback only. */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Fetch metadata values that mean "this was not initiated by another site". */
const SAME_ORIGIN_FETCH_SITES = new Set(["same-origin", "none"]);

/** How often the SSE stream re-reads a run record, in milliseconds. */
const STATUS_POLL_MS = 250;
/** SSE comment interval, so an idle stream survives proxy and server idle timeouts. */
const HEARTBEAT_MS = 15_000;

const ResetRequestSchema = z
  .object({
    confirmDatabaseName: z.string().min(1),
    personas: z.number().int().min(0).max(MAX_PERSONAS),
  })
  .strict();

/** Serialisation between runs and resets: a flush under a live run corrupts that run. */
interface ServerState {
  resetInFlight: boolean;
}

export function createOpsHandler(context: OpsContext): (request: Request) => Promise<Response> {
  const state: ServerState = { resetInFlight: false };
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const refusal = crossOriginRefusal(request);
    if (refusal !== null) return refusal;
    try {
      const response = await route(context, state, request, url);
      return response ?? json({ error: `Unknown route: ${request.method} ${url.pathname}` }, 404);
    } catch (error) {
      // Every failure is displayed, never swallowed — but never with a credential in it.
      return json({ error: scrubCredentials(messageOf(error)) }, 500);
    }
  };
}

/**
 * Refuses a state-changing request that another site initiated.
 *
 * The attack this closes needs no credentials and no reply: a page on any origin
 * the operator has open can `fetch("http://127.0.0.1:4321/api/runs", { method:
 * "POST", mode: "no-cors", ... })`. The browser hides the response, but the side
 * effect — a real eval run spending real tokens, or a database flush — has already
 * happened. No CORS response header is added anywhere in this server, so a reply
 * still cannot be read cross-origin; this is about the write, not the read.
 *
 * Accepted:
 *  - an `Origin` on a loopback host at any port. Task 12 serves the UI from Vite
 *    on 127.0.0.1:5174 and proxies /api here; the proxy forwards the browser's
 *    own `Origin: http://127.0.0.1:5174` verbatim, and a direct visit to this
 *    server sends `Origin: http://127.0.0.1:4321`. Both are loopback.
 *  - no `Origin` at all: curl, and any proxy hop that drops it. A request with no
 *    `Origin` was not initiated by a page, so it is not the drive-by this closes.
 *  - `Sec-Fetch-Site: same-origin` or `none`, which say the same thing.
 *
 * Refused: any other `Origin` — including the opaque `Origin: null` a sandboxed
 * frame or a file:// page sends — and, when no `Origin` is present, a
 * `Sec-Fetch-Site` that names another site.
 */
function crossOriginRefusal(request: Request): Response | null {
  if (request.method === "GET" || request.method === "HEAD") return null;
  const origin = request.headers.get("origin");
  if (origin !== null) {
    if (isLoopbackOrigin(origin)) return null;
    return json({ error: `Refusing a ${request.method} from origin ${origin}: this server only accepts local requests.` }, 403);
  }
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && !SAME_ORIGIN_FETCH_SITES.has(site.toLowerCase())) {
    return json({ error: `Refusing a ${request.method} initiated by another site (Sec-Fetch-Site: ${site}).` }, 403);
  }
  return null;
}

function isLoopbackOrigin(origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    // "null" is what a sandboxed frame or a file:// page sends, and it is not parseable.
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return LOOPBACK_HOSTNAMES.has(parsed.hostname);
}

/** Returns null when nothing matched, so the caller can answer 404 in one place. */
async function route(context: OpsContext, state: ServerState, request: Request, url: URL): Promise<Response | null> {
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  if (segments[0] !== "api") return null;
  const [, resource, ...rest] = segments;

  if (request.method === "GET") {
    if (resource === "harnesses" && rest.length === 0) return json({ harnesses: Object.values(HARNESS_REGISTRY) });
    if (resource === "profiles" && rest.length === 0) return json({ profiles: await loadProfiles(context.profilesDir) });
    if (resource === "artifacts" && rest.length === 0) return json(await context.artifacts.list());
    if (resource === "artifacts" && rest.length === 1) return await readArtifact(context, rest[0]);
    if (resource === "compare" && rest.length === 0) return await compare(context, url);
    if (resource === "runs" && rest.length === 0) {
      const { records, issues } = await context.store.list();
      return json({ runs: records, issues });
    }
    if (resource === "runs" && rest.length === 2 && rest[1] === "stream") return await streamRun(context, request, rest[0]);
    if (resource === "fixture" && rest.length === 0) return await fixtureStatus(context);
  }

  if (request.method === "POST") {
    if (resource === "runs" && rest.length === 0) return await launchRun(context, state, request);
    if (resource === "runs" && rest.length === 2 && rest[1] === "cancel") return await cancelRun(context, rest[0]);
    if (resource === "fixture" && rest.length === 1 && rest[0] === "reset") return await resetFixture(context, state, request);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

async function readArtifact(context: OpsContext, id: string): Promise<Response> {
  try {
    decodeArtifactId(id);
  } catch (error) {
    return json({ error: scrubCredentials(messageOf(error)) }, 400);
  }
  try {
    return json(await context.artifacts.read(id));
  } catch (error) {
    const status = (error as { code?: string }).code === "ENOENT" ? 404 : 422;
    return json({ error: scrubCredentials(`Artifact ${id} could not be read: ${messageOf(error)}`) }, status);
  }
}

async function compare(context: OpsContext, url: URL): Promise<Response> {
  const referenceId = url.searchParams.get("reference");
  const subjectId = url.searchParams.get("subject");
  if (referenceId === null || subjectId === null) {
    return json({ error: "compare requires both a reference and a subject artifact id" }, 400);
  }
  for (const id of [referenceId, subjectId]) {
    try {
      decodeArtifactId(id);
    } catch (error) {
      return json({ error: scrubCredentials(messageOf(error)) }, 400);
    }
  }
  try {
    const [reference, subject] = await Promise.all([
      context.artifacts.read(referenceId),
      context.artifacts.read(subjectId),
    ]);
    return json(compareArtifacts(reference, subject));
  } catch (error) {
    const status = (error as { code?: string }).code === "ENOENT" ? 404 : 422;
    return json({ error: scrubCredentials(`Artifacts could not be compared: ${messageOf(error)}`) }, status);
  }
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

const RESET_IN_FLIGHT = "A test-database reset is in flight; a run launched now would see a half-seeded database.";

async function launchRun(context: OpsContext, state: ServerState, request: Request): Promise<Response> {
  if (state.resetInFlight) return json({ error: RESET_IN_FLIGHT }, 409);
  const body = await readJson(request);
  if (!body.ok) return json({ error: body.error }, body.status);

  // RunSpecSchema is .strict(), so a request carrying `env`, `argv` or any other
  // unknown key fails here rather than being silently ignored.
  const parsed = RunSpecSchema.safeParse(body.value);
  if (!parsed.success) return json({ error: describeIssues(parsed.error) }, 400);

  // The profile is looked up by name among committed files. The client cannot
  // supply overrides, only choose from what is in the repository.
  const profiles = await loadProfiles(context.profilesDir);
  const profile = profiles.find((candidate) => candidate.name === parsed.data.profile);
  if (profile === undefined) return json({ error: `Unknown profile "${parsed.data.profile}"` }, 400);
  const resolved = resolveProfile(profile);

  // Two phases: the report path contains the run id, and the id is minted by the
  // store, so the record is created first and then completed with its argv.
  const created = await context.store.create({
    spec: parsed.data,
    argv: [],
    env: resolved.env,
    profileFingerprint: resolved.fingerprint,
    experimental: resolved.experimental,
    workload: 0,
  });
  let record;
  try {
    const rendered = renderRun(parsed.data, resolved, context.store.reportPath(created.id));
    record = await context.store.update(created.id, {
      argv: rendered.argv,
      env: rendered.env,
      workload: rendered.workload,
    });
  } catch (error) {
    // The record exists but has no argv: leaving it queued would strand it until
    // the next reconcile and show the operator a run that never starts.
    await context.store.update(created.id, { status: "crashed", endedAt: new Date().toISOString() });
    return json({ error: scrubCredentials(messageOf(error)) }, 500);
  }

  // Re-checked with no await before the enqueue, so a reset that claimed the
  // server between the first check and here cannot end up running alongside a run.
  if (state.resetInFlight) {
    await context.store.update(record.id, { status: "interrupted", endedAt: new Date().toISOString() });
    return json({ error: RESET_IN_FLIGHT }, 409);
  }
  context.queue.enqueue(record);
  return json(record, 202);
}

async function cancelRun(context: OpsContext, id: string): Promise<Response> {
  const record = await context.store.get(id);
  if (record === null) return json({ error: `Unknown run id: ${id}` }, 404);
  if (isTerminalStatus(record.status)) return json({ run: record, accepted: false }, 200);

  // executor.cancel() awaits the child's exit, and a harness that ignores SIGINT
  // can take arbitrarily long to honour it — awaiting here would hang the request
  // for exactly that long. The signal is therefore fire-and-forget: this route
  // reports that the cancellation was accepted, and the run's own status stream
  // reports the outcome.
  void context.executor.cancel(id).catch((error) => {
    console.error(`[eval-ops] cancelling run ${id} failed:`, error);
  });
  return json({ run: record, accepted: true }, 202);
}

async function streamRun(context: OpsContext, request: Request, id: string): Promise<Response> {
  const record = await context.store.get(id);
  if (record === null) return json({ error: `Unknown run id: ${id}` }, 404);

  const abort = new AbortController();
  if (request.signal.aborted) abort.abort();
  request.signal.addEventListener("abort", () => abort.abort());
  const logPath = context.store.logPath(id);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (frame: string): void => {
        if (open) controller.enqueue(encoder.encode(frame));
      };
      const send = (event: string, data: unknown): void => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

      send("status", record);
      const watcher = watchStatus(context, id, record.status, send, write, abort);
      try {
        // Replay-then-follow: a browser that refreshes or joins late still sees
        // the whole log, not just what happens after it connected.
        for await (const chunk of tailLog(logPath, abort.signal)) send("log", chunk);
      } finally {
        // Aborting here as well as on client disconnect means a failure in the log
        // tail can never leave the status poller running for the process's lifetime.
        abort.abort();
        await watcher;
        open = false;
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/** Emits a `status` event on every change and ends the stream once the run is terminal. */
async function watchStatus(
  context: OpsContext,
  id: string,
  initial: RunStatus,
  send: (event: string, data: unknown) => void,
  write: (frame: string) => void,
  abort: AbortController,
): Promise<void> {
  let last: RunStatus = initial;
  let sinceHeartbeat = 0;
  let reported: string | null = null;
  while (!abort.signal.aborted) {
    if (isTerminalStatus(last)) {
      // One more tail cycle so the last bytes of the log are delivered before closing.
      await Bun.sleep(STATUS_POLL_MS);
      abort.abort();
      return;
    }
    await Bun.sleep(STATUS_POLL_MS);
    sinceHeartbeat += STATUS_POLL_MS;
    if (sinceHeartbeat >= HEARTBEAT_MS) {
      sinceHeartbeat = 0;
      write(": heartbeat\n\n");
    }
    let current;
    try {
      current = await context.store.get(id);
    } catch (error) {
      // Records are not written atomically, so a read can catch a partial write.
      // The failure is reported once rather than four times a second.
      const message = scrubCredentials(messageOf(error));
      if (message !== reported) {
        reported = message;
        send("error", { message });
      }
      continue;
    }
    reported = null;
    if (current !== null && current.status !== last) {
      last = current.status;
      send("status", current);
    }
  }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

async function fixtureStatus(context: OpsContext): Promise<Response> {
  // A guard verdict of `allowed` is only reachable for a non-empty connection string.
  const databaseUrl = context.databaseUrl ?? "";
  const guard = assessFixtureTarget(databaseUrl);
  if (!guard.allowed) return json({ allowed: false, reason: guard.reason });

  const base = {
    allowed: true,
    target: guard.target,
    maxPersonas: MAX_PERSONAS,
    // Named for what it is: every reset applies migrations. Drift is never probed.
    appliesMigrationsOnReset: true,
    // Repo-relative path where db:seed writes API keys. This is a location, not content:
    // the fixture screen shows an operator where to find keys after resetting.
    // Derived from the seed step's cwd so the two cannot drift.
    seedApiKeysPath: path.join(SEED_STEP_CWD, ".seed-api-keys.json"),
  };
  if (context.inspector === undefined) {
    return json({
      ...base,
      personaCount: null,
      personaEmails: null,
      tables: null,
      countsError: "Live counts are unavailable: this server has no database inspector configured.",
    });
  }
  try {
    const counts = await context.inspector.count(databaseUrl);
    return json({
      ...base,
      personaCount: counts.personas,
      personaEmails: counts.personaEmails,
      tables: counts.tables,
      countsError: null,
    });
  } catch (error) {
    return json({
      ...base,
      personaCount: null,
      personaEmails: null,
      tables: null,
      countsError: scrubCredentials(messageOf(error)),
    });
  }
}

async function resetFixture(context: OpsContext, state: ServerState, request: Request): Promise<Response> {
  if (state.resetInFlight) return json({ error: "A test-database reset is already in flight." }, 409);
  if (context.queue.depth > 0) {
    return json(
      { error: `Refusing to reset the test database while ${context.queue.depth} run(s) are queued or running.` },
      409,
    );
  }
  // Claimed with no await since the checks above, so two resets — or a reset and a
  // run — can never both believe the server was idle. Released again on every path
  // that does not launch.
  state.resetInFlight = true;
  let launched = false;
  try {
    const response = await prepareAndLaunchReset(context, state, request);
    launched = response.status === 202;
    return response;
  } finally {
    if (!launched) state.resetInFlight = false;
  }
}

async function prepareAndLaunchReset(context: OpsContext, state: ServerState, request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body.ok) return json({ error: body.error }, body.status);
  const parsed = ResetRequestSchema.safeParse(body.value);
  if (!parsed.success) return json({ error: describeIssues(parsed.error) }, 400);

  const target = await resolveResetTarget(context);
  if (!target.ok) return json({ error: target.reason }, target.status);

  // The reset confirmation must name the exact target database.
  if (parsed.data.confirmDatabaseName !== target.target.databaseName) {
    return json({ error: "confirmDatabaseName does not match the target database" }, 400);
  }

  // buildResetPipeline takes no target and can enforce nothing: it is only ever
  // reached once resolveResetTarget has returned an allowed target above.
  const pipeline = buildResetPipeline({ personas: parsed.data.personas, migrate: true });
  const steps: ExecutionStep[] = pipeline.map((step) => ({
    label: step.label,
    argv: step.argv,
    // "services/api" is a relative literal in ResetStep: it resolves against the
    // repository root, never against whatever directory this process was started in.
    cwd: path.join(context.repoRoot, step.cwd),
    env: {
      // ResetStep carries no environment, so this layer — the one that validated
      // the target — injects it. Without TEST_DATABASE_SAFE=1 the migrate step
      // refuses to run; without NODE_ENV=test the API's own ensureTestDatabaseReady
      // gate never runs, removing a second audited layer of protection.
      DATABASE_URL: target.databaseUrl,
      NODE_ENV: "test",
      TEST_DATABASE_SAFE: "1",
    },
  }));
  const recordedSteps: RunStepRecord[] = pipeline.map((step) => ({
    label: step.label,
    argv: [...step.argv],
    cwd: step.cwd,
  }));

  const record = await context.store.create({
    spec: {
      kind: "fixture-reset",
      personas: parsed.data.personas,
      migrate: true,
      databaseName: target.target.databaseName,
    },
    argv: [],
    steps: recordedSteps,
    // The injected DATABASE_URL is deliberately absent: a record is displayed and
    // stored on disk, and spec.databaseName already names the target.
    env: { NODE_ENV: "test", TEST_DATABASE_SAFE: "1" },
    profileFingerprint: "",
    experimental: false,
    workload: recordedSteps.length,
  });

  void context.executor
    .start(record, steps)
    .catch((error) => {
      console.error(`[eval-ops] fixture reset ${record.id} failed to execute:`, error);
      return context.store.update(record.id, { status: "crashed", endedAt: new Date().toISOString() });
    })
    .finally(() => {
      state.resetInFlight = false;
    })
    // The handler above can itself reject (the store write can fail), and an
    // unhandled rejection terminates the process under Bun's default.
    .catch(() => {});

  return json(record, 202);
}

type ResetTarget =
  | { ok: true; target: FixtureTarget; databaseUrl: string }
  | { ok: false; reason: string; status: number };

/**
 * Resolves the one database a reset may touch.
 *
 * The guard decides whether the target is disposable at all. The second check is
 * load-bearing, not documentation: every reset runs `db:migrate:test`, whose
 * drizzle.config.ts loads the repository-root .env.test with `override: true` and
 * therefore ignores the DATABASE_URL injected into the child. Flush and seed use
 * the injected URL. The two are the same database only while this server's
 * DATABASE_URL is still the one .env.test names, so a divergence fails the reset
 * closed instead of migrating a database the operator never confirmed.
 */
async function resolveResetTarget(context: OpsContext): Promise<ResetTarget> {
  const databaseUrl = context.databaseUrl ?? "";
  const guard = assessFixtureTarget(databaseUrl);
  if (!guard.allowed) return { ok: false, reason: guard.reason, status: 403 };

  const envFile = path.join(context.repoRoot, ".env.test");
  const declared = await readEnvValue(envFile, "DATABASE_URL");
  if (declared === null) {
    return {
      ok: false,
      reason: `Refusing to reset: ${envFile} does not set DATABASE_URL, so the migrate step would target an unknown database.`,
      status: 409,
    };
  }
  if (declared !== databaseUrl.trim()) {
    return {
      ok: false,
      reason:
        `Refusing to reset: this server validated ${guard.target.redactedUrl}, but ${envFile} now names `
        + `${redactDatabaseUrl(declared)}. The migrate step reads that file directly, so the two must agree.`,
      status: 409,
    };
  }
  return { ok: true, target: guard.target, databaseUrl: declared };
}

/** Reads one key out of a dotenv file. Last assignment wins, as dotenv does. */
async function readEnvValue(file: string, key: string): Promise<string | null> {
  const handle = Bun.file(file);
  if (!(await handle.exists())) return null;
  const pattern = new RegExp(`^(?:export\\s+)?${key}\\s*=\\s*(.*)$`);
  let found: string | null = null;
  for (const raw of (await handle.text()).split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = pattern.exec(line);
    if (match === null) continue;
    const value = match[1].trim();
    const quoted = value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
    found = quoted ? value.slice(1, -1) : value;
  }
  return found;
}

// ---------------------------------------------------------------------------
// Default wiring
// ---------------------------------------------------------------------------

/** Builds the context the standalone server runs on: everything rooted at the repository. */
export async function createDefaultOpsContext(options: { repoRoot: string }): Promise<OpsContext> {
  const protocolDir = path.join(options.repoRoot, "packages/protocol");
  const evalDir = path.join(protocolDir, "eval");
  const store = new FsRunStore({ evalDir });
  const executor = new LocalProcessRunExecutor({ store, cwd: protocolDir });
  const databaseUrl = process.env.DATABASE_URL;

  // Reported, not fatal: fixture control is only one page, and the reset route
  // fails closed on the same divergence. A silent mismatch is what must not happen.
  const declared = await readEnvValue(path.join(options.repoRoot, ".env.test"), "DATABASE_URL");
  if (databaseUrl !== undefined && declared !== null && declared !== databaseUrl.trim()) {
    console.warn(
      `[eval-ops] DATABASE_URL (${redactDatabaseUrl(databaseUrl)}) differs from the one in .env.test `
      + `(${redactDatabaseUrl(declared)}); fixture reset will refuse until they agree.`,
    );
  }

  return {
    evalDir,
    protocolDir,
    repoRoot: options.repoRoot,
    profilesDir: path.join(evalDir, "ops/profiles"),
    artifacts: new FsArtifactSource({ evalDir }),
    store,
    executor,
    queue: new RunQueue({ executor, store }),
    databaseUrl,
    inspector: new BunSqlFixtureInspector(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Reads a JSON request body, requiring the client to have said it is JSON.
 *
 * `no-cors` is limited to three content types, none of them application/json, so
 * demanding one is a second, independent barrier against a drive-by POST: a page
 * on another origin cannot produce this header at all without a preflight, which
 * this server never answers.
 */
async function readJson(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string; status: number }> {
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return {
      ok: false,
      error: `Expected a Content-Type of application/json, received ${contentType === "" ? "none" : contentType}`,
      status: 415,
    };
  }
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, error: "Request body is not valid JSON", status: 400 };
  }
}

/** Renders validation failures as one readable line, so the browser can display them verbatim. */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`))
    .join("; ");
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
