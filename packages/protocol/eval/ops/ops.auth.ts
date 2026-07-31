/**
 * Identity for the eval ops site: who is at the browser, and may they be here.
 *
 * The ops server is loopback-only and stays that way — the bind address, the
 * `Host` check and the `Origin` allowlist in ops.server.ts are what keep it off
 * the network. This module is defence in depth on top of them, not a
 * replacement: it answers "which Index account is driving this", so a machine
 * shared with anyone, or a process running as another user, still cannot spend
 * tokens or flush a database through it.
 *
 * There is no cookie to forward. The ops UI runs on 127.0.0.1 and the API on
 * localhost:3001, and a Better Auth session cookie is host-scoped, so the ops
 * server cannot read it. The repository already solves exactly this for the CLI:
 * open `<WEB_APP_URL>/cli-auth` against the browser's existing session, let it
 * mint a revocable API key, and have it redirect that key to a loopback
 * callback. This module reuses that bridge — see `buildBridgeUrl`.
 *
 * Everything here is injectable and free of I/O except `ApiIdentityResolver`,
 * which is the one seam that talks to the API. Nothing here reads the
 * environment, opens a socket by default, or logs.
 *
 * The credential is radioactive: it is a broad API key for a real account. It is
 * accepted, exchanged for an identity, and dropped. It is never stored in a
 * session, never returned to the browser and never put in a message.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

/**
 * The one domain whose members may use the eval ops site.
 *
 * Compared with `===` against the part after the last `@`, lowercased. Not a
 * suffix test: `a@index.network.evil.com` and `a@sub.index.network` are other
 * people's domains and both must be refused.
 */
export const ALLOWED_EMAIL_DOMAIN = "index.network";

/**
 * How many `@` an address this server will admit may contain.
 *
 * Do not "simplify" this away. An address with two `@` is one we do not
 * understand. RFC 5321 permits a quoted local part containing `@`, so
 * `a@evil.com?x=@index.network` has a last-`@` domain of exactly index.network
 * and the domain rule alone would admit it — but neither Google OAuth nor the
 * better-auth magic link ever mints such an address, so the only realistic way
 * one reaches `users.email` is something having gone wrong upstream. This gate
 * protects a tool that can flush a database and spend tokens, so refusing an
 * address we cannot unambiguously parse beats picking either interpretation.
 */
const MAX_EMAIL_AT_SIGNS = 1;

/**
 * The one-time state accepted by the bridge page.
 *
 * Pinned to `CLI_STATE_PATTERN` in apps/web/src/lib/cli-auth.ts: a state outside
 * it makes `parseCliAuthRequest` reject the whole request, so minting one would
 * produce a sign-in link that silently never works. tests/auth.spec.ts checks a
 * minted state against that file's own parser.
 */
const BRIDGE_STATE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

/** How long a minted sign-in state stays usable. One browser round-trip, no more. */
export const STATE_TTL_MS = 5 * 60_000;

/** An identity as resolved from the API, reduced to what the policy needs. */
export interface ResolvedIdentity {
  email: string | null;
  emailVerified: boolean;
  name: string;
}

/** What the ops server may show and remember about a permitted user. */
export interface AllowedIdentity {
  email: string;
  name: string;
}

/**
 * The verdict of the domain policy. The refusal carries a reason so the callback
 * page can say why; the reason names the address, never the credential.
 */
export type IdentityVerdict =
  | { allowed: true; identity: AllowedIdentity }
  | { allowed: false; reason: string };

/**
 * Decides whether a resolved identity may use the ops site. Pure, and the only
 * place that decision is made.
 *
 * Allowed only when the address is verified *and* its domain is exactly
 * {@link ALLOWED_EMAIL_DOMAIN}. "Exactly" means the substring after the **last**
 * `@`, lowercased, compared with `===`. The last `@` matters: `"a@index.network"@evil.com`
 * is an address at evil.com, and a check anchored anywhere else reads it as ours.
 *
 * Everything unrecognised fails closed: no identity, no address, a non-string
 * address, an address with no domain part, an address we cannot parse
 * unambiguously (see {@link MAX_EMAIL_AT_SIGNS}).
 *
 * The order of the refusals is deliberate. The domain comparison runs first, so
 * an address at someone else's domain is refused on the plainest possible
 * ground. The ambiguity guard exists only to stop an address from being
 * *admitted*, so it sits on the path to admission, after the domain has already
 * been found to match.
 */
