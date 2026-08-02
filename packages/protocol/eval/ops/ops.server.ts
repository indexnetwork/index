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
 *     loopback host, or to the one origin `EVAL_OPS_PUBLIC_ORIGIN` names when the
 *     server is deployed. This is what stops a rebound DNS name reading artifacts,
 *     run records, logs and fixture metadata.
 *  2. `crossOriginRefusal` — a state-changing request must come from an allowed
 *     origin, so a page the operator happens to have open cannot drive a run or a
 *     flush.
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
import { ApiIdentityResolver, assessIdentity, buildBridgeUrl, JwtIdentityResolver, OneTimeStateStore, OpsSessionStore, type AllowedIdentity, type IdentityResolver } from "./ops.auth.js";
import { compareArtifacts } from "./ops.compare.js";
import { BunSqlConfigStore, ConfigConflictError, InMemoryConfigStore, type ConfigStore } from "./ops.configs.js";
import { LocalProcessRunExecutor, tailLog, type ExecutionStep, type RunExecutor } from "./ops.executor.js";
import { assessFixtureTarget, BunSqlFixtureInspector, buildResetPipeline, MAX_PERSONAS, redactDatabaseUrl, scrubCredentials, SEED_STEP_CWD, type FixtureInspector, type FixtureTarget } from "./ops.fixture.js";
import { OPS_CALLBACK_PATH } from "./ops.paths.js";
import { ALLOWED_CONFIG_MODELS, ConfigProfileSchema, DEFAULT_PROFILE_NAME, loadProfiles, resolveAdHoc, resolveProfile, validateConfigOverrides, type ConfigProfile, type ResolvedProfile } from "./ops.profiles.js";
import { HARNESS_REGISTRY } from "./ops.registry.js";
import { RunQueue } from "./ops.queue.js";
import { FsRunStore, isTerminalStatus, type RunStore } from "./ops.store.js";
import type { RunRecord, RunStatus, RunStepRecord } from "./ops.types.js";
import { EVAL_RUN_REPORT_ARTIFACT_TYPE, parseEvalArtifact, type EvalArtifactEnvelope } from "../shared/index.js";

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
  /** Saved (DB-backed) eval configs; the writable counterpart of the shipped profiles. */
  configs: ConfigStore;
  /** Resolved from the server's own .env.test. Never from a request, never sent to a client. */
  databaseUrl: string | undefined;
  /** Read-only live counts. Absent when no database client is configured. */
  inspector?: FixtureInspector;
  /**
   * The one non-loopback origin this server also answers on, when it is deployed.
   *
   * Absent means loopback only, which is the local posture and the default. It is
   * never a wildcard and never a way to switch a guard off: see
   * {@link resolvePublicOrigin}, which validates it and refuses to start on
   * anything else.
   */
  publicOrigin?: PublicOrigin;
  /** Identity. Absent only in tests that predate the gate; see `authRefusal`. */
  auth?: OpsAuthContext;
}

