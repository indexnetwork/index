/**
 * The local JSON + SSE API over the eval ops core.
 *
 * This module is the trust boundary. The browser sends typed specs and profile
 * NAMES; it never sends argv, environment, shell strings or connection strings,
 * and a request carrying any of those fails validation instead of being ignored.
 * Nothing that leaves here contains a credential.
 *
 * Four independent guards stand in front of every request, and they compose
 * rather than substitute for one another:
 *
 *  1. `foreignHostRefusal` — every request, read included, must be addressed to a
 *     loopback host. This is what stops a rebound DNS name reading artifacts,
 *     run records, logs and fixture metadata.
 *  2. `crossOriginRefusal` — a state-changing request must be same-origin, so a
 *     page the operator happens to have open cannot drive a run or a flush.
 *  3. A JSON content type on writes, which `no-cors` cannot produce.
 *  4. `authRefusal` — the caller must hold a session belonging to a verified
 *     member of the allowed domain (see ops.auth.ts).
 *
 * Authentication is the newest of the four and the weakest place to lean: it is
 * defence in depth on top of the loopback guards, not a licence to relax them.
 * A signed-in browser is still refused a cross-origin write, and a foreign Host
 * is still refused before the session is even looked at.
 */
import path from "node:path";

import { z } from "zod";

import { renderRun, RunSpecSchema } from "./ops.argv.js";
import { decodeArtifactId, FsArtifactSource, type ArtifactSource } from "./ops.artifacts.js";
import { ApiIdentityResolver, assessIdentity, buildBridgeUrl, OneTimeStateStore, OpsSessionStore, type AllowedIdentity, type IdentityResolver } from "./ops.auth.js";
import { compareArtifacts } from "./ops.compare.js";
import { LocalProcessRunExecutor, tailLog, type ExecutionStep, type RunExecutor } from "./ops.executor.js";
import { assessFixtureTarget, BunSqlFixtureInspector, buildResetPipeline, MAX_PERSONAS, redactDatabaseUrl, scrubCredentials, SEED_STEP_CWD, type FixtureInspector, type FixtureTarget } from "./ops.fixture.js";
import { OPS_CALLBACK_PATH } from "./ops.paths.js";
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
  /** Identity. Absent only in tests that predate the gate; see `authRefusal`. */
  auth?: OpsAuthContext;
}

/** Everything the auth gate needs. All of it is injectable, so tests need no API. */
export interface OpsAuthContext {
  states: OneTimeStateStore;
  sessions: OpsSessionStore;
  identities: IdentityResolver;
  /** Base URL of the web app serving /cli-auth. */
  webAppUrl: string;
  /** The port this server's /callback is reachable on. */
  callbackPort: number;
  /**
   * Where a completed sign-in sends the browser.
   *
   * Configuration, never a request parameter, so this cannot become an open
   * redirect. It is not always `/`: in the documented two-process dev flow the
   * callback is answered by this API on :4321, which serves no UI at all, so a
   * bare `/` lands the operator on `{"error":"Unknown route: GET /"}`. See
   * `resolveUiUrl`.
   */
  uiUrl: string;
}

/** Origins a browser may legitimately be running the ops UI on: loopback only. */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The only routes reachable without a session, and the reason each one must be.
 *
 * This is an allowlist because the gate is default-deny: `authRefusal` refuses
 * everything not named here, including unknown paths, so a route added to
 * `route()` without a thought about access is gated rather than exposed. Adding
 * an entry here is the deliberate act of publishing something.
 *
 *  - `GET /api/auth/status` — the UI asks "am I signed in?" before it has a
 *    session; gating it would make the question unanswerable.
 *  - `POST /api/auth/login` — mints the sign-in link, so requiring a session to
 *    call it would be circular.
 *
 * `/callback` is deliberately absent: it is not under /api/ and is handled ahead
 * of the gate, because it is the request that *establishes* a session.
 */
export const PUBLIC_ROUTES: ReadonlyArray<{ method: string; path: string }> = Object.freeze([
  Object.freeze({ method: "GET", path: "/api/auth/status" }),
  Object.freeze({ method: "POST", path: "/api/auth/login" }),
]);

/** Name of the ops session cookie. */
const SESSION_COOKIE = "eval_ops_session";

/**
 * The session cookie's attributes.
 *
 * `Secure` is deliberately absent. The ops site is served over plain http on
 * loopback, and a Secure cookie would be dropped by the browser — sign-in would
 * appear to succeed and then silently never take effect. `SameSite=Lax` keeps the
 * cookie off cross-site writes, which is the same boundary `crossOriginRefusal`
 * enforces server-side.
 */