export function assessIdentity(identity: ResolvedIdentity | null | undefined): IdentityVerdict {
  if (identity === null || identity === undefined) {
    return { allowed: false, reason: "No Index account could be resolved for this sign-in." };
  }

  const email = typeof identity.email === "string" ? identity.email : "";
  const domain = emailDomain(email);
  if (domain === null) {
    return { allowed: false, reason: "This Index account has no usable email address." };
  }
  if (domain !== ALLOWED_EMAIL_DOMAIN) {
    return { allowed: false, reason: `${email} is not an @${ALLOWED_EMAIL_DOMAIN} address.` };
  }
  if (countAtSigns(email) > MAX_EMAIL_AT_SIGNS) {
    return { allowed: false, reason: `${email} cannot be read as one unambiguous address.` };
  }
  if (identity.emailVerified !== true) {
    return { allowed: false, reason: `${email} is not verified.` };
  }
  return { allowed: true, identity: { email, name: identity.name } };
}

/**
 * The domain of an address: everything after the last `@`, lowercased.
 * Null when there is no `@`, nothing before it, or nothing after it.
 */
function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

/** How many `@` the address contains. */
function countAtSigns(email: string): number {
  let count = 0;
  for (const character of email) {
    if (character === "@") count += 1;
  }
  return count;
}

/**
 * The sign-in states this server has handed out and not yet seen come back.
 *
 * Each state binds one browser round-trip to this exact process. A callback
 * carrying a state this server never minted is not a login this server started,
 * and is refused before the credential in it is looked at at all.
 *
 * In memory on purpose: the ops server is a single local process, and a state
 * that outlived it would be a state nobody is waiting for.
 */
export class OneTimeStateStore {
  /** state -> the instant it stops being usable. */
  private readonly pending = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? STATE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /** Mints a state for one sign-in. 256 bits, URL-safe, accepted by the bridge page. */
  mint(): string {
    const now = this.now();
    this.prune(now);
    const state = randomBytes(32).toString("base64url");
    this.pending.set(state, now + this.ttlMs);
    return state;
  }

  /**
   * Accepts a returning state exactly once.
   *
   * Consuming *is* the validation: a match is removed before this returns, so a
   * replayed callback — a refresh, a second tab, a copied URL — fails. Expired
   * states are dropped first, so age is enforced on the same path.
   *
   * The comparison is constant-time against every outstanding state, so a caller
   * cannot learn a state prefix by timing guesses.
   */
  consume(candidate: string | null | undefined): boolean {
    const now = this.now();
    this.prune(now);
    const matched = matchConstantTime(this.pending.keys(), candidate);
    if (matched === null) return false;
    this.pending.delete(matched);
    return true;
  }

  private prune(now: number): void {
    for (const [state, expiresAt] of this.pending) {
      if (expiresAt <= now) this.pending.delete(state);
    }
  }
}

/** Everything `buildBridgeUrl` needs; all of it comes from this server, none from a request. */
export interface BridgeUrlOptions {
  /** Base URL of the web app that serves /cli-auth. */
  webAppUrl: string;
  /** Port this server's `/callback` route is listening on. */
  callbackPort: number;
  /** A state from {@link OneTimeStateStore.mint}. */
  state: string;
}

/**
 * Builds the sign-in link: `<WEB_APP_URL>/cli-auth?callback=...&version=2&state=...`.
 *
 * The callback must be `http://127.0.0.1:<port>/callback` and nothing else.
 * `validateCliCallbackUrl` in apps/web/src/lib/cli-auth.ts requires the `http:`
 * scheme, a loopback host, that exact pathname, and no credentials, query string
 * or fragment — so the callback is assembled here rather than taken from a
 * caller, and only the port varies.
 *
 * A bad port or a malformed state throws instead of producing a link that would
 * be rejected on arrival, where the operator would see nothing but a blank
 * bridge page.
 */