/** Everything the auth gate needs. All of it is injectable, so tests need no API. */
export interface OpsAuthContext {
  sessions: OpsSessionStore;
  /**
   * The one seam that turns a credential into an identity.
   *
   * Which implementation is here is decided together with {@link signIn}, by
   * {@link resolveSignInMode}: the bridge mints API keys and the token exchange
   * carries JWTs, and a resolver paired with the wrong door refuses every
   * sign-in.
   */
  identities: IdentityResolver;
  /** How a browser is expected to prove who it is. */
  signIn: SignInPosture;
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

/**
 * The two doors a browser can sign in through, and everything each one needs.
 *
 * A discriminated union rather than a bag of optional fields, because the two
 * are genuinely different exchanges and only one of them can be open at a time.
 * The bridge holds the one-time state store; the token exchange does not have
 * one at all, so a deployed server cannot answer a bridge callback even by
 * accident.
 *
 *  - `bridge` is the local posture, unchanged: `<WEB_APP_URL>/cli-auth` mints a
 *    revocable API key against the operator's existing browser session and
 *    redirects it to `http://127.0.0.1:<port>/callback`.
 *  - `token` is the deployed posture. The bridge is unusable there —
 *    `validateCliCallbackUrl` in apps/web/src/lib/cli-auth.ts accepts only
 *    `http:` on loopback, deliberately, and that rule is shared with the released
 *    CLI — so the browser fetches a better-auth JWT from `${apiUrl}/api/auth/token`
 *    against its own API session and posts it to `POST /api/auth/session`, which
 *    resolves it server-side.
 */
export type SignInPosture =
  | {
      kind: "bridge";
      /** One-time states, so a callback this server did not start is refused. */
      states: OneTimeStateStore;
      /** Base URL of the web app serving /cli-auth. */
      webAppUrl: string;
      /** The port this server's /callback is reachable on. */
      callbackPort: number;
    }
  | {
      kind: "token";
      /** Base URL of the API that issues and verifies the token. */
      apiUrl: string;
      /** Where the operator signs in to Index when the API says it has no session. */
      webAppUrl: string;
    };

/** Origins a browser may legitimately be running the ops UI on, before deployment. */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The single deployed origin the guards below also accept.
 *
 * Both fields are derived from one validated value, so the `Host` check and the
 * `Origin` check cannot drift apart: `origin` is what an `Origin` header must
 * equal, `host` is what a `Host` header must equal (including a non-default port).
 */
export interface PublicOrigin {
  /** The normalised origin, e.g. `https://eval.index.network`. Never a wildcard. */
  origin: string;
  /** Its host, including a non-default port. */
  host: string;
}

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
 *  - `POST /api/auth/session` — the deployed posture's equivalent of `/callback`:
 *    it is the request that *establishes* a session by submitting a better-auth
 *    token, so it cannot require one. The same circularity, and the same
 *    deliberate exemption. It is not a hole in the gate: the Host, Origin and
 *    JSON content-type guards all still run in front of it, and it grants nothing
 *    except a session for an identity `assessIdentity` admits.
 *
 * `/callback` is deliberately absent: it is not under /api/ and is handled ahead
 * of the gate, because it is the request that *establishes* a session.
 */
export const PUBLIC_ROUTES: ReadonlyArray<{ method: string; path: string }> = Object.freeze([
  Object.freeze({ method: "GET", path: "/api/auth/status" }),
  Object.freeze({ method: "POST", path: "/api/auth/login" }),
  Object.freeze({ method: "POST", path: "/api/auth/session" }),
]);

/** Name of the ops session cookie. */
const SESSION_COOKIE = "eval_ops_session";

/**
 * The session cookie's attributes, minus `Secure`.
 *
 * `SameSite=Lax` keeps the cookie off cross-site writes, which is the same
 * boundary `crossOriginRefusal` enforces server-side.
 */
const SESSION_COOKIE_ATTRIBUTES = "HttpOnly; SameSite=Lax; Path=/";

/**
 * The cookie's attributes for one request.
 *
 * `Secure` follows the request rather than a hand-set flag, because both mistakes
 * are silent. On loopback the site is plain http, and a Secure cookie would be
 * dropped by the browser: sign-in would appear to succeed and never take effect.
 * Over HTTPS an insecure session cookie is a real exposure, and nothing in the
 * browser would say so.
 */
function sessionCookieAttributes(secure: boolean): string {
  return secure ? `${SESSION_COOKIE_ATTRIBUTES}; Secure` : SESSION_COOKIE_ATTRIBUTES;
}

/**
 * True when the browser reached this server over HTTPS.
 *
 * Two signals, both of them things this server can vouch for. The request URL's
 * own scheme is one. The other is the configured public origin: it is validated
 * to be `https:` and nothing else, so a request addressed to that host was served
 * over HTTPS even though a TLS-terminating proxy — Railway's edge, for one —
 * forwards it onward as plain http.
 *
 * `X-Forwarded-Proto` is deliberately not consulted. It is a header any client
 * can set, including a page on the operator's own machine, and trusting it would
 * let that page get the loopback session cookie dropped.
 */
function isSecureRequest(context: OpsContext, request: Request, url: URL): boolean {
  if (url.protocol === "https:") return true;
  const publicOrigin = context.publicOrigin;
  if (publicOrigin === undefined) return false;
  const host = request.headers.get("host");
  return host !== null && host.trim().toLowerCase() === publicOrigin.host;
}

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
    const rebinding = foreignHostRefusal(context, request);
    if (rebinding !== null) return rebinding;
    const refusal = crossOriginRefusal(context, request);
    if (refusal !== null) return refusal;
    try {
      // Ahead of the gate: this is the request that establishes a session, so it
      // cannot require one. It is still behind both host/origin guards above.
      if (url.pathname === OPS_CALLBACK_PATH && request.method === "GET") {
        return await completeSignIn(context, request, url);
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
  // at the sign-in that established it (/callback, or POST /api/auth/session),
  // and the credential that could re-ask the API was discarded there.
  // `emailVerified: true` below states that, rather than proving it.
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
async function completeSignIn(context: OpsContext, request: Request, url: URL): Promise<Response> {
  const auth = context.auth;
  if (auth === undefined) return refusalPage("This server has no identity configured.", 500);
  // A deployed server mints no states, so it can validate no callback. Refusing
  // is the only honest answer: the bridge could not have sent this browser here
  // (its own validator accepts loopback callbacks only), so anything arriving is
  // hand-made.
  if (auth.signIn.kind !== "bridge") {
    return refusalPage(
      "This server does not sign in through the local bridge. Start the sign-in again from the eval ops site.",
      403,
    );
  }
  const { states } = auth.signIn;

  // Consuming is the validation: unknown, expired and replayed states all fail here.
  if (!states.consume(url.searchParams.get("state"))) {
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
      "Set-Cookie": `${SESSION_COOKIE}=${session}; ${sessionCookieAttributes(isSecureRequest(context, request, url))}`,
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
 *  - the one origin `EVAL_OPS_PUBLIC_ORIGIN` names, when the server is deployed.
 *    Exactly that origin: a different scheme, a different port and a subdomain of
 *    it are all different origins and all refused.
 *  - no `Origin` at all: curl, and any proxy hop that drops it. A request with no
 *    `Origin` was not initiated by a page, so it is not the drive-by this closes.
 *  - `Sec-Fetch-Site: same-origin` or `none`, which say the same thing.
 *
 * Refused: any other `Origin` — including the opaque `Origin: null` a sandboxed
 * frame or a file:// page sends — and, when no `Origin` is present, a
 * `Sec-Fetch-Site` that names another site.
 */
function crossOriginRefusal(context: OpsContext, request: Request): Response | null {
  if (request.method === "GET" || request.method === "HEAD") return null;
  const origin = request.headers.get("origin");
  if (origin !== null) {
    if (isAllowedOrigin(origin, context.publicOrigin)) return null;
    return json(
      {
        error:
          `Refusing a ${request.method} from origin ${origin}: this server only accepts requests from `
          + `${describeAllowedOrigins(context.publicOrigin)}.`,
      },
      403,
    );
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
 *
 * A deployed server also answers on the one host `EVAL_OPS_PUBLIC_ORIGIN` names.
 * That is a second entry in the allowlist, not a hole in it: every other host,
 * including a subdomain of the configured one, is still refused.
 */
function foreignHostRefusal(context: OpsContext, request: Request): Response | null {
  const host = request.headers.get("host");
  if (host === null) return null;
  if (isAllowedHost(host, context.publicOrigin)) return null;
  return json(
    { error: `Refusing a request for host ${host}: this server only answers on ${describeAllowedHosts(context.publicOrigin)}.` },
    403,
  );
}

/** Loopback, plus the configured public host when there is one. */
function isAllowedHost(host: string, publicOrigin: PublicOrigin | undefined): boolean {
  const value = host.trim().toLowerCase();
  if (publicOrigin !== undefined && value === publicOrigin.host) return true;
  return isLoopbackHost(value);
}

/** Strips an optional port and compares against the loopback allowlist. */
function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  // Bracketed IPv6 keeps its brackets, which is how LOOPBACK_HOSTNAMES stores ::1.
  const hostname = value.startsWith("[") ? value.slice(0, value.indexOf("]") + 1) : value.split(":")[0];
  return LOOPBACK_HOSTNAMES.has(hostname);
}

/** Loopback at any port, plus the configured public origin exactly. */
function isAllowedOrigin(origin: string, publicOrigin: PublicOrigin | undefined): boolean {
  if (isLoopbackOrigin(origin)) return true;
  if (publicOrigin === undefined) return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  // URL.origin normalises scheme and host case and drops a default port, so this
  // is an origin comparison rather than a string comparison of two spellings.
  return parsed.origin === publicOrigin.origin;
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

/** The refusal message names what is allowed, so a misrouted deploy says what to fix. */
function describeAllowedHosts(publicOrigin: PublicOrigin | undefined): string {
  const loopback = `loopback (${[...LOOPBACK_HOSTNAMES].join(", ")})`;
  return publicOrigin === undefined ? loopback : `${loopback} and ${publicOrigin.host}`;
}

function describeAllowedOrigins(publicOrigin: PublicOrigin | undefined): string {
  return publicOrigin === undefined ? "loopback origins" : `loopback origins and ${publicOrigin.origin}`;
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
    if (resource === "configs" && rest.length === 0) return await listConfigs(context);
    if (resource === "configs" && rest.length === 1 && rest[0] === "models") return json({ models: [...ALLOWED_CONFIG_MODELS] });
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
    if (resource === "auth" && rest.length === 1 && rest[0] === "session") return await establishTokenSession(context, request, url);
    if (resource === "auth" && rest.length === 1 && rest[0] === "logout") return endSession(context, request, url);
    if (resource === "runs" && rest.length === 0) return await launchRun(context, state, request);
    if (resource === "runs" && rest.length === 2 && rest[1] === "cancel") return await cancelRun(context, rest[0]);
    if (resource === "fixture" && rest.length === 1 && rest[0] === "reset") return await resetFixture(context, state, request);
    if (resource === "configs" && rest.length === 0) return await createConfig(context, request);
  }

  if (request.method === "PATCH") {
    if (resource === "configs" && rest.length === 1) return await updateConfig(context, rest[0], request);
  }

  if (request.method === "DELETE") {
    if (resource === "configs" && rest.length === 1) return await deleteConfig(context, rest[0]);
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
 * Starts a sign-in, and says which of the two exchanges this server runs.
 *
 * A discriminated reply, not an optional field: the two postures return
 * genuinely different things, and a `url` that is sometimes absent would leave
 * the browser guessing.
 *
 *  - `bridge` — the local posture. Everything in the link comes from this
 *    server's own configuration; nothing in it is taken from the request, so a
 *    caller cannot steer the callback elsewhere.
 *  - `token` — the deployed posture. Names the API to fetch a better-auth token
 *    from and the web app to sign in at, and *nothing else*. Both are public DNS
 *    names the browser already talks to, one of them being where its own session
 *    cookie lives. This is deliberately not a route that reports server
 *    configuration in general.
 */
function beginSignIn(context: OpsContext): Response {
  const auth = context.auth;
  if (auth === undefined) return json({ error: "This server has no identity configured." }, 500);
  const posture = auth.signIn;
  if (posture.kind === "token") {
    return json({ kind: "token", apiUrl: posture.apiUrl, webAppUrl: posture.webAppUrl });
  }
  const url = buildBridgeUrl({
    webAppUrl: posture.webAppUrl,
    callbackPort: posture.callbackPort,
    state: posture.states.mint(),
  });
  return json({ kind: "bridge", url });
}

/** The one field `POST /api/auth/session` accepts. Strict: no client-asserted identity. */
const TokenSubmissionSchema = z.object({ token: z.string().min(1) }).strict();

/**
 * Completes the deployed sign-in: a better-auth token in, a session cookie out.
 *
 * The browser obtained the token from `${API_URL}/api/auth/token` against its
 * own API session — that works cross-site because the API's cookie is
 * `SameSite=None; Secure` — and posts it here. **This server resolves it**, by
 * presenting it to `${API_URL}/api/auth/me`, where the API verifies the
 * signature against its own JWKS. Nothing in the request is believed: the body
 * carries a credential, never an identity, and the schema is `.strict()` so a
 * body that tries to carry one is refused rather than ignored.
 *
 * The `/api/auth/me` hop is required rather than an optimisation. The `jwt`
 * plugin's `definePayload` returns `{ id, email, name }` and no `emailVerified`,
 * and {@link assessIdentity} demands verification — so a verified address can
 * only ever be read from the user record, never inferred from possession of a
 * token.
 *
 * The token is a bearer credential and is treated as one: it is exchanged once
 * and dropped. It is never stored in a session, never logged, and never written
 * into a response — including the 502 below, whose message is scrubbed of it in
 * case a transport error quoted the request it failed to make.
 *
 * 401 and 403 stay distinct here for the same reason as in {@link authRefusal}:
 * "the API does not accept this token" is a sign-in the operator can retry, and
 * "this account is not permitted" is not.
 */
async function establishTokenSession(context: OpsContext, request: Request, url: URL): Promise<Response> {
  const auth = context.auth;
  if (auth === undefined) return json({ error: "This server has no identity configured." }, 500);
  if (auth.signIn.kind !== "token") {
    return json(
      { error: "This server signs in through the local bridge; start the sign-in at POST /api/auth/login." },
      403,
    );
  }

  const body = await readJson(request);
  if (!body.ok) return json({ error: body.error }, body.status);
  const parsed = TokenSubmissionSchema.safeParse(body.value);
  if (!parsed.success) return json({ error: describeIssues(parsed.error) }, 400);
  const token = parsed.data.token;

  let resolved;
  try {
    resolved = await auth.identities.resolve(token);
  } catch (error) {
    // "The API is down" is not "you are not allowed in", and must not read as it.
    return json(
      { error: `The Index API could not be reached to verify this sign-in: ${redact(scrubCredentials(messageOf(error)), token)}` },
      502,
    );
  }

  if (resolved === null) {
    return json(
      { error: "The Index API did not accept this sign-in. Sign in to Index again and retry.", authenticated: false },
      401,
    );
  }

  const verdict = assessIdentity(resolved);
  if (!verdict.allowed) return json({ error: verdict.reason, authenticated: true, permitted: false }, 403);

  const session = auth.sessions.establish(verdict.identity);
  return new Response(JSON.stringify({ authenticated: true, email: verdict.identity.email, name: verdict.identity.name }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${SESSION_COOKIE}=${session}; ${sessionCookieAttributes(isSecureRequest(context, request, url))}`,
    },
  });
}

/**
 * Removes a credential from a message that may have quoted it.
 *
 * `scrubCredentials` knows about connection strings, not bearer tokens, and the
 * message here comes from whatever threw inside `fetch`. This is belt-and-braces
 * on top of never interpolating the token ourselves: the one thing that must not
 * happen is the credential travelling back to the browser in an error.
 */
function redact(message: string, credential: string): string {
  return credential === "" ? message : message.split(credential).join("[redacted]");
}

/** Ends the session and expires the cookie, so the browser stops presenting it. */
function endSession(context: OpsContext, request: Request, url: URL): Response {
  context.auth?.sessions.clear(readCookie(request, SESSION_COOKIE));
  return new Response(JSON.stringify({ authenticated: false }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Expired with the attributes it was set with, so the browser overwrites the
      // cookie it holds rather than being handed a second, differently scoped one.
      "Set-Cookie": `${SESSION_COOKIE}=; ${sessionCookieAttributes(isSecureRequest(context, request, url))}; Max-Age=0`,
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
  const referenceRun = url.searchParams.get("referenceRun");
  const subjectRun = url.searchParams.get("subjectRun");
  const artifactMode = referenceId !== null || subjectId !== null;
  const runMode = referenceRun !== null || subjectRun !== null;
  if (artifactMode === runMode) {
    return json(
      { error: "compare requires either reference+subject artifact ids or referenceRun+subjectRun run ids" },
      400,
    );
  }
  if (runMode) {
    if (referenceRun === null || subjectRun === null) {
      return json({ error: "compare requires both referenceRun and subjectRun" }, 400);
    }
    return await compareRuns(context, referenceRun, subjectRun);
  }
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

/**
 * Diffs two runs by their captured reports. Every run — saved or --no-save —
 * leaves a run-report envelope at its report path, so experimental A/B runs
 * compare without ever touching the artifact store. The config difference is
 * the variable under test, so the config-fingerprint refusal is dropped;
 * harness, corpus and selection still refuse. Each side is labelled from its
 * run record so the UI can head the diff with what actually ran.
 */
async function compareRuns(context: OpsContext, referenceRunId: string, subjectRunId: string): Promise<Response> {
  const sides: { id: string; record: RunRecord; envelope: EvalArtifactEnvelope }[] = [];
  for (const id of [referenceRunId, subjectRunId]) {
    const record = await context.store.get(id);
    if (record === null) return json({ error: `Unknown run id: ${id}` }, 404);
    const reportPath = context.store.reportPath(record.id);
    if (!(await Bun.file(reportPath).exists())) {
      return json({ error: `Run ${id} has no report to compare (it may have died before writing one)` }, 422);
    }
    let envelope: EvalArtifactEnvelope;
    try {
      envelope = parseEvalArtifact(await Bun.file(reportPath).json(), { expectedType: EVAL_RUN_REPORT_ARTIFACT_TYPE });
    } catch (error) {
      return json({ error: scrubCredentials(`Run ${id} report could not be read: ${messageOf(error)}`) }, 422);
    }
    sides.push({ id, record, envelope });
  }
  const [reference, subject] = sides;
  const outcome = compareArtifacts(reference.envelope, subject.envelope, 0.05, { allowConfigMismatch: true });
  const side = ({ id, record, envelope }: (typeof sides)[number]) => {
    // v1 envelopes predate the completeness flag; null says "unknown" rather
    // than guessing, matching how the artifact index treats them.
    const completeness = envelope.completeness as { complete?: boolean };
    return {
      id,
      profile: record.spec.kind === "eval" ? record.spec.profile : "default",
      profileFingerprint: record.profileFingerprint,
      complete: typeof completeness.complete === "boolean" ? completeness.complete : null,
    };
  };
  return json({ ...outcome, runs: { reference: side(reference), subject: side(subject) } });
}

// ---------------------------------------------------------------------------
// Configs
// ---------------------------------------------------------------------------

/**
 * What a config edit may change. Names are immutable — a rename is delete +
 * create — so `name` is absent here and `.strict()` refuses it if supplied.
 */
const ConfigPatchSchema = z
  .object({
    description: z.string().min(1).optional(),
    models: z.record(z.string().min(1)).optional(),
    env: z.record(z.string()).optional(),
  })
  .strict();

async function listConfigs(context: OpsContext): Promise<Response> {
  return json({ repo: await loadProfiles(context.profilesDir), saved: await context.configs.list() });
}

/** The shipped profiles are read-only through the API: edited in git, reviewed in a PR. */
async function repoProfileNameConflict(context: OpsContext, name: string): Promise<Response | null> {
  if (name === DEFAULT_PROFILE_NAME) {
    return json({ error: `"${DEFAULT_PROFILE_NAME}" names the shipped default profile` }, 409);
  }
  const repoNames = new Set((await loadProfiles(context.profilesDir)).map((profile) => profile.name));
  if (repoNames.has(name)) return json({ error: `"${name}" names a shipped repo profile` }, 409);
  return null;
}

async function createConfig(context: OpsContext, request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body.ok) return json({ error: body.error }, body.status);
  const parsed = ConfigProfileSchema.safeParse(body.value);
  if (!parsed.success) return json({ error: describeIssues(parsed.error) }, 400);
  const issues = validateConfigOverrides(parsed.data);
  if (issues.length > 0) return json({ error: issues.join("; ") }, 400);
  const conflict = await repoProfileNameConflict(context, parsed.data.name);
  if (conflict !== null) return conflict;
  try {
    await context.configs.create(parsed.data);
  } catch (error) {
    if (error instanceof ConfigConflictError) return json({ error: error.message }, 409);
    throw error;
  }
  return json(parsed.data, 201);
}

async function updateConfig(context: OpsContext, name: string, request: Request): Promise<Response> {
  const conflict = await repoProfileNameConflict(context, name);
  if (conflict !== null) return conflict;
  const body = await readJson(request);
  if (!body.ok) return json({ error: body.error }, body.status);
  const parsed = ConfigPatchSchema.safeParse(body.value);
  if (!parsed.success) return json({ error: describeIssues(parsed.error) }, 400);
  const existing = await context.configs.get(name);
  if (existing === null) return json({ error: `Unknown config "${name}"` }, 404);
  const merged: Pick<ConfigProfile, "models" | "env"> = {
    models: parsed.data.models ?? existing.models,
    env: parsed.data.env ?? existing.env,
  };
  const issues = validateConfigOverrides(merged);
  if (issues.length > 0) return json({ error: issues.join("; ") }, 400);
  const updated = await context.configs.update(name, parsed.data);
  if (updated === null) return json({ error: `Unknown config "${name}"` }, 404);
  return json(updated);
}

async function deleteConfig(context: OpsContext, name: string): Promise<Response> {
  const conflict = await repoProfileNameConflict(context, name);
  if (conflict !== null) return conflict;
  if (!(await context.configs.remove(name))) return json({ error: `Unknown config "${name}"` }, 404);
  return new Response(null, { status: 204 });
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

  // Two ways to configure a run: ad-hoc overrides (the schema has already
  // confined them to profile "default"), or a named profile resolved from
  // both sources — shipped repo files and saved configs. Raw model/env keys
  // never arrive outside the validated overrides object.
  let resolved: ResolvedProfile;
  if (parsed.data.overrides !== undefined) {
    const issues = validateConfigOverrides(parsed.data.overrides);
    if (issues.length > 0) return json({ error: issues.join("; ") }, 400);
    resolved = resolveAdHoc(parsed.data.overrides);
  } else {
    const repoProfiles = await loadProfiles(context.profilesDir);
    const profile =
      repoProfiles.find((candidate) => candidate.name === parsed.data.profile)
      ?? await context.configs.get(parsed.data.profile)
      ?? undefined;
    if (profile === undefined) return json({ error: `Unknown profile "${parsed.data.profile}"` }, 400);
    resolved = resolveProfile(profile);
  }

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

export interface ResetEnvFileState {
  exists: boolean;
  databaseUrl: string | null;
}

/**
 * Validates the relationship between the server-injected target and .env.test.
 *
 * The deployed preflight currently requires the file to be present because the
 * migrate step reads it directly; the absent-file acceptance is intentionally
 * pinned by the regression test before that behavior is changed.
 */
export function validateResetEnvFile(
  injectedDatabaseUrl: string,
  envFile: ResetEnvFileState,
): { ok: true; databaseUrl: string } | { ok: false; reason: string } {
  if (!envFile.exists) {
    return {
      ok: false,
      reason: "Refusing to reset: .env.test is absent, so the migrate step would target an unknown database.",
    };
  }
  if (envFile.databaseUrl === null) {
    return {
      ok: false,
      reason: "Refusing to reset: .env.test does not set DATABASE_URL, so the migrate step would target an unknown database.",
    };
  }
  if (envFile.databaseUrl !== injectedDatabaseUrl.trim()) {
    return {
      ok: false,
      reason:
        `Refusing to reset: .env.test names ${redactDatabaseUrl(envFile.databaseUrl)}, but this server validated `
        + `${redactDatabaseUrl(injectedDatabaseUrl)}. The migrate step reads that file directly, so the two must agree.`,
    };
  }
  return { ok: true, databaseUrl: envFile.databaseUrl };
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
  const envFileState: ResetEnvFileState = {
    exists: await Bun.file(envFile).exists(),
    databaseUrl: await readEnvValue(envFile, "DATABASE_URL"),
  };
  const envValidation = validateResetEnvFile(databaseUrl, envFileState);
  if (!envValidation.ok) return { ok: false, reason: envValidation.reason, status: 409 };
  return { ok: true, target: guard.target, databaseUrl: envValidation.databaseUrl };
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
/** The port this server listens on, when the environment does not say. */
const DEFAULT_PORT = 4321;
/** The address this server binds, when the environment does not say. Loopback, deliberately. */
const DEFAULT_BIND = "127.0.0.1";
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

/**
 * The port an entrypoint binds, and the bridge callback must therefore advertise.
 *
 * `EVAL_OPS_PORT` always wins: it names *this* server and nothing else. What it
 * falls back to depends on which entrypoint is asking, which is why the posture
 * is a parameter rather than an ambient guess:
 *
 *  - `apps/eval-ops/server.ts` is the deployed single-process site. The platform
 *    (Railway) chooses the port and injects `PORT`; ignoring it would leave the
 *    service listening where nothing routes, and its health check failing.
 *  - `ops.serve.ts` is the local dev API, started by `bun run eval:web` with
 *    `--env-file=../../.env.test` — and that file sets `PORT=3001` for the *API
 *    service*. Honouring `PORT` there would silently move the ops API onto the
 *    API's port and break the documented two-process flow on every machine.
 *
 * Do not collapse the two call sites back into one unconditional rule. That
 * `PORT=3001` line is the reason this parameter exists.
 */
export interface BindPortOptions {
  env: Record<string, string | undefined>;
  /** True only for the entrypoint the platform starts and injects `PORT` into. */
  honourPlatformPort: boolean;
}

export function resolveBindPort(options: BindPortOptions): number {
  const explicit = readEnv(options.env, "EVAL_OPS_PORT");
  if (explicit !== undefined) return parsePort(explicit, "EVAL_OPS_PORT");
  if (options.honourPlatformPort) {
    const platform = readEnv(options.env, "PORT");
    if (platform !== undefined) return parsePort(platform, "PORT");
  }
  return DEFAULT_PORT;
}

/** Refuses a port that is not one, rather than letting Number() bind something arbitrary. */
function parsePort(value: string, name: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Refusing to start: ${name} (${value}) is not a usable TCP port. Set it to an integer between 1 and `
      + `65535, or leave it unset to use ${DEFAULT_PORT}.`,
    );
  }
  return port;
}

/**
 * The address an entrypoint binds. Loopback unless `EVAL_OPS_BIND` says otherwise.
 *
 * Widening the bind stays one deliberate, explicit act, and it is not implied by
 * anything else: a deployed port does not move it, and it is not what makes the
 * site reachable — the `Host` and `Origin` allowlists still have to name the
 * origin as well (see {@link resolvePublicOrigin}).
 */
export function resolveBindHostname(env: Record<string, string | undefined>): string {
  return readEnv(env, "EVAL_OPS_BIND") ?? DEFAULT_BIND;
}

/** Hostnames a public origin may name: letters, digits and hyphens, dot-separated. */
const PUBLIC_HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/**
 * The one deployed origin the `Host` and `Origin` allowlists are extended to.
 *
 * Unset means loopback only — the local posture, unchanged. There is deliberately
 * no wildcard and no way to switch a guard off: the value is one absolute origin
 * or the server does not start.
 *
 * Validated rather than trusted, because every way of getting this wrong is
 * silent at startup and expensive later. `http:` would let a session cookie ride
 * a plaintext hop and would also make {@link isSecureRequest} wrong. A path,
 * query or fragment means the operator supplied a URL where an origin was asked
 * for, and the string comparison against a browser's `Origin` header would then
 * never match — every request 403ing with no stated cause. A hostname outside
 * LDH is either a wildcard attempt or a typo.
 */
export function resolvePublicOrigin(env: Record<string, string | undefined>): PublicOrigin | undefined {
  const value = readEnv(env, "EVAL_OPS_PUBLIC_ORIGIN");
  if (value === undefined) return undefined;

  const refuse = (reason: string): never => {
    throw new Error(
      `Refusing to start: EVAL_OPS_PUBLIC_ORIGIN (${value}) ${reason}. It must be exactly one absolute https `
      + `origin with no path, query or fragment, such as https://eval.index.network — or be unset, which keeps `
      + `this server loopback-only.`,
    );
  };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return refuse("is not a usable URL");
  }
  if (parsed.protocol !== "https:") return refuse(`names ${parsed.protocol.replace(":", "")}, not https`);
  if (parsed.username !== "" || parsed.password !== "") return refuse("carries credentials");
  if (parsed.search !== "") return refuse("carries a query string");
  if (parsed.hash !== "") return refuse("carries a fragment");
  if (parsed.pathname !== "" && parsed.pathname !== "/") return refuse(`names a path (${parsed.pathname})`);
  if (!PUBLIC_HOSTNAME_PATTERN.test(parsed.hostname)) return refuse(`does not name a usable host (${parsed.hostname})`);

  return { origin: parsed.origin, host: parsed.host };
}

/**
 * Which of the two sign-in exchanges this server runs.
 *
 * One rule, exported and pure, so the choice is a thing a test can state rather
 * than a guess buried in the wiring. The condition is `EVAL_OPS_PUBLIC_ORIGIN`,
 * because that variable *is* the deployed posture — it is what extends the Host
 * and Origin allowlists past loopback — and it is exactly the circumstance in
 * which the bridge cannot work: `validateCliCallbackUrl` accepts only `http:` on
 * 127.0.0.1/[::1], so a browser on a deployed origin can never be redirected
 * back with a credential.
 *
 * Nothing else decides it. A wider `EVAL_OPS_BIND` or a platform `PORT` does not
 * make the callback unreachable, and inferring the posture from either would
 * change how sign-in works on a developer's machine.
 *
 * A malformed value throws here exactly as it does in the guards, rather than
 * falling back to the bridge — that fallback would be a deployed server
 * advertising a loopback callback, which is the failure this posture exists to
 * remove.
 */
export function resolveSignInMode(env: Record<string, string | undefined>): "bridge" | "token" {
  return resolvePublicOrigin(env) === undefined ? "bridge" : "token";
}

/** Builds the context the standalone server runs on: everything rooted at the repository. */
export async function createDefaultOpsContext(options: {
  repoRoot: string;
  uiUrl?: string;
  /**
   * The port the entrypoint bound, from {@link resolveBindPort}.
   *
   * Passed in rather than re-read here: the bridge callback must name the port
   * the server is actually listening on, and two independent reads of the
   * environment are how those drift.
   */
  port: number;
}): Promise<OpsContext> {
  const protocolDir = path.join(options.repoRoot, "packages/protocol");
  const evalDir = path.join(protocolDir, "eval");
  const store = new FsRunStore({ evalDir });
  const executor = new LocalProcessRunExecutor({ store, cwd: protocolDir });
  const databaseUrl = process.env.DATABASE_URL;

  // Ahead of any I/O: a misconfigured identity pair, or a malformed public
  // origin, must stop the server rather than surface as a refused sign-in or a
  // site that 403s every request five minutes later.
  const endpoints = resolveIdentityEndpoints(process.env);
  const uiUrl = resolveUiUrl(process.env, options.uiUrl);
  const publicOrigin = resolvePublicOrigin(process.env);
  const signInMode = resolveSignInMode(process.env);

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

  // Saved configs live in the same database fixture control uses. Constructing
  // the store is lazy (Bun.SQL connects on first query), so tests can build
  // this context without a socket; the table itself is created at boot by
  // `ensureConfigStorage`, which only the real entrypoints call.
  let configs: ConfigStore;
  if (databaseUrl !== undefined) {
    configs = new BunSqlConfigStore(databaseUrl);
  } else {
    console.warn("[eval-ops] DATABASE_URL is not set; saved configs live in memory and WILL NOT PERSIST across restarts.");
    configs = new InMemoryConfigStore();
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
    configs,
    databaseUrl,
    inspector: new BunSqlFixtureInspector(),
    publicOrigin,
    // One decision picks both the door and the resolver behind it, in a single
    // expression, because they are the same decision: the bridge delivers an API
    // key and the token exchange delivers a JWT, and a resolver paired with the
    // wrong door refuses every sign-in with a message about permissions.
    auth: signInMode === "token"
      ? {
          sessions: new OpsSessionStore(),
          // Resolved server-side against the API's own /api/auth/me, which is
          // where a verified address can be read at all — the token does not
          // carry one.
          identities: new JwtIdentityResolver({ apiUrl: endpoints.apiUrl }),
          uiUrl,
          signIn: { kind: "token", apiUrl: endpoints.apiUrl, webAppUrl: endpoints.webAppUrl },
        }
      : {
          sessions: new OpsSessionStore(),
          // The bridge mints a real API key against the operator's own browser
          // session, so this resolver is the only part of the server that talks to
          // the API at all.
          identities: new ApiIdentityResolver({ apiUrl: endpoints.apiUrl }),
          uiUrl,
          signIn: {
            kind: "bridge",
            states: new OneTimeStateStore(),
            webAppUrl: endpoints.webAppUrl,
            // The port the entrypoint bound, handed to Bun.serve and to this from
            // one resolution — or the bridge would send the credential to a port
            // nothing is listening on.
            callbackPort: options.port,
          },
        },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Boot-time config storage setup, called by the real entrypoints only.
 *
 * Idempotent DDL against the database `DATABASE_URL` names; a failure throws
 * and refuses the boot, because a server that starts without its config table
 * would look like it silently lost every saved config. An in-memory store
 * (local runs without a database) has nothing to ensure.
 */
export async function ensureConfigStorage(context: OpsContext): Promise<void> {
  if (context.configs instanceof BunSqlConfigStore) {
    await context.configs.ensureTable();
    console.log("[eval-ops] eval_ops_configs table is present");
  }
}

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