const SESSION_COOKIE_ATTRIBUTES = "HttpOnly; SameSite=Lax; Path=/";

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
    const rebinding = foreignHostRefusal(request);
    if (rebinding !== null) return rebinding;
    const refusal = crossOriginRefusal(request);
    if (refusal !== null) return refusal;
    try {
      // Ahead of the gate: this is the request that establishes a session, so it
      // cannot require one. It is still behind both loopback guards above.
      if (url.pathname === OPS_CALLBACK_PATH && request.method === "GET") {
        return await completeSignIn(context, url);
      }

      // Default-deny. Everything from here on either sits on PUBLIC_ROUTES or
      // carries a session, including unknown paths — so a route added below
      // without a decision about access is gated, not published.
      const denied = authRefusal(context, request, url);
      if (denied !== null) return denied;

      const response = await route(context, state, request, url);
      return response ?? json({ error: `Unknown route: ${request.method} ${url.pathname}` }, 404);
    } catch (error) {
      // Every failure is displayed, never swallowed — but never with a credential in it.
      return json({ error: scrubCredentials(messageOf(error)) }, 500);
    }
  };
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Refuses a request that carries no session, unless its route is public.
 *
 * 401 and 403 are kept distinct because the UI must tell two different stories:
 * 401 means "nobody is signed in, offer the sign-in button", while 403 means "an
 * Index account is signed in but it is not permitted here", which no amount of
 * retrying fixes. Collapsing them would leave an outsider clicking sign-in forever.
 *
 * Returns null when the request may proceed.
 */
function authRefusal(context: OpsContext, request: Request, url: URL): Response | null {
  const auth = context.auth;
  // A context with no auth wiring is a programming error, not an open door: the
  // server refuses everything rather than serving unauthenticated.
  if (auth === undefined) {
    return json({ error: "This server has no identity configured, so nothing can be authorised." }, 500);
  }
  if (PUBLIC_ROUTES.some((entry) => entry.method === request.method && entry.path === url.pathname)) {
    return null;
  }

  const identity = auth.sessions.lookup(readCookie(request, SESSION_COOKIE));
  if (identity === null) {
    return json({ error: "Sign in with your Index account to use the eval ops site.", authenticated: false }, 401);
  }
  // The *domain* rule is re-checked on every request rather than trusted from
  // sign-in time, so narrowing the allowed domain refuses live sessions too.
  // Verification is not re-checked: a session only exists past a verified check
  // at /callback, and the credential that could re-ask the API was discarded
  // there. `emailVerified: true` below states that, rather than proving it.
  const verdict = assessIdentity({ email: identity.email, emailVerified: true, name: identity.name });
  if (!verdict.allowed) {
    return json({ error: verdict.reason, authenticated: true, permitted: false }, 403);
  }
  return null;
}

/** The signed-in identity, or null. Only meaningful after `authRefusal` has passed. */
function sessionIdentity(context: OpsContext, request: Request): AllowedIdentity | null {
  return context.auth?.sessions.lookup(readCookie(request, SESSION_COOKIE)) ?? null;
}

/**
 * Completes the bridge round-trip: state in, session out.
 *
 * The order is deliberate and every step fails closed. The state is consumed
 * first, so a callback this server did not start is refused before the credential
 * in it is read at all. The credential is then exchanged for an identity and
 * dropped — it is a broad API key for a real account, and it is never stored in a
 * session, logged, or written into a page.
 */
async function completeSignIn(context: OpsContext, url: URL): Promise<Response> {
  const auth = context.auth;
  if (auth === undefined) return refusalPage("This server has no identity configured.", 500);

  // Consuming is the validation: unknown, expired and replayed states all fail here.
  if (!auth.states.consume(url.searchParams.get("state"))) {
    return refusalPage(
      "This sign-in link is no longer valid. It may have already been used, or it may have expired. Start the sign-in again from the eval ops site.",
      403,
    );
  }

  // The bridge sends the key as `api_key` (v2) or `session_token` (the v1 name,
  // which is also an API-key secret rather than a browser token).
  const credential = url.searchParams.get("api_key") ?? url.searchParams.get("session_token");
  if (credential === null || credential === "") {
    return refusalPage("The sign-in did not deliver a credential. Start the sign-in again from the eval ops site.", 403);
  }

  let resolved;
  try {
    resolved = await auth.identities.resolve(credential);
  } catch (error) {
    // "The API is down" is not "you are not allowed in", and must not read as it.
    return refusalPage(
      `The Index API could not be reached to verify this sign-in: ${scrubCredentials(messageOf(error))}`,
      502,
    );
  }

  const verdict = assessIdentity(resolved);
  if (!verdict.allowed) return refusalPage(verdict.reason, 403);

  const session = auth.sessions.establish(verdict.identity);
  return new Response(null, {
    status: 302,
    headers: {
      Location: auth.uiUrl,
      "Set-Cookie": `${SESSION_COOKIE}=${session}; ${SESSION_COOKIE_ATTRIBUTES}`,
    },
  });
}

