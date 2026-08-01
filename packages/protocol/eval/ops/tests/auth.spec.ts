import { describe, expect, it, beforeAll } from "bun:test";
import path from "node:path";

import { ALLOWED_EMAIL_DOMAIN, ApiIdentityResolver, assessIdentity, buildBridgeUrl, MAX_PENDING_STATES, OneTimeStateStore, OpsSessionStore, type ResolvedIdentity } from "../ops.auth.js";

/**
 * The bridge page's own validator, loaded from the file that actually runs in
 * the browser app. This is a pin, not a copy: a URL this suite calls valid is
 * checked by `apps/web/src/lib/cli-auth.ts` itself, so a future tightening of
 * that validator fails here instead of silently breaking ops sign-in.
 *
 * It is imported through a computed specifier because the eval TypeScript
 * project is rooted at packages/protocol and cannot name a file outside it.
 * cli-auth.ts has no imports of its own, so loading it standalone is safe.
 */
const CLI_AUTH_PATH = path.join(import.meta.dir, "../../../../../apps/web/src/lib/cli-auth.ts");

interface CliAuthModule {
  validateCliAuthState(value: string | null): string | null;
  validateCliCallbackUrl(value: string | null): string | null;
  parseCliAuthRequest(params: URLSearchParams): { protocolVersion: 1; callback: string } | { protocolVersion: 2; callback: string; state: string } | null;
}

let cliAuth: CliAuthModule;

beforeAll(async () => {
  cliAuth = (await import(CLI_AUTH_PATH)) as CliAuthModule;
});

function identity(overrides: Partial<ResolvedIdentity> = {}): ResolvedIdentity {
  return { email: "a@index.network", emailVerified: true, name: "Ada", ...overrides };
}

// ---------------------------------------------------------------------------
// Domain policy
// ---------------------------------------------------------------------------

describe("assessIdentity", () => {
  it("allows a verified address on the exact allowed domain", () => {
    const verdict = assessIdentity(identity());
    expect(verdict.allowed).toBe(true);
    if (!verdict.allowed) throw new Error("unreachable");
    expect(verdict.identity).toEqual({ email: "a@index.network", name: "Ada" });
  });

  it("allows regardless of case", () => {
    expect(assessIdentity(identity({ email: "A@INDEX.NETWORK" })).allowed).toBe(true);
  });

  it("refuses an unverified address on the allowed domain", () => {
    const verdict = assessIdentity(identity({ emailVerified: false }));
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error("unreachable");
    expect(verdict.reason).toContain("not verified");
  });

  // The classic hole: a suffix test on the domain would allow this.
  it("refuses a domain that only starts with the allowed domain", () => {
    expect(assessIdentity(identity({ email: "a@index.network.evil.com" })).allowed).toBe(false);
  });

  it("refuses a subdomain of the allowed domain", () => {
    expect(assessIdentity(identity({ email: "a@sub.index.network" })).allowed).toBe(false);
  });

  // The Unicode hole. `toLowerCase()` is a *Unicode* operation, so without the
  // DOMAIN_CHARACTERS guard U+212A KELVIN SIGN folds to ASCII `k` and
  // `index.networ<KELVIN>` — a domain that is not ours — passes the rule. The
  // code points are written as escapes on purpose: spelled literally they look
  // like typos and someone will "fix" them.
  it("refuses a domain that only lowercases into the allowed domain", () => {
    for (const email of [
      "a@index.networ\u212A", // U+212A KELVIN SIGN -> toLowerCase() gives ASCII "k"
      "a@\uFF49ndex.network", // U+FF49 FULLWIDTH LATIN SMALL LETTER I
      "a@index\u3002network", // U+3002 IDEOGRAPHIC FULL STOP
    ]) {
      const verdict = assessIdentity(identity({ email }));
      expect({ email: JSON.stringify(email), allowed: verdict.allowed }).toEqual({ email: JSON.stringify(email), allowed: false });
    }
  });

  it("trims the address rather than storing and echoing the whitespace", () => {
    const verdict = assessIdentity(identity({ email: "  a@index.network " }));
    expect(verdict.allowed).toBe(true);
    if (!verdict.allowed) throw new Error("unreachable");
    expect(verdict.identity.email).toBe("a@index.network");
  });

  // ResolvedIdentity is the contract for any injected resolver, and A2
  // serialises the allowed identity toward the browser.
  it("coerces a non-string name to a string", () => {
    const verdict = assessIdentity(identity({ name: undefined as unknown as string }));
    expect(verdict.allowed).toBe(true);
    if (!verdict.allowed) throw new Error("unreachable");
    expect(verdict.identity.name).toBe("");
  });

  // Refused by the last-@ rule: the domain here is evil.com, whatever the local part says.
  it("refuses an address whose allowed domain is not after the last @", () => {
    const verdict = assessIdentity(identity({ email: '"a@index.network"@evil.com' }));
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error("unreachable");
    expect(verdict.reason).toContain(`not an @${ALLOWED_EMAIL_DOMAIN} address`);
  });

  // Refused by the multi-@ rule: the last-@ domain IS index.network, so only the
  // ambiguity guard stops this one. A different branch from the case above.
  it("refuses an address it cannot read unambiguously", () => {
    const verdict = assessIdentity(identity({ email: "a@evil.com?x=@index.network" }));
    expect(verdict.allowed).toBe(false);
    if (verdict.allowed) throw new Error("unreachable");
    expect(verdict.reason).toContain("unambiguous");
  });

  // Guards the guard: the multi-@ rule must not become "refuse everything".
  it("still admits an ordinary single-@ address", () => {
    for (const email of ["a@index.network", "first.last+tag@index.network"]) {
      expect({ email, allowed: assessIdentity(identity({ email })).allowed }).toEqual({ email, allowed: true });
    }
  });

  it("refuses a missing, empty or domain-less address", () => {
    for (const email of [null, undefined, "", "   ", "a", "@index.network", "a@"]) {
      const verdict = assessIdentity(identity({ email: email as string | null }));
      expect({ email, allowed: verdict.allowed }).toEqual({ email, allowed: false });
    }
  });

  it("refuses a missing identity", () => {
    expect(assessIdentity(null).allowed).toBe(false);
  });

  it("states the allowed domain once, as a constant", () => {
    expect(ALLOWED_EMAIL_DOMAIN).toBe("index.network");
  });
});