export function buildBridgeUrl(options: BridgeUrlOptions): string {
  const { callbackPort, state } = options;
  if (!Number.isInteger(callbackPort) || callbackPort < 1 || callbackPort > 65535) {
    return raise(`Refusing to build a sign-in URL for callback port ${callbackPort}: the bridge accepts an integer port in 1..65535.`);
  }
  if (!BRIDGE_STATE_PATTERN.test(state)) {
    return raise("Refusing to build a sign-in URL: the one-time state is not in the form the bridge accepts.");
  }

  const url = new URL(`${options.webAppUrl.replace(/\/$/, "")}/cli-auth`);
  url.searchParams.set("callback", `http://127.0.0.1:${callbackPort}/callback`);
  url.searchParams.set("version", "2");
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * Exchanges a credential for the identity behind it.
 *
 * A seam, so the tests never need an API, a database or a socket: the ops server
 * injects {@link ApiIdentityResolver} and a spec injects a stub.
 */
export interface IdentityResolver {
  /**
   * @param apiKey - The credential the bridge delivered. Never stored, never logged.
   * @returns The identity, or null when the credential is not accepted or the
   *          reply is not the shape this server understands.
   */
  resolve(apiKey: string): Promise<ResolvedIdentity | null>;
}

/**
 * The `/api/auth/me` reply, narrowed to the fields the policy reads.
 *
 * Shaped from services/api/src/controllers/auth.controller.ts: `me` returns
 * `{ user, features }` where `user` is the full `users` row (so `emailVerified`
 * is present and boolean) plus socials and notification preferences. Unknown
 * keys are ignored rather than rejected — this server has no business failing
 * because the API grew a field.
 */
const MeResponseSchema = z.object({
  user: z.object({
    email: z.string().nullish(),
    emailVerified: z.boolean().nullish(),
    name: z.string().nullish(),
  }),
});

/** Wiring for {@link ApiIdentityResolver}. */
export interface ApiIdentityResolverOptions {
  /** Base URL of the API, e.g. http://localhost:3001. */
  apiUrl: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

/**
 * Resolves an identity through the API's own `/api/auth/me`.
 *
 * The credential travels in the `x-api-key` header, which is what `AuthGuard`
 * reads for a key; putting it in the URL would leak it into every access log on
 * the way. A refusal or an unrecognised body resolves to null, so the caller
 * refuses the sign-in rather than inventing an identity. Transport failures
 * reject: "the API is down" is not "you are not allowed in".
 */
export class ApiIdentityResolver implements IdentityResolver {
  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiIdentityResolverOptions) {
    this.apiUrl = options.apiUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  async resolve(apiKey: string): Promise<ResolvedIdentity | null> {
    const response = await this.fetchImpl(`${this.apiUrl}/api/auth/me`, {
      method: "GET",
      headers: { "x-api-key": apiKey, accept: "application/json" },
    });
    if (!response.ok) return null;

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return null;
    }
    const parsed = MeResponseSchema.safeParse(body);
    if (!parsed.success) return null;

    const { email, emailVerified, name } = parsed.data.user;
    return {
      email: email ?? null,
      // Absent is not verified: the policy must never read a missing flag as a yes.
      emailVerified: emailVerified === true,
      name: name ?? "",
    };
  }
}

/**
 * The browser sessions this server has established.
 *
 * In memory, for the same reason as the state store: one local process, and
 * nothing here is worth persisting past its lifetime. A session holds the
 * identity and nothing else — in particular not the API key, which is discarded
 * the moment it has been exchanged, so no serialisation of a session can ever
 * carry a credential back to the browser.
 */
export class OpsSessionStore {
  private readonly sessions = new Map<string, AllowedIdentity>();

  /** Establishes a session for a permitted identity. Returns its 256-bit value. */
  establish(identity: AllowedIdentity): string {
    const value = randomBytes(32).toString("base64url");
    this.sessions.set(value, { email: identity.email, name: identity.name });
    return value;
  }

  /** The identity behind a session value, or null. Constant-time, like state. */
  lookup(value: string | null | undefined): AllowedIdentity | null {
    const matched = matchConstantTime(this.sessions.keys(), value);
    return matched === null ? null : { ...this.sessions.get(matched) as AllowedIdentity };
  }

  /** Ends a session. False when there was nothing to end. */
  clear(value: string | null | undefined): boolean {
    const matched = matchConstantTime(this.sessions.keys(), value);
    if (matched === null) return false;
    this.sessions.delete(matched);
    return true;
  }
}

/**
 * Finds `candidate` among `known` without leaking where it stopped matching.
 *
 * `timingSafeEqual` throws on a length mismatch, so unequal lengths are skipped
 * — a length is not a secret here, since every value this compares is minted at
 * one fixed size. Every same-length entry is compared, with no early exit.
 */
function matchConstantTime(known: Iterable<string>, candidate: string | null | undefined): string | null {
  if (typeof candidate !== "string" || candidate.length === 0) return null;
  const probe = Buffer.from(candidate, "utf8");
  let matched: string | null = null;
  for (const value of known) {
    const expected = Buffer.from(value, "utf8");
    if (expected.length !== probe.length) continue;
    if (timingSafeEqual(expected, probe)) matched = value;
  }
  return matched;
}

/** Throws from an expression position, so a guard can stay a single statement. */
function raise(message: string): never {
  throw new Error(message);
}