/**
 * The page a refused sign-in lands on.
 *
 * The reason interpolates the address the API returned, which is user-controlled
 * text arriving through a redirect and rendered under the operator's own loopback
 * origin — an injection sink unless it is escaped. `escapeHtml` is applied to the
 * reason and nothing else is interpolated, so the page has no other sink.
 */
function refusalPage(reason: string, status: number): Response {
  const body = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign-in refused</title></head>
<body style="font-family: ui-monospace, monospace; background: #0b0d0e; color: #c8ccc8; padding: 2rem;">
<h1 style="color: #ff6b64;">Sign-in refused</h1>
<p>${escapeHtml(reason)}</p>
<p><a href="/" style="color: #56c8d8;">Return to the eval ops site</a></p>
</body>
</html>
`;
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** The five characters that can break out of HTML text or an attribute value. */
const HTML_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
});

/**
 * Escapes the five characters that can break out of HTML text or an attribute.
 *
 * A single regex pass rather than chained `replaceAll`: this suite's tsconfig
 * targets below ES2021, where `replaceAll` does not exist, and chained replaces
 * would also rewrite the ampersands the earlier steps introduced.
 */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

/** Reads one cookie out of the request's Cookie header. */
function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (header === null) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
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

/**
 * Refuses any request whose `Host` names something other than a loopback host.
 *
 * This closes DNS rebinding, which the Origin guard above cannot: an attacker
 * points a hostname they control at 127.0.0.1, so a page served from it is
 * genuinely same-origin to the browser. `Origin` and `Sec-Fetch-Site` then both
 * say "same-origin", and no CORS header is needed to read the reply. Only `Host`
 * still carries the attacker's domain.
 *
 * Unlike the Origin guard this applies to reads too — reads are the point of
 * rebinding. What is otherwise reachable: artifact bodies, run records including
 * argv, the full harness log over SSE, and the fixture route's database name,
 * host, persona emails and table counts. No credential is exposed (redaction
 * holds regardless), but that is infrastructure metadata worth keeping local.
 *
 * A request with no `Host` is accepted: it was not steered here by a resolved
 * name, so rebinding does not apply.
 */
function foreignHostRefusal(request: Request): Response | null {
  const host = request.headers.get("host");
  if (host === null) return null;
  if (isLoopbackHost(host)) return null;
  return json(
    { error: `Refusing a request for host ${host}: this server only answers on loopback (${[...LOOPBACK_HOSTNAMES].join(", ")}).` },
    403,
  );
}

/** Strips an optional port and compares against the loopback allowlist. */
function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  // Bracketed IPv6 keeps its brackets, which is how LOOPBACK_HOSTNAMES stores ::1.
  const hostname = value.startsWith("[") ? value.slice(0, value.indexOf("]") + 1) : value.split(":")[0];
  return LOOPBACK_HOSTNAMES.has(hostname);
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
    if (resource === "auth" && rest.length === 1 && rest[0] === "status") return authStatus(context, request);
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
    if (resource === "auth" && rest.length === 1 && rest[0] === "login") return beginSignIn(context);
    if (resource === "auth" && rest.length === 1 && rest[0] === "logout") return endSession(context, request);
    if (resource === "runs" && rest.length === 0) return await launchRun(context, state, request);
    if (resource === "runs" && rest.length === 2 && rest[1] === "cancel") return await cancelRun(context, rest[0]);
    if (resource === "fixture" && rest.length === 1 && rest[0] === "reset") return await resetFixture(context, state, request);
  }

  return null;
}

/** Who is signed in, if anyone. The one route the UI may ask before it has a session. */
function authStatus(context: OpsContext, request: Request): Response {
  const identity = sessionIdentity(context, request);
  if (identity === null) return json({ authenticated: false });
  return json({ authenticated: true, email: identity.email, name: identity.name });
}

/**
 * Starts a sign-in: mints a one-time state and returns the bridge link.
 *
 * Everything in the link comes from this server's own configuration; nothing in
 * it is taken from the request, so a caller cannot steer the callback elsewhere.
 */
function beginSignIn(context: OpsContext): Response {
  const auth = context.auth;
  if (auth === undefined) return json({ error: "This server has no identity configured." }, 500);
  const url = buildBridgeUrl({
    webAppUrl: auth.webAppUrl,
    callbackPort: auth.callbackPort,
    state: auth.states.mint(),
  });
  return json({ url });
}

/** Ends the session and expires the cookie, so the browser stops presenting it. */
function endSession(context: OpsContext, request: Request): Response {
  context.auth?.sessions.clear(readCookie(request, SESSION_COOKIE));
  return new Response(JSON.stringify({ authenticated: false }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${SESSION_COOKIE}=; ${SESSION_COOKIE_ATTRIBUTES}; Max-Age=0`,
    },
  });
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