// ---------------------------------------------------------------------------
// One-time state
// ---------------------------------------------------------------------------

describe("OneTimeStateStore", () => {
  // Asserted through the bridge's own validator, not a copy of its pattern: a
  // hand-written regex here would still pass if the bridge tightened its own.
  it("mints a state the bridge's own validator accepts", () => {
    const state = new OneTimeStateStore().mint();
    expect(cliAuth.validateCliAuthState(state)).toBe(state);
  });

  it("mints a distinct state every time", () => {
    const store = new OneTimeStateStore();
    const minted = new Set([store.mint(), store.mint(), store.mint()]);
    expect(minted.size).toBe(3);
  });

  it("accepts a state once and refuses the replay", () => {
    const store = new OneTimeStateStore();
    const state = store.mint();
    expect(store.consume(state)).toBe(true);
    expect(store.consume(state)).toBe(false);
  });

  it("refuses a state that has expired", () => {
    let now = 1_000;
    const store = new OneTimeStateStore({ ttlMs: 100, now: () => now });
    const state = store.mint();
    now += 101;
    expect(store.consume(state)).toBe(false);
  });

  it("still accepts a state inside its window", () => {
    let now = 1_000;
    const store = new OneTimeStateStore({ ttlMs: 100, now: () => now });
    const state = store.mint();
    now += 99;
    expect(store.consume(state)).toBe(true);
  });

  it("refuses an unknown, empty or absent state without throwing", () => {
    const store = new OneTimeStateStore();
    const state = store.mint();
    expect(store.consume("not-the-state")).toBe(false);
    expect(store.consume(`${state}x`)).toBe(false);
    expect(store.consume("")).toBe(false);
    expect(store.consume(null)).toBe(false);
    // None of the above may have consumed the real one.
    expect(store.consume(state)).toBe(true);
  });

  // POST /api/auth/login is public and a process running as another user on the
  // same machine can hammer it; unbounded pending states would slow every
  // consume() the real operator makes. The newest mint always survives.
  it("caps the outstanding states, evicting the oldest", () => {
    const store = new OneTimeStateStore({ maxPending: 4 });
    const states = [store.mint(), store.mint(), store.mint(), store.mint()];
    const newest = store.mint();
    expect(store.consume(states[0])).toBe(false);
    expect(store.consume(newest)).toBe(true);
    expect(store.consume(states[3])).toBe(true);
  });

  it("caps at MAX_PENDING_STATES by default", () => {
    const store = new OneTimeStateStore();
    const first = store.mint();
    for (let i = 0; i < MAX_PENDING_STATES; i += 1) store.mint();
    expect(store.consume(first)).toBe(false);
  });

  it("keeps concurrent states independent", () => {
    const store = new OneTimeStateStore();
    const first = store.mint();
    const second = store.mint();
    expect(store.consume(second)).toBe(true);
    expect(store.consume(first)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bridge URL
// ---------------------------------------------------------------------------

describe("buildBridgeUrl", () => {
  // A genuinely minted state, not a synthetic "sss…": a placeholder satisfies
  // almost any tightening of the bridge's pattern, so it would not catch the
  // one regression this pin exists for — the bridge rejecting base64url's
  // `-` and `_`.
  const state = new OneTimeStateStore().mint();

  it("builds the exact URL the bridge page expects", () => {
    const url = buildBridgeUrl({ webAppUrl: "http://localhost:3000", callbackPort: 4321, state });
    expect(url).toBe(`http://localhost:3000/cli-auth?callback=http%3A%2F%2F127.0.0.1%3A4321%2Fcallback&version=2&state=${state}`);
  });

  it("produces a request the real bridge validator parses as protocol v2", () => {
    const url = new URL(buildBridgeUrl({ webAppUrl: "https://index.network", callbackPort: 5174, state }));
    expect(url.pathname).toBe("/cli-auth");
    const request = cliAuth.parseCliAuthRequest(url.searchParams);
    expect(request).toEqual({ protocolVersion: 2, callback: "http://127.0.0.1:5174/callback", state });
  });

  it("produces a callback the real bridge validator accepts", () => {
    const url = new URL(buildBridgeUrl({ webAppUrl: "https://index.network", callbackPort: 65535, state }));
    expect(cliAuth.validateCliCallbackUrl(url.searchParams.get("callback"))).toBe("http://127.0.0.1:65535/callback");
  });

  it("tolerates a trailing slash on the web app URL", () => {
    const url = buildBridgeUrl({ webAppUrl: "http://localhost:3000/", callbackPort: 4321, state });
    expect(new URL(url).pathname).toBe("/cli-auth");
  });

  it("refuses a port the bridge validator would reject", () => {
    for (const callbackPort of [0, -1, 65536, 1.5, Number.NaN]) {
      expect(() => buildBridgeUrl({ webAppUrl: "http://localhost:3000", callbackPort, state })).toThrow(/port/i);
    }
  });

  it("refuses a state the bridge validator would reject", () => {
    for (const bad of ["", "short", "has spaces in it and is long enough!!!!!!!", "x".repeat(129)]) {
      expect(() => buildBridgeUrl({ webAppUrl: "http://localhost:3000", callbackPort: 4321, state: bad })).toThrow(/state/i);
      expect(cliAuth.validateCliAuthState(bad)).toBeNull();
    }
  });

  // A base with its own path or query silently yields a URL whose pathname is
  // not /cli-auth, and garbage would throw a raw TypeError from the URL parser.
  it("refuses a web app URL that does not resolve to /cli-auth", () => {
    for (const webAppUrl of ["", "not a url", "http://localhost:3000/app", "http://localhost:3000?next=/x", "http://localhost:3000#frag"]) {
      expect(() => buildBridgeUrl({ webAppUrl, callbackPort: 4321, state })).toThrow(/sign-in URL/i);
    }
  });

  it("refuses a web app URL that is not http(s)", () => {
    for (const webAppUrl of ["file:///tmp", "javascript:alert(1)//", "ftp://example.com"]) {
      expect(() => buildBridgeUrl({ webAppUrl, callbackPort: 4321, state })).toThrow(/sign-in URL/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Identity resolution
// ---------------------------------------------------------------------------

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

/** Answers with a canned response and records the call. No socket is opened. */
function stubFetch(responder: (url: string) => Response): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    return responder(url);
  };
  return { fetch: impl as unknown as typeof fetch, calls };
}

/** The shape `/api/auth/me` actually returns (services/api/src/controllers/auth.controller.ts). */
function meResponse(user: Record<string, unknown>): Response {
  return Response.json({
    user: { id: "u1", key: null, avatar: null, socials: [], notificationPreferences: {}, ...user },
    features: { negotiatorChat: false, signalAgent: false, agentSurface: false, agentActions: false, fastSignalIntake: false },
  });
}

describe("ApiIdentityResolver", () => {
  it("sends the credential as x-api-key and never in the URL", async () => {
    const stub = stubFetch(() => meResponse({ email: "a@index.network", emailVerified: true, name: "Ada" }));
    const resolver = new ApiIdentityResolver({ apiUrl: "http://localhost:3001/", fetch: stub.fetch });
    await resolver.resolve("secret-key");

    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].url).toBe("http://localhost:3001/api/auth/me");
    expect(stub.calls[0].url).not.toContain("secret-key");
    expect(new Headers(stub.calls[0].init?.headers).get("x-api-key")).toBe("secret-key");
  });

  it("maps the real response body to a resolved identity", async () => {
    const stub = stubFetch(() => meResponse({ email: "a@index.network", emailVerified: true, name: "Ada" }));
    const resolver = new ApiIdentityResolver({ apiUrl: "http://localhost:3001", fetch: stub.fetch });
    expect(await resolver.resolve("secret-key")).toEqual({ email: "a@index.network", emailVerified: true, name: "Ada" });
  });

  it("reports an unverified user as unverified rather than dropping the field", async () => {
    const stub = stubFetch(() => meResponse({ email: "a@index.network", emailVerified: false, name: "Ada" }));
    const resolver = new ApiIdentityResolver({ apiUrl: "http://localhost:3001", fetch: stub.fetch });
    expect(await resolver.resolve("secret-key")).toEqual({ email: "a@index.network", emailVerified: false, name: "Ada" });
  });

  it("resolves nothing when the credential is refused", async () => {
    const stub = stubFetch(() => Response.json({ error: "Access token or API key required" }, { status: 401 }));
    const resolver = new ApiIdentityResolver({ apiUrl: "http://localhost:3001", fetch: stub.fetch });
    expect(await resolver.resolve("secret-key")).toBeNull();
  });

  it("resolves nothing when the body is not the documented shape", async () => {
    for (const body of [{}, { user: null }, { user: { email: 42 } }, "not json at all"]) {
      const stub = stubFetch(() => (typeof body === "string" ? new Response(body) : Response.json(body)));
      const resolver = new ApiIdentityResolver({ apiUrl: "http://localhost:3001", fetch: stub.fetch });
      expect(await resolver.resolve("secret-key")).toBeNull();
    }
  });

  it("fails closed when the verified flag is missing", async () => {
    const stub = stubFetch(() => meResponse({ email: "a@index.network", name: "Ada" }));
    const resolver = new ApiIdentityResolver({ apiUrl: "http://localhost:3001", fetch: stub.fetch });
    const resolved = await resolver.resolve("secret-key");
    expect(resolved).toEqual({ email: "a@index.network", emailVerified: false, name: "Ada" });
    expect(assessIdentity(resolved).allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Ops session
// ---------------------------------------------------------------------------

describe("OpsSessionStore", () => {
  const allowed = { email: "a@index.network", name: "Ada" };

  it("mints an unguessable, URL-safe session value", () => {
    const store = new OpsSessionStore();
    const token = store.establish(allowed);
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(store.establish(allowed)).not.toBe(token);
  });

  it("looks a session up by its value", () => {
    const store = new OpsSessionStore();
    const token = store.establish(allowed);
    expect(store.lookup(token)).toEqual(allowed);
  });

  it("stores nothing beyond the identity, so no credential can reach the browser", () => {
    const store = new OpsSessionStore();
    const session = store.lookup(store.establish(allowed));
    expect(Object.keys(session ?? {}).sort()).toEqual(["email", "name"]);
    expect(JSON.stringify(session)).not.toContain("key");
  });

  it("returns nothing for an unknown, empty or absent value", () => {
    const store = new OpsSessionStore();
    store.establish(allowed);
    expect(store.lookup("nope")).toBeNull();
    expect(store.lookup("")).toBeNull();
    expect(store.lookup(null)).toBeNull();
  });

  it("clears one session without disturbing another", () => {
    const store = new OpsSessionStore();
    const first = store.establish(allowed);
    const second = store.establish({ email: "b@index.network", name: "Bob" });
    expect(store.clear(first)).toBe(true);
    expect(store.lookup(first)).toBeNull();
    expect(store.lookup(second)).toEqual({ email: "b@index.network", name: "Bob" });
    expect(store.clear(first)).toBe(false);
  });
});