/**
 * Where the API that resolves an identity lives, when the environment does not say.
 *
 * Paired with {@link DEFAULT_WEB_APP_URL} on purpose: see {@link resolveIdentityEndpoints}.
 */
const DEFAULT_API_URL = "http://localhost:3001";
/**
 * Where the web app serving the /cli-auth bridge lives, when the environment does not say.
 *
 * The local web dev server, matching {@link DEFAULT_API_URL}'s local API. It was
 * `https://index.network`, which paired a *production* bridge with a *local*
 * resolver: the bridge minted a production API key and the local API could not
 * verify it, so sign-in refused with "No Index account could be resolved" and
 * nothing said why. Both defaults now name the same environment.
 */
const DEFAULT_WEB_APP_URL = "http://localhost:3000";
/** The port this server listens on, when the environment does not say. Mirrors ops.serve.ts. */
const DEFAULT_PORT = 4321;
/**
 * Where a completed sign-in sends the browser, when the environment does not say.
 *
 * The Vite dev server from the documented two-process flow, which is the UI in
 * that mode — this API serves no UI. The single-process entrypoint
 * (apps/eval-ops/server.ts) serves both from one origin and passes `uiUrl: "/"`.
 */
const DEFAULT_UI_URL = "http://127.0.0.1:5174";

/** Hosts a sign-in may return the browser to, and the only ones this server may name. */
const LOOPBACK_UI_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * Reads an environment variable, treating an empty or whitespace-only value as unset.
 *
 * `WEB_APP_URL=` in a dotenv file is an operator saying nothing, not an operator
 * naming the empty origin, and `??` alone would take it literally.
 */
function readEnv(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * The bridge and the resolver, checked to be the same environment before the server starts.
 *
 * These two are one pair: `WEB_APP_URL` mints the API key and `API_URL` verifies
 * it. A key minted by one deployment is meaningless to another, so a mismatched
 * pair does not fail at startup — it fails at the end of a browser round-trip,
 * as "No Index account could be resolved for this sign-in", which reads like a
 * permissions problem and is not one. Failing loudly here costs the operator one
 * clear message instead of a debugging session.
 *
 * Two ways a pair is refused:
 *  - exactly one of the two is set. The other silently keeps its default, which
 *    is how the production-bridge/local-resolver trap was reachable at all.
 *  - one names a loopback host and the other does not, so they cannot be the
 *    same deployment.
 *
 * Exported for tests: it is pure, so the pairing rule needs no server, socket or
 * environment mutation to pin.
 */
export function resolveIdentityEndpoints(env: Record<string, string | undefined>): { webAppUrl: string; apiUrl: string } {
  const webAppUrl = readEnv(env, "WEB_APP_URL");
  const apiUrl = readEnv(env, "API_URL");

  if (webAppUrl === undefined && apiUrl === undefined) {
    return { webAppUrl: DEFAULT_WEB_APP_URL, apiUrl: DEFAULT_API_URL };
  }
  if (webAppUrl === undefined || apiUrl === undefined) {
    const named = webAppUrl === undefined ? "API_URL" : "WEB_APP_URL";
    const missing = webAppUrl === undefined ? "WEB_APP_URL" : "API_URL";
    throw new Error(
      `Refusing to start: ${named} is set but ${missing} is not. The eval ops sign-in mints an API key at `
      + `WEB_APP_URL and verifies it at API_URL, so a key minted by one deployment is not verifiable by `
      + `another. Set both to the same environment, or neither (which defaults to ${DEFAULT_WEB_APP_URL} `
      + `and ${DEFAULT_API_URL}).`,
    );
  }
  if (isLoopbackUrl(webAppUrl, "WEB_APP_URL") !== isLoopbackUrl(apiUrl, "API_URL")) {
    throw new Error(
      `Refusing to start: WEB_APP_URL (${webAppUrl}) and API_URL (${apiUrl}) are not the same environment — one is `
      + `local and the other is not. The eval ops sign-in mints an API key at WEB_APP_URL and verifies it at `
      + `API_URL, so a mismatched pair refuses every sign-in with "No Index account could be resolved".`,
    );
  }
  return { webAppUrl, apiUrl };
}

/** True when a configured URL names a loopback host. Throws on a URL that is not one. */
function isLoopbackUrl(value: string, name: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Refusing to start: ${name} (${value}) is not a usable URL.`);
  }
  return LOOPBACK_UI_HOSTNAMES.has(parsed.hostname.replace(/^\[|\]$/g, ""));
}

/**
 * Where a completed sign-in returns the browser.
 *
 * `EVAL_OPS_UI_URL` overrides, then the embedder's own answer (the single-process
 * entrypoint serves the UI itself and says `/`), then {@link DEFAULT_UI_URL}.
 *
 * Restricted to a same-origin path or a loopback origin. This value is never
 * taken from a request, so it is not an open-redirect sink today; the check is
 * here so it cannot become one by configuration, and because a sign-in that
 * hands the browser to a non-local origin is a mistake worth refusing loudly.
 */
function resolveUiUrl(env: Record<string, string | undefined>, fallback: string | undefined): string {
  const value = readEnv(env, "EVAL_OPS_UI_URL") ?? fallback ?? DEFAULT_UI_URL;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (!isLoopbackUrl(value, "EVAL_OPS_UI_URL")) {
    throw new Error(
      `Refusing to start: EVAL_OPS_UI_URL (${value}) is not a loopback origin or a same-origin path. `
      + `The eval ops site is loopback-only, so a sign-in must not hand the browser anywhere else.`,
    );
  }
  return value;
}

/** Builds the context the standalone server runs on: everything rooted at the repository. */
export async function createDefaultOpsContext(options: { repoRoot: string; uiUrl?: string }): Promise<OpsContext> {
  const protocolDir = path.join(options.repoRoot, "packages/protocol");
  const evalDir = path.join(protocolDir, "eval");
  const store = new FsRunStore({ evalDir });
  const executor = new LocalProcessRunExecutor({ store, cwd: protocolDir });
  const databaseUrl = process.env.DATABASE_URL;

  // Ahead of any I/O: a misconfigured identity pair must stop the server, not
  // surface as a refused sign-in five minutes later.
  const endpoints = resolveIdentityEndpoints(process.env);
  const uiUrl = resolveUiUrl(process.env, options.uiUrl);

  // Reported, not fatal: fixture control is only one page, and the reset route
  // fails closed on the same divergence. A silent mismatch is what must not happen.
  const declared = await readEnvValue(path.join(options.repoRoot, ".env.test"), "DATABASE_URL");
  if (databaseUrl !== undefined && declared !== null && declared !== databaseUrl.trim()) {
    console.warn(
      `[eval-ops] DATABASE_URL (${redactDatabaseUrl(databaseUrl)}) differs from the one in .env.test `
      + `(${redactDatabaseUrl(declared)}); fixture reset will refuse until they agree.`,
    );
  }

  // A previous server may have died with runs in flight; their records would
  // otherwise claim to be running forever.
  const interrupted = await store.reconcile();
  if (interrupted.length > 0) {
    console.log(`[eval-ops] marked ${interrupted.length} orphaned run(s) as interrupted`);
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
    auth: {
      states: new OneTimeStateStore(),
      sessions: new OpsSessionStore(),
      // The bridge mints a real API key against the operator's own browser
      // session, so this resolver is the only part of the server that talks to
      // the API at all.
      identities: new ApiIdentityResolver({ apiUrl: endpoints.apiUrl }),
      webAppUrl: endpoints.webAppUrl,
      uiUrl,
      // Must match the port Bun.serve actually binds, or the bridge would send the
      // credential to a port nothing is listening on. ops.serve.ts reads the same
      // variable and the same default.
      callbackPort: Number(process.env.EVAL_OPS_PORT ?? DEFAULT_PORT),
    },
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
