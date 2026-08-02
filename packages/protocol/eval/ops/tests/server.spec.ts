import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { FsArtifactSource } from "../ops.artifacts.js";
import { ApiIdentityResolver, JwtIdentityResolver, OneTimeStateStore, OpsSessionStore, type IdentityResolver, type ResolvedIdentity } from "../ops.auth.js";
import { InMemoryConfigStore } from "../ops.configs.js";
import type { ExecutionStep, RunExecutor } from "../ops.executor.js";
import { SEED_STEP_CWD, type FixtureCounts, type FixtureInspector } from "../ops.fixture.js";
import { isOpsServerPath, OPS_CALLBACK_PATH } from "../ops.paths.js";
import { RunQueue } from "../ops.queue.js";
import { createDefaultOpsContext, createOpsHandler, PUBLIC_ROUTES, resolveBindHostname, resolveBindPort, resolveIdentityEndpoints, resolvePublicOrigin, resolveSignInMode, validateResetEnvFile, type OpsAuthContext, type OpsContext } from "../ops.server.js";
import { FsRunStore, type RunStore } from "../ops.store.js";
import type { RunRecord } from "../ops.types.js";
import { EVAL_RUN_REPORT_ARTIFACT_TYPE, buildEvalArtifact, buildScorecard } from "../../shared/index.js";
import { makeSuccessfulExecution, makeTestMeta } from "../../shared/tests/artifact.fixtures.js";

const DATABASE_URL = "postgres://u:p@host/neondb";

interface StartCall {
  record: RunRecord;
  steps: readonly ExecutionStep[] | undefined;
}

/** Records what the server asked for instead of spawning anything. */
class FakeExecutor implements RunExecutor {
  readonly starts: StartCall[] = [];
  readonly cancels: string[] = [];
  /** Held open so a test can observe a run that is still in flight. */
  gate: Promise<void> | null = null;
  /** Models a harness that ignores SIGINT: cancel() never settles. */
  cancelHangs = false;

  constructor(private readonly store: RunStore) {}

  async start(record: RunRecord, steps?: readonly ExecutionStep[]): Promise<RunRecord> {
    this.starts.push({ record, steps });
    if (this.gate !== null) await this.gate;
    return await this.store.update(record.id, { status: "passed", exitCode: 0, endedAt: new Date().toISOString() });
  }

  async cancel(id: string): Promise<RunRecord> {
    this.cancels.push(id);
    if (this.cancelHangs) await new Promise<never>(() => {});
    const record = await this.store.get(id);
    if (record === null) throw new Error(`Unknown run id: ${id}`);
    return record;
  }
}

const COUNTS: FixtureCounts = {
  personas: 2,
  personaEmails: ["seed-tester-1@index-network.test", "seed-tester-2@index-network.test"],
  tables: { users: 2, intents: 5, opportunities: 7 },
};

/** Hands back whatever identity a test set, without an API, a socket or a key. */
class StubIdentityResolver implements IdentityResolver {
  /** Credentials this resolver was handed, so a test can prove one was discarded. */
  readonly seen: string[] = [];
  identity: ResolvedIdentity | null = { email: "operator@index.network", emailVerified: true, name: "Operator" };
  failure: Error | null = null;

  async resolve(credential: string): Promise<ResolvedIdentity | null> {
    this.seen.push(credential);
    if (this.failure !== null) throw this.failure;
    return this.identity;
  }
}

/**
 * A syntactically plausible better-auth JWT for the deployed sign-in tests.
 *
 * The stub resolver never inspects it; it exists so a test can assert the exact
 * string the browser submitted was handed to the resolver once and then never
 * appears anywhere else.
 */
const JWT = "eyJhbGciOiJFZERTQSJ9.eyJpZCI6InUxIn0.c2lnbmF0dXJl";

let root: string;
let store: FsRunStore;
let executor: FakeExecutor;
let configs: InMemoryConfigStore;
let context: OpsContext;
let handler: (request: Request) => Promise<Response>;
let states: OneTimeStateStore;
let sessions: OpsSessionStore;
let identities: StubIdentityResolver;
/** A `Cookie` header for a signed-in operator, refreshed by `signIn()`. */
let sessionCookie: Record<string, string>;

async function build(overrides: Partial<OpsContext> = {}, auth: Partial<OpsAuthContext> = {}): Promise<void> {
  const evalDir = path.join(root, "eval");
  const profilesDir = path.join(evalDir, "ops/profiles");
  await mkdir(profilesDir, { recursive: true });
  await writeFile(
    path.join(profilesDir, "default.json"),
    JSON.stringify({ name: "default", description: "d", models: {}, env: {} }),
  );
  await writeFile(
    path.join(profilesDir, "claude-evaluator.json"),
    JSON.stringify({ name: "claude-evaluator", description: "c", models: { opportunityEvaluator: "anthropic/claude" }, env: {} }),
  );
  store = new FsRunStore({ evalDir });
  executor = new FakeExecutor(store);
  configs = new InMemoryConfigStore();
  states = new OneTimeStateStore();
  sessions = new OpsSessionStore();
  identities = new StubIdentityResolver();
  context = {
    evalDir,
    protocolDir: root,
    repoRoot: root,
    profilesDir,
    artifacts: new FsArtifactSource({ evalDir }),
    store,
    executor,
    queue: new RunQueue({ executor, store }),
    configs,
    databaseUrl: DATABASE_URL,
    inspector: { count: async () => COUNTS },
    auth: {
      sessions,
      identities,
      uiUrl: "http://127.0.0.1:5174",
      signIn: { kind: "bridge", states, webAppUrl: "https://index.network", callbackPort: 4321 },
      ...auth,
    },
    ...overrides,
  };
  handler = createOpsHandler(context);
  sessionCookie = {};
  // Signed in through whichever door this posture actually opens: the tests past
  // this point assert behaviour behind the gate, not the gate itself.
  if (context.auth?.signIn.kind === "token") await signInWithToken();
  else await signIn();
}

/**
 * Drives a full bridge round-trip and leaves `sessionCookie` holding the session.
 *
 * Called by `build()` rather than only once, because a test that rebuilds the
 * context gets fresh stores — a cookie minted against the old ones would no
 * longer resolve, and every assertion after it would fail on a 401 instead of
 * the behaviour it meant to check.
 */
async function signIn(): Promise<void> {
  const state = states.mint();
  const response = await handler(
    new Request(`http://localhost/callback?state=${state}&api_key=test-credential`),
  );
  const cookie = response.headers.get("set-cookie");
  if (cookie === null) throw new Error(`sign-in did not set a session cookie (status ${response.status})`);
  sessionCookie = { Cookie: cookie.split(";")[0] };
  // The sign-in above exchanged one credential; a test asserting "the credential
  // was never looked at" must not see this one.
  identities.seen.length = 0;
}

/** The deployed equivalent: submit a token, receive the same session cookie. */
async function signInWithToken(): Promise<void> {
  const response = await handler(
    new Request("http://localhost/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: JWT }),
    }),
  );
  const cookie = response.headers.get("set-cookie");
  if (cookie === null) throw new Error(`sign-in did not set a session cookie (status ${response.status})`);
  sessionCookie = { Cookie: cookie.split(";")[0] };
  identities.seen.length = 0;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ops-server-"));
  await build();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// Every existing test drives the server as a signed-in operator: authentication
// is a new gate in front of behaviour those tests already pinned, so they carry
// the session and keep asserting the behaviour rather than the gate. The gate
// itself is pinned by `describe("authentication")` below.
const get = (url: string, headers: Record<string, string> = {}) =>
  handler(new Request(`http://localhost${url}`, { headers: { ...sessionCookie, ...headers } }));
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  handler(
    new Request(`http://localhost${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...sessionCookie, ...headers },
      body: JSON.stringify(body),
    }),
  );
const patch = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  handler(
    new Request(`http://localhost${url}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...sessionCookie, ...headers },
      body: JSON.stringify(body),
    }),
  );
const del = (url: string, headers: Record<string, string> = {}) =>
  handler(new Request(`http://localhost${url}`, { method: "DELETE", headers: { ...sessionCookie, ...headers } }));

const RUN_BODY = { kind: "eval", harness: "matching", profile: "default", flags: {} };

describe("ops API", () => {
  it("lists harnesses from the registry", async () => {
    const response = await get("/api/harnesses");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.harnesses.map((h: { harness: string }) => h.harness).sort()).toEqual([
      "matching",
      "opportunity",
      "premise",
      "profile",
    ]);
  });

  it("lists the committed profiles", async () => {
    const body = await (await get("/api/profiles")).json();
    expect(body.profiles.map((p: { name: string }) => p.name)).toEqual(["claude-evaluator", "default"]);
  });

  it("lists artifacts with their index issues", async () => {
    const body = await (await get("/api/artifacts")).json();
    expect(body).toHaveProperty("refs");
    expect(body).toHaveProperty("issues");
  });

  it("rejects a run spec containing a destructive flag", async () => {
    const response = await post("/api/runs", {
      kind: "eval",
      harness: "matching",
      profile: "default",
      flags: { updateBaseline: true },
    });
    expect(response.status).toBe(400);
  });

  it("rejects an unknown harness", async () => {
    const response = await post("/api/runs", { kind: "eval", harness: "hyde", profile: "default", flags: {} });
    expect(response.status).toBe(400);
  });

  it("rejects an unknown profile name", async () => {
    const response = await post("/api/runs", { kind: "eval", harness: "matching", profile: "nope", flags: {} });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/profile/i);
  });

  it("never accepts raw environment from the client", async () => {
    const response = await post("/api/runs", {
      kind: "eval",
      harness: "matching",
      profile: "default",
      flags: {},
      env: { DATABASE_URL: "postgres://evil" },
    });
    expect(response.status).toBe(400);
  });

  it("never accepts raw argv from the client", async () => {
    const response = await post("/api/runs", {
      kind: "eval",
      harness: "matching",
      profile: "default",
      flags: {},
      argv: ["rm", "-rf", "/"],
    });
    expect(response.status).toBe(400);
  });

  it("refuses to launch the fixture-reset spec through the run route", async () => {
    const response = await post("/api/runs", { kind: "fixture-reset", personas: 1, migrate: true, databaseName: "neondb" });
    expect(response.status).toBe(400);
    expect(executor.starts).toHaveLength(0);
  });

  it("reports the fixture target without credentials", async () => {
    const body = await (await get("/api/fixture")).json();
    expect(body.allowed).toBe(true);
    expect(JSON.stringify(body)).not.toContain(":p@");
  });

  it("exposes the seed API keys path as a repo-relative location without credentials", async () => {
    const body = await (await get("/api/fixture")).json();
    expect(body.allowed).toBe(true);
    expect(body.seedApiKeysPath).toBe("services/api/.seed-api-keys.json");
    // The path is a location, not content: no key material should be returned.
    expect(JSON.stringify(body)).not.toContain("apiKey");
    expect(JSON.stringify(body)).not.toContain("API_KEY");
  });

  it("derives the seed API keys path from the seed step's cwd so the two cannot drift", async () => {
    const body = await (await get("/api/fixture")).json();
    expect(body.allowed).toBe(true);
    // The reported path MUST match where db:seed actually writes the file,
    // which is process.cwd() + ".seed-api-keys.json" with cwd set to SEED_STEP_CWD.
    expect(body.seedApiKeysPath).toBe(path.join(SEED_STEP_CWD, ".seed-api-keys.json"));
  });

  it("returns 404 for an unknown route", async () => {
    expect((await get("/api/nope")).status).toBe(404);
  });
});

describe("POST /api/runs", () => {
  it("renders argv from the registry and queues the run", async () => {
    const response = await post("/api/runs", {
      kind: "eval",
      harness: "matching",
      profile: "default",
      flags: { runs: 2, tier: 1 },
    });

    expect(response.status).toBe(202);
    const record = (await response.json()) as RunRecord;
    expect(record.argv.slice(0, 4)).toEqual(["bun", "run", "eval:matching", "--"]);
    expect(record.argv).toContain("--runs");
    expect(record.argv).toContain("--tier");
    expect(record.argv).toContain("--report");
    expect(record.workload).toBe(2);
    expect(record.experimental).toBe(false);

    await context.queue.drain();
    expect(executor.starts.map((call) => call.record.id)).toEqual([record.id]);
    // The queue drives the single-command path: the server never hands it steps.
    expect(executor.starts[0].steps).toBeUndefined();
  });

  it("forces --no-save for an experimental profile", async () => {
    const response = await post("/api/runs", {
      kind: "eval",
      harness: "profile",
      profile: "claude-evaluator",
      flags: {},
    });

    const record = (await response.json()) as RunRecord;
    expect(record.argv).toContain("--no-save");
    expect(record.experimental).toBe(true);
    await context.queue.drain();
  });

  it("rejects a body that is not JSON", async () => {
    const response = await handler(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sessionCookie },
        body: "not json",
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects a selection flag whose value would read as another flag", async () => {
    const response = await post("/api/runs", {
      kind: "eval",
      harness: "matching",
      profile: "default",
      flags: { case: "--update-baseline" },
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/flags\.case/);
    await context.queue.drain();
    expect(executor.starts).toHaveLength(0);
  });

  it("lists the launched runs with any corrupt records", async () => {
    await post("/api/runs", { kind: "eval", harness: "premise", profile: "default", flags: {} });
    await context.queue.drain();

    const body = await (await get("/api/runs")).json();
    expect(body.runs).toHaveLength(1);
    expect(body.issues).toEqual([]);
  });
});

describe("launch with overrides", () => {
  const PAYLOAD = { models: { opportunityEvaluator: "anthropic/claude-sonnet-4" }, env: {} };

  it("launches an ad-hoc run as experimental with the overrides env injected", async () => {
    const response = await post("/api/runs", {
      kind: "eval",
      harness: "matching",
      profile: "default",
      flags: { runs: 1 },
      overrides: PAYLOAD,
    });

    expect(response.status).toBe(202);
    const record = (await response.json()) as RunRecord;
    expect(record.experimental).toBe(true);
    expect(record.env.EVAL_MODEL_OVERRIDES).toBe(JSON.stringify(PAYLOAD.models));
    expect(record.argv).toContain("--no-save");
    await context.queue.drain();
  });

  it("fingerprints an ad-hoc run identically to a saved config with the same payload", async () => {
    const created = await post("/api/configs", { name: "candidate", description: "c", ...PAYLOAD });
    expect(created.status).toBe(201);

    const named = (await (await post("/api/runs", {
      kind: "eval",
      harness: "matching",
      profile: "candidate",
      flags: { runs: 1 },
    })).json()) as RunRecord;
    const adHoc = (await (await post("/api/runs", {
      kind: "eval",
      harness: "matching",
      profile: "default",
      flags: { runs: 1 },
      overrides: PAYLOAD,
    })).json()) as RunRecord;

    expect(named.profileFingerprint).toBe(adHoc.profileFingerprint);
    expect(named.experimental).toBe(true);
    expect(adHoc.experimental).toBe(true);
    await context.queue.drain();
  });

  it("rejects a named profile combined with overrides", async () => {
    const response = await post("/api/runs", {
      kind: "eval",
      harness: "matching",
      profile: "claude-evaluator",
      flags: {},
      overrides: PAYLOAD,
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/overrides/);
    await context.queue.drain();
    expect(executor.starts).toHaveLength(0);
  });

  it("rejects override models outside the curated list at launch", async () => {
    const response = await post("/api/runs", {
      kind: "eval",
      harness: "matching",
      profile: "default",
      flags: {},
      overrides: { models: { opportunityEvaluator: "anthropic/claude-opus-9" }, env: {} },
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/claude-opus-9/);
    await context.queue.drain();
    expect(executor.starts).toHaveLength(0);
  });

  it("resolves a saved DB config exactly like a repo profile", async () => {
    await configs.create({ name: "sonnet-evaluator", description: "d", ...PAYLOAD });

    const response = await post("/api/runs", {
      kind: "eval",
      harness: "matching",
      profile: "sonnet-evaluator",
      flags: { runs: 1 },
    });

    expect(response.status).toBe(202);
    const record = (await response.json()) as RunRecord;
    expect(record.experimental).toBe(true);
    expect(record.env.EVAL_MODEL_OVERRIDES).toBe(JSON.stringify(PAYLOAD.models));
    expect(record.argv).toContain("--no-save");
    await context.queue.drain();
  });
});

describe("cross-origin requests", () => {
  // A page on any origin the operator has open can POST here with mode:"no-cors";
  // it cannot read the reply, but the run it launches spends real tokens.
  it("refuses a run launched by another origin", async () => {
    const response = await post("/api/runs", RUN_BODY, { Origin: "https://evil.example" });

    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/evil\.example/);
    // No CORS header is granted either, so the refusal itself stays unreadable.
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect((await store.list()).records).toHaveLength(0);
    await context.queue.drain();
    expect(executor.starts).toHaveLength(0);
  });

  it("refuses a fixture reset launched by another origin", async () => {
    await writeFile(path.join(root, ".env.test"), `DATABASE_URL=${DATABASE_URL}\n`);

    const response = await post(
      "/api/fixture/reset",
      { confirmDatabaseName: "neondb", personas: 1 },
      { Origin: "https://evil.example" },
    );

    expect(response.status).toBe(403);
    expect(executor.starts).toHaveLength(0);
    // The refusal must not leave the reset slot claimed.
    expect((await post("/api/fixture/reset", { confirmDatabaseName: "neondb", personas: 1 })).status).toBe(202);
  });

  it("refuses a cancellation and an opaque sandboxed origin", async () => {
    expect((await post("/api/runs/anything/cancel", {}, { Origin: "https://evil.example" })).status).toBe(403);
    // A sandboxed frame or a file:// page sends the opaque origin "null".
    expect((await post("/api/runs", RUN_BODY, { Origin: "null" })).status).toBe(403);
    expect(executor.cancels).toHaveLength(0);
  });

  it("accepts the Vite dev server's loopback origin that Task 12 proxies from", async () => {
    const proxied = await post("/api/runs", RUN_BODY, {
      Origin: "http://127.0.0.1:5174",
      "Sec-Fetch-Site": "same-origin",
    });

    expect(proxied.status).toBe(202);
    expect((await post("/api/runs", RUN_BODY, { Origin: "http://localhost:4321" })).status).toBe(202);
    // curl and the proxy's own server-to-server hop carry neither header.
    expect((await post("/api/runs", RUN_BODY)).status).toBe(202);
    await context.queue.drain();
  });

  it("refuses a request with no Origin that fetch metadata says another site initiated", async () => {
    const response = await post("/api/runs", RUN_BODY, { "Sec-Fetch-Site": "cross-site" });

    expect(response.status).toBe(403);
    await context.queue.drain();
    expect(executor.starts).toHaveLength(0);
  });

  it("reads no body without a JSON content type", async () => {
    // The three content types a no-cors POST may set are all refused here.
    const response = await handler(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8", ...sessionCookie },
        body: JSON.stringify(RUN_BODY),
      }),
    );

    expect(response.status).toBe(415);
    await context.queue.drain();
    expect(executor.starts).toHaveLength(0);
  });

  it("leaves reads reachable: a GET is not a state change", async () => {
    const response = await handler(
      new Request("http://localhost/api/harnesses", { headers: { Origin: "https://evil.example", ...sessionCookie } }),
    );
    // Nothing here mutates, and without a CORS header the body stays unreadable
    // — provided the request actually reached this server as a loopback host,
    // which the Host guard below is what enforces.
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("Host header guard", () => {
  // Closes DNS rebinding: a page served from a hostname that resolves to 127.0.0.1
  // is same-origin to the browser, so the Origin allowlist above accepts it and no
  // CORS header is needed to read the reply. Only the Host header still names the
  // attacker's domain, so it is the one value worth checking — and unlike the
  // Origin guard it must apply to reads, which are what rebinding exists to steal.
  // Carries the session so the acceptance cases below reach the route rather than
  // the auth gate; the refusal cases are unaffected, since Host is checked first.
  const withHost = (host: string, path = "/api/harnesses") =>
    handler(new Request(`http://localhost${path}`, { headers: { Host: host, ...sessionCookie } }));

  it("refuses a GET whose Host names a foreign domain", async () => {
    const response = await withHost("evil.example.com");

    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/host/i);
  });

  it("refuses foreign-Host reads on every data route, not just one", async () => {
    for (const path of ["/api/artifacts", "/api/runs", "/api/fixture", "/api/profiles"]) {
      const response = await withHost("evil.example.com", path);
      expect(response.status).toBe(403);
    }
  });

  it("accepts every loopback host, with and without a port", async () => {
    for (const host of ["127.0.0.1:4321", "127.0.0.1", "localhost:4321", "localhost", "[::1]:4321", "[::1]"]) {
      const response = await withHost(host);
      expect(response.status).toBe(200);
    }
  });

  it("accepts a request with no Host header", async () => {
    // curl over an explicit socket, and any hop that drops it. A request with no
    // Host was not steered here by a resolved name, so rebinding does not apply.
    const response = await handler(new Request("http://localhost/api/harnesses", { headers: { ...sessionCookie } }));

    expect(response.status).toBe(200);
  });

  it("still refuses a foreign Host on a state-changing request", async () => {
    const response = await handler(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { Host: "evil.example.com", "Content-Type": "application/json", Origin: "http://127.0.0.1:5174" },
        body: JSON.stringify(RUN_BODY),
      }),
    );

    expect(response.status).toBe(403);
    await context.queue.drain();
    expect(executor.starts).toHaveLength(0);
  });
});

describe("the configured public origin", () => {
  // Deploying the site puts it on a real domain, where the loopback allowlists
  // above would refuse every request. They are therefore extended to exactly one
  // configured origin — never a wildcard, never a way to switch a guard off —
  // and an unset variable still means "loopback only", which is the whole of the
  // local posture. Every acceptance below is paired with a refusal, so a guard
  // that stopped checking would fail here rather than pass vacuously.
  const PUBLIC_ORIGIN = resolvePublicOrigin({ EVAL_OPS_PUBLIC_ORIGIN: "https://eval.index.network" });

  const deployed = (path: string, headers: Record<string, string> = {}) =>
    handler(new Request(`https://eval.index.network${path}`, { headers: { Host: "eval.index.network", ...sessionCookie, ...headers } }));

  const deployedPost = (path: string, headers: Record<string, string> = {}) =>
    handler(
      new Request(`https://eval.index.network${path}`, {
        method: "POST",
        headers: {
          Host: "eval.index.network",
          "Content-Type": "application/json",
          Origin: "https://eval.index.network",
          ...sessionCookie,
          ...headers,
        },
        body: JSON.stringify(RUN_BODY),
      }),
    );

  describe("with no public origin configured", () => {
    it("still refuses the deployed host and origin, so the default is loopback-only", async () => {
      expect(context.publicOrigin).toBeUndefined();

      expect((await deployed("/api/harnesses")).status).toBe(403);
      expect((await deployedPost("/api/runs")).status).toBe(403);
      await context.queue.drain();
      expect(executor.starts).toHaveLength(0);
    });
  });

  describe("with a public origin configured", () => {
    beforeEach(async () => {
      await build({ publicOrigin: PUBLIC_ORIGIN });
    });

    it("answers a read addressed to the configured host", async () => {
      const response = await deployed("/api/harnesses");

      expect(response.status).toBe(200);
    });

    it("accepts a write from the configured origin", async () => {
      const response = await deployedPost("/api/runs");

      expect(response.status).toBe(202);
      await context.queue.drain();
    });

    it("still refuses every other host — the allowlist is one entry, not a wildcard", async () => {
      for (const host of ["evil.example.com", "eval.index.network.evil.com", "sub.eval.index.network", "index.network"]) {
        const response = await handler(
          new Request("https://eval.index.network/api/harnesses", { headers: { Host: host, ...sessionCookie } }),
        );
        expect(response.status).toBe(403);
      }
    });

    it("still refuses every other origin on a write", async () => {
      for (const origin of [
        "https://evil.example",
        "https://eval.index.network.evil.com",
        "https://sub.eval.index.network",
        // The same name over plain http is a different origin, and not this one.
        "http://eval.index.network",
        "null",
      ]) {
        const response = await deployedPost("/api/runs", { Origin: origin });
        expect(response.status).toBe(403);
      }
      await context.queue.drain();
      expect(executor.starts).toHaveLength(0);
    });

    it("leaves loopback exactly as it was, so local development is unchanged", async () => {
      for (const host of ["127.0.0.1:4321", "localhost", "[::1]:4321"]) {
        expect((await get("/api/harnesses", { Host: host })).status).toBe(200);
      }
      expect((await post("/api/runs", RUN_BODY, { Origin: "http://127.0.0.1:5174" })).status).toBe(202);
      await context.queue.drain();
    });
  });
});

describe("the session cookie's Secure attribute", () => {
  // Loopback is plain http, so a Secure cookie is dropped by the browser and
  // sign-in fails silently; over HTTPS an insecure session cookie is a real
  // exposure. The attribute therefore follows the request, not a hand-set flag.
  const PUBLIC_ORIGIN = resolvePublicOrigin({ EVAL_OPS_PUBLIC_ORIGIN: "https://eval.index.network" });

  const signInAt = (url: string, headers: Record<string, string> = {}) =>
    handler(new Request(`${url}/callback?state=${states.mint()}&api_key=k`, { headers }));

  it("omits Secure on loopback, where a Secure cookie would never be sent", async () => {
    const response = await signInAt("http://localhost");

    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie") ?? "").not.toMatch(/Secure/i);
  });

  it("sets Secure on a sign-in served over HTTPS", async () => {
    await build({ publicOrigin: PUBLIC_ORIGIN });

    const response = await signInAt("https://eval.index.network", { Host: "eval.index.network" });

    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie") ?? "").toMatch(/;\s*Secure/i);
  });

  it("sets Secure behind a TLS-terminating proxy, which forwards plain http", async () => {
    // Railway terminates TLS at its edge and speaks http to the container, so the
    // request URL says http even though the browser is on https. The configured
    // public origin is validated to be https, so a request addressed to it was
    // served over https — that, not a spoofable x-forwarded-proto, is the signal.
    await build({ publicOrigin: PUBLIC_ORIGIN });

    const response = await signInAt("http://eval.index.network", { Host: "eval.index.network" });

    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie") ?? "").toMatch(/;\s*Secure/i);
  });

  it("does not trust x-forwarded-proto on a loopback request", async () => {
    // Any local page can send this header; it must not be able to make the
    // operator's own sign-in fail by getting the cookie dropped.
    const response = await signInAt("http://localhost", { "X-Forwarded-Proto": "https" });

    expect(response.status).toBe(302);
    expect(response.headers.get("set-cookie") ?? "").not.toMatch(/Secure/i);
  });

  it("expires the cookie with the same attributes it was set with", async () => {
    await build({ publicOrigin: PUBLIC_ORIGIN });

    const loopback = await post("/api/auth/logout", {});
    expect(loopback.headers.get("set-cookie") ?? "").not.toMatch(/Secure/i);

    await build({ publicOrigin: PUBLIC_ORIGIN });
    const deployed = await handler(
      new Request("https://eval.index.network/api/auth/logout", {
        method: "POST",
        headers: {
          Host: "eval.index.network",
          "Content-Type": "application/json",
          Origin: "https://eval.index.network",
          ...sessionCookie,
        },
        body: "{}",
      }),
    );
    expect(deployed.status).toBe(200);
    expect(deployed.headers.get("set-cookie") ?? "").toMatch(/;\s*Secure/i);
    expect(deployed.headers.get("set-cookie") ?? "").toMatch(/Max-Age=0/);
  });
});

describe("GET /api/artifacts/:id", () => {
  it("returns 400 for an id that escapes the eval directory", async () => {
    const id = Buffer.from("../../../etc/passwd", "utf8").toString("base64url");
    const response = await get(`/api/artifacts/${id}`);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/outside the eval directory/i);
  });

  it("returns 404 for an artifact that does not exist", async () => {
    const id = Buffer.from("matching/runs/absent.json", "utf8").toString("base64url");
    expect((await get(`/api/artifacts/${id}`)).status).toBe(404);
  });
});

describe("GET /api/compare", () => {
  it("requires both artifact ids", async () => {
    const response = await get("/api/compare?reference=abc");
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/reference/i);
  });

  describe("run-vs-run", () => {
    const caseResult = (caseId: string, passes: number, runs: number) => ({
      caseId,
      rule: "r",
      runs,
      passes,
      passRate: passes / runs,
      flaky: passes > 0 && passes < runs,
      scoredRunIds: Array.from({ length: runs }, (_, i) => `${encodeURIComponent(caseId)}::run:${i + 1}`),
    });

    /** A valid v2 run report on disk for a fresh run record. */
    async function seedRunWithReport(options: {
      profile: string;
      profileFingerprint: string;
      configFingerprint: string;
      passes: number;
    }): Promise<RunRecord> {
      const created = await store.create({
        spec: { kind: "eval", harness: "matching", profile: options.profile, flags: { runs: 20 } },
        argv: ["bun", "run", "eval:matching"],
        env: {},
        profileFingerprint: options.profileFingerprint,
        experimental: true,
        workload: 20,
      });
      const scorecard = buildScorecard([caseResult("a/b", options.passes, 20)], {
        model: "test/model",
        runs: 20,
      });
      const envelope = buildEvalArtifact(
        EVAL_RUN_REPORT_ARTIFACT_TYPE,
        scorecard,
        makeTestMeta({
          harness: "matching",
          runs: 20,
          configFingerprint: options.configFingerprint,
          execution: makeSuccessfulExecution(["a/b"], 20),
        }),
      );
      await Bun.write(store.reportPath(created.id), JSON.stringify(envelope));
      await store.update(created.id, { status: "passed", exitCode: 0, endedAt: new Date().toISOString() });
      return created;
    }

    it("diffs two run reports across configs and labels each side", async () => {
      const reference = await seedRunWithReport({
        profile: "default",
        profileFingerprint: "fp-reference",
        configFingerprint: "a".repeat(64),
        passes: 20,
      });
      const subject = await seedRunWithReport({
        profile: "sonnet-evaluator",
        profileFingerprint: "fp-subject",
        configFingerprint: "c".repeat(64),
        passes: 2,
      });

      const response = await get(`/api/compare?referenceRun=${reference.id}&subjectRun=${subject.id}`);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.comparable).toBe(true);
      expect(body.aggregate.delta).toBeLessThan(0);
      expect(body.runs.reference).toEqual({
        id: reference.id,
        profile: "default",
        profileFingerprint: "fp-reference",
        complete: true,
      });
      expect(body.runs.subject).toEqual({
        id: subject.id,
        profile: "sonnet-evaluator",
        profileFingerprint: "fp-subject",
        complete: true,
      });
    });

    it("422s naming the side whose report is missing", async () => {
      const reference = await seedRunWithReport({
        profile: "default",
        profileFingerprint: "fp-reference",
        configFingerprint: "a".repeat(64),
        passes: 20,
      });
      const subject = await store.create({
        spec: { kind: "eval", harness: "matching", profile: "default", flags: {} },
        argv: ["bun", "run", "eval:matching"],
        env: {},
        profileFingerprint: "fp-subject",
        experimental: true,
        workload: 20,
      });

      const response = await get(`/api/compare?referenceRun=${reference.id}&subjectRun=${subject.id}`);

      expect(response.status).toBe(422);
      expect((await response.json()).error).toContain(subject.id);
    });

    it("404s an unknown run id", async () => {
      const reference = await seedRunWithReport({
        profile: "default",
        profileFingerprint: "fp-reference",
        configFingerprint: "a".repeat(64),
        passes: 20,
      });

      const response = await get(`/api/compare?referenceRun=${reference.id}&subjectRun=nope`);

      expect(response.status).toBe(404);
      expect((await response.json()).error).toContain("nope");
    });

    it("400s when run params and artifact params are mixed", async () => {
      const response = await get("/api/compare?reference=a&subjectRun=b");
      expect(response.status).toBe(400);
    });

    it("400s when only one run param is given", async () => {
      const response = await get("/api/compare?referenceRun=a");
      expect(response.status).toBe(400);
    });
  });
});

describe("config routes", () => {
  const SONNET_CONFIG = {
    name: "sonnet-evaluator",
    description: "evaluator on sonnet",
    models: { opportunityEvaluator: "anthropic/claude-sonnet-4" },
    env: {},
  };

  it("lists repo profiles and saved configs in one response", async () => {
    await configs.create(SONNET_CONFIG);
    const response = await get("/api/configs");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.repo.map((p: { name: string }) => p.name)).toEqual(["claude-evaluator", "default"]);
    expect(body.saved).toEqual([SONNET_CONFIG]);
  });

  it("creates a config and rejects names colliding with a repo profile or a saved config", async () => {
    const created = await post("/api/configs", SONNET_CONFIG);
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual(SONNET_CONFIG);

    const duplicate = await post("/api/configs", SONNET_CONFIG);
    expect(duplicate.status).toBe(409);

    for (const name of ["default", "claude-evaluator"]) {
      const collision = await post("/api/configs", { ...SONNET_CONFIG, name });
      expect(collision.status).toBe(409);
      expect((await collision.json()).error).toContain(name);
    }
  });

  it("rejects models outside the curated list with a 400 naming the model", async () => {
    const response = await post("/api/configs", { ...SONNET_CONFIG, models: { opportunityEvaluator: "x/y" } });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("x/y");
  });

  it("rejects env keys outside the allowlist", async () => {
    const response = await post("/api/configs", { ...SONNET_CONFIG, env: { OPENROUTER_API_KEY: "x" } });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("OPENROUTER_API_KEY");
  });

  it("updates and deletes a saved config, 404s unknown names, 409s repo profile names", async () => {
    await configs.create(SONNET_CONFIG);

    const updated = await patch("/api/configs/sonnet-evaluator", { description: "better description" });
    expect(updated.status).toBe(200);
    const updatedBody = await updated.json();
    expect(updatedBody.description).toBe("better description");
    expect(updatedBody.models).toEqual(SONNET_CONFIG.models);
    expect(await configs.get("sonnet-evaluator")).toEqual(updatedBody);

    const patchedRepo = await patch("/api/configs/default", { description: "x" });
    expect(patchedRepo.status).toBe(409);
    const patchedGhost = await patch("/api/configs/ghost", { description: "x" });
    expect(patchedGhost.status).toBe(404);

    const deletedRepo = await del("/api/configs/default");
    expect(deletedRepo.status).toBe(409);
    const deletedGhost = await del("/api/configs/ghost");
    expect(deletedGhost.status).toBe(404);

    const deleted = await del("/api/configs/sonnet-evaluator");
    expect(deleted.status).toBe(204);
    expect(await configs.get("sonnet-evaluator")).toBeNull();
  });

  it("rejects an override patch that would make a saved config invalid", async () => {
    await configs.create(SONNET_CONFIG);
    const response = await patch("/api/configs/sonnet-evaluator", { models: { opportunityEvaluator: "x/y" } });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("x/y");
    expect((await configs.get("sonnet-evaluator"))?.models).toEqual(SONNET_CONFIG.models);
  });

  it("serves the curated model list", async () => {
    const response = await get("/api/configs/models");
    expect(response.status).toBe(200);
    expect((await response.json()).models).toContain("google/gemini-2.5-flash");
  });
});

describe("POST /api/runs/:id/cancel", () => {
  it("accepts the cancellation without waiting for a harness that ignores SIGINT", async () => {
    executor.cancelHangs = true;
    const created = await store.create({
      spec: { kind: "eval", harness: "matching", profile: "default", flags: {} },
      argv: ["bun", "run", "eval:matching"],
      env: {},
      profileFingerprint: "f",
      experimental: false,
      workload: 1,
    });
    await store.update(created.id, { status: "running", pid: 1 });

    const startedAt = Date.now();
    const response = await post(`/api/runs/${created.id}/cancel`, {});

    expect(response.status).toBe(202);
    expect((await response.json()).accepted).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(executor.cancels).toEqual([created.id]);
  });

  it("returns 404 for an unknown run", async () => {
    expect((await post("/api/runs/nope/cancel", {})).status).toBe(404);
  });
});

describe("GET /api/runs/:id/stream", () => {
  it("replays the log, reports the status and closes once the run is terminal", async () => {
    const created = await store.create({
      spec: { kind: "eval", harness: "matching", profile: "default", flags: {} },
      argv: ["bun", "run", "eval:matching"],
      env: {},
      profileFingerprint: "f",
      experimental: false,
      workload: 1,
    });
    await Bun.write(store.logPath(created.id), "scorecard line\n");
    await store.update(created.id, { status: "passed", exitCode: 0, endedAt: new Date().toISOString() });

    const response = await get(`/api/runs/${created.id}/stream`);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const body = await response.text();

    expect(body).toContain("event: status");
    expect(body).toContain("event: log");
    expect(body).toContain("scorecard line");
  });

  it("returns 404 for an unknown run", async () => {
    expect((await get("/api/runs/nope/stream")).status).toBe(404);
  });
});

describe("GET /api/fixture", () => {
  it("reports live counts from the inspector", async () => {
    const body = await (await get("/api/fixture")).json();
    expect(body.personaCount).toBe(2);
    expect(body.tables).toEqual({ users: 2, intents: 5, opportunities: 7 });
    expect(body.countsError).toBeNull();
  });

  it("reports the refusal reason instead of a target", async () => {
    await build({ databaseUrl: "postgres://u:p@host/protocol_prod" });
    const body = await (await get("/api/fixture")).json();
    expect(body.allowed).toBe(false);
    expect(body.reason).toMatch(/protocol_prod/);
    expect(body.target).toBeUndefined();
  });

  it("reports a count failure without echoing the connection string", async () => {
    const failing: FixtureInspector = {
      count: async () => {
        throw new Error(`connection to postgres://admin:hunter2@host/neondb?password=hunter2 failed`);
      },
    };
    await build({ inspector: failing });

    const body = await (await get("/api/fixture")).json();
    expect(body.allowed).toBe(true);
    expect(body.personaCount).toBeNull();
    expect(body.countsError).toMatch(/failed/);
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });

  it("says plainly when no inspector is configured", async () => {
    await build({ inspector: undefined });
    const body = await (await get("/api/fixture")).json();
    expect(body.personaCount).toBeNull();
    expect(body.countsError).toMatch(/unavailable/i);
  });
});

describe("POST /api/fixture/reset", () => {
  const writeEnvTest = (url: string) => writeFile(path.join(root, ".env.test"), `# comment\nDATABASE_URL=${url}\n`);

  it("accepts an absent .env.test when the server already has the injected target", () => {
    expect(validateResetEnvFile("postgres://u:p@host/neondb", {
      exists: false,
      databaseUrl: null,
    })).toEqual({ ok: true, databaseUrl: "postgres://u:p@host/neondb" });
  });

  it("refuses an existing .env.test without DATABASE_URL", () => {
    expect(validateResetEnvFile("postgres://u:p@host/neondb", {
      exists: true,
      databaseUrl: null,
    })).toMatchObject({ ok: false });
  });

  it("refuses an existing .env.test naming a different database without credentials", () => {
    const result = validateResetEnvFile("postgres://u:p@host/neondb", {
      exists: true,
      databaseUrl: "postgres://u:p@host/otherdb",
    });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.reason).not.toContain(":p@");
  });

  it("accepts an existing .env.test naming the injected target exactly", () => {
    expect(validateResetEnvFile("postgres://u:p@host/neondb", {
      exists: true,
      databaseUrl: "postgres://u:p@host/neondb",
    })).toEqual({ ok: true, databaseUrl: "postgres://u:p@host/neondb" });
  });

  it("runs the guarded pipeline with the environment this layer injects", async () => {
    await writeEnvTest(DATABASE_URL);

    const response = await post("/api/fixture/reset", { confirmDatabaseName: "neondb", personas: 3 });

    expect(response.status).toBe(202);
    const record = (await response.json()) as RunRecord;
    expect(record.spec).toEqual({ kind: "fixture-reset", personas: 3, migrate: true, databaseName: "neondb" });
    // The connection string is never persisted in a record.
    expect(JSON.stringify(record)).not.toContain(":p@");

    const call = executor.starts[0];
    expect(call.steps?.map((step) => step.label)).toEqual(["flush", "migrate", "seed"]);
    for (const step of call.steps ?? []) {
      expect(step.cwd).toBe(path.join(root, "services/api"));
      expect(step.env.DATABASE_URL).toBe(DATABASE_URL);
      expect(step.env.NODE_ENV).toBe("test");
      expect(step.env.TEST_DATABASE_SAFE).toBe("1");
    }
    expect(call.steps?.[2].argv).toContain("--personas=3");
  });

  it("refuses a target the fixture guard rejects", async () => {
    await build({ databaseUrl: "postgres://u:p@host/protocol_prod" });
    await writeEnvTest("postgres://u:p@host/protocol_prod");

    const response = await post("/api/fixture/reset", { confirmDatabaseName: "protocol_prod", personas: 1 });

    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/protocol_prod/);
    expect(executor.starts).toHaveLength(0);
  });

  it("refuses when .env.test no longer names the validated database", async () => {
    await writeEnvTest("postgres://u:p@host/somewhere-else");

    const response = await post("/api/fixture/reset", { confirmDatabaseName: "neondb", personas: 1 });

    expect(response.status).toBe(409);
    const error = (await response.json()).error as string;
    expect(error).toMatch(/\.env\.test/);
    expect(error).not.toContain(":p@");
    expect(executor.starts).toHaveLength(0);
  });

  it("accepts when .env.test is missing because the server injects the validated target", async () => {
    const response = await post("/api/fixture/reset", { confirmDatabaseName: "neondb", personas: 1 });

    expect(response.status).toBe(202);
    const call = executor.starts[0];
    expect(call.steps?.map((step) => step.label)).toEqual(["flush", "migrate", "seed"]);
    for (const step of call.steps ?? []) {
      expect(step.env.DATABASE_URL).toBe(DATABASE_URL);
      expect(step.env.NODE_ENV).toBe("test");
      expect(step.env.TEST_DATABASE_SAFE).toBe("1");
    }
  });

  it("refuses a mistyped confirmation", async () => {
    await writeEnvTest(DATABASE_URL);

    const response = await post("/api/fixture/reset", { confirmDatabaseName: "neondbb", personas: 1 });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/confirmDatabaseName/);
    expect(executor.starts).toHaveLength(0);
  });

  it("refuses a persona count outside the seed's range and unknown keys", async () => {
    await writeEnvTest(DATABASE_URL);

    expect((await post("/api/fixture/reset", { confirmDatabaseName: "neondb", personas: 51 })).status).toBe(400);
    expect((await post("/api/fixture/reset", { confirmDatabaseName: "neondb" })).status).toBe(400);
    expect(
      (await post("/api/fixture/reset", { confirmDatabaseName: "neondb", personas: 1, databaseUrl: "postgres://evil" }))
        .status,
    ).toBe(400);
    expect(executor.starts).toHaveLength(0);
  });

  it("refuses to flush the database while a run is in flight", async () => {
    await writeEnvTest(DATABASE_URL);
    let release!: () => void;
    executor.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await post("/api/runs", { kind: "eval", harness: "premise", profile: "default", flags: {} });
    const response = await post("/api/fixture/reset", { confirmDatabaseName: "neondb", personas: 1 });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/run/i);
    release();
    await context.queue.drain();
  });

  it("refuses a second reset while one is in flight, and frees the server once it settles", async () => {
    await writeEnvTest(DATABASE_URL);
    let release!: () => void;
    executor.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    expect((await post("/api/fixture/reset", { confirmDatabaseName: "neondb", personas: 1 })).status).toBe(202);
    expect((await post("/api/fixture/reset", { confirmDatabaseName: "neondb", personas: 1 })).status).toBe(409);

    release();
    executor.gate = null;
    await Bun.sleep(10);
    expect((await post("/api/fixture/reset", { confirmDatabaseName: "neondb", personas: 1 })).status).toBe(202);
  });

  it("frees the server again after a refused reset", async () => {
    await writeEnvTest(DATABASE_URL);

    expect((await post("/api/fixture/reset", { confirmDatabaseName: "wrong", personas: 1 })).status).toBe(400);
    // The refusal must not leave the reset slot claimed for the process's lifetime.
    expect((await post("/api/fixture/reset", { confirmDatabaseName: "neondb", personas: 1 })).status).toBe(202);
  });

  it("refuses to launch a run while a reset is in flight", async () => {
    await writeEnvTest(DATABASE_URL);
    let release!: () => void;
    executor.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    expect((await post("/api/fixture/reset", { confirmDatabaseName: "neondb", personas: 1 })).status).toBe(202);
    const response = await post("/api/runs", { kind: "eval", harness: "premise", profile: "default", flags: {} });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/reset/i);
    release();
    await Bun.sleep(10);
  });
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Every `/api/*` route this server answers, as (method, path) pairs.
 *
 * Hand-maintained on purpose: the point of the inventory test below is that
 * adding a route to ops.server.ts without deciding whether it is public fails
 * here, and a list derived from the router itself could not detect that.
 */
const API_ROUTES: ReadonlyArray<{ method: "GET" | "POST"; path: string }> = [
  { method: "GET", path: "/api/auth/status" },
  { method: "POST", path: "/api/auth/login" },
  { method: "POST", path: "/api/auth/session" },
  { method: "POST", path: "/api/auth/logout" },
  { method: "GET", path: "/api/harnesses" },
  { method: "GET", path: "/api/profiles" },
  { method: "GET", path: "/api/artifacts" },
  { method: "GET", path: "/api/artifacts/some-id" },
  { method: "GET", path: "/api/compare?reference=a&subject=b" },
  { method: "GET", path: "/api/runs" },
  { method: "GET", path: "/api/runs/some-id/stream" },
  { method: "GET", path: "/api/fixture" },
  { method: "POST", path: "/api/runs" },
  { method: "POST", path: "/api/runs/some-id/cancel" },
  { method: "POST", path: "/api/fixture/reset" },
];

describe("authentication", () => {
  /** Sends a request with no session at all. */
  const anonymous = (method: "GET" | "POST", url: string) =>
    handler(
      new Request(`http://localhost${url}`, {
        method,
        headers: method === "POST" ? { "Content-Type": "application/json" } : {},
        body: method === "POST" ? "{}" : undefined,
      }),
    );

  describe("the gate covers every route", () => {
    // The whole failure mode of this task is a route that forgets the gate. This
    // enumerates the server's surface and asserts each entry is either on the
    // public allowlist or refuses an anonymous caller — so a new route added
    // without a decision about access fails here rather than shipping unguarded.
    for (const route of API_ROUTES) {
      const isPublic = PUBLIC_ROUTES.some(
        (entry) => entry.method === route.method && route.path.split("?")[0] === entry.path,
      );

      it(`${route.method} ${route.path} is ${isPublic ? "public by decision" : "session-gated"}`, async () => {
        const response = await anonymous(route.method, route.path);

        if (isPublic) {
          expect(response.status).not.toBe(401);
        } else {
          expect(response.status).toBe(401);
        }
      });
    }

    it("pins the public allowlist, so widening it is a deliberate edit", () => {
      expect([...PUBLIC_ROUTES].map((entry) => `${entry.method} ${entry.path}`).sort()).toEqual([
        "GET /api/auth/status",
        "POST /api/auth/login",
        "POST /api/auth/session",
      ]);
    });

    it("claims every route it serves, so an embedder cannot answer one itself", () => {
      // apps/eval-ops/server.ts mounts this handler behind a static file server and
      // has to decide, per request, which one answers. It used to ask
      // `startsWith("/api/")`, which is false for /callback — so the SPA answered
      // the sign-in bridge with index.html and left the minted API key in the
      // browser's history for a sign-in that could never complete. The forwarding
      // rule is now isOpsServerPath, and this pins it against the inventory above:
      // a route added outside /api/ fails here rather than falling through.
      for (const route of API_ROUTES) {
        expect(isOpsServerPath(route.path.split("?")[0])).toBe(true);
      }
      expect(isOpsServerPath(OPS_CALLBACK_PATH)).toBe(true);
      // And it claims nothing the SPA owns.
      for (const spa of ["/", "/index.html", "/assets/app.js", "/launch", "/r/some-id"]) {
        expect(isOpsServerPath(spa)).toBe(false);
      }
    });

    it("answers /callback at the one path the bridge accepts", async () => {
      // validateCliCallbackUrl in apps/web/src/lib/cli-auth.ts requires exactly
      // this pathname, so the constant the forwarding rule shares is the same one
      // the handler dispatches on.
      const state = states.mint();
      const response = await handler(new Request(`http://localhost${OPS_CALLBACK_PATH}?state=${state}&api_key=k`));

      expect(response.status).toBe(302);
    });

    it("gates the unknown-route 404 as well, so probing needs a session", async () => {
      // A 404 that answers anonymously would still confirm which routes exist.
      expect((await anonymous("GET", "/api/nope")).status).toBe(401);
      expect((await get("/api/nope")).status).toBe(404);
    });
  });

  describe("GET /api/auth/status", () => {
    it("reports an anonymous caller without a session", async () => {
      const response = await anonymous("GET", "/api/auth/status");

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ authenticated: false });
    });

    it("reports the signed-in identity", async () => {
      const body = await (await get("/api/auth/status")).json();

      expect(body).toEqual({ authenticated: true, email: "operator@index.network", name: "Operator" });
    });
  });

  describe("POST /api/auth/login", () => {
    it("returns a bridge URL carrying a fresh one-time state", async () => {
      const body = await (await anonymous("POST", "/api/auth/login")).json();
      const url = new URL(body.url);

      // The discriminator is what keeps the two postures from being told apart by
      // guessing which optional field is present.
      expect(body.kind).toBe("bridge");
      expect(url.origin + url.pathname).toBe("https://index.network/cli-auth");
      expect(url.searchParams.get("callback")).toBe("http://127.0.0.1:4321/callback");
      expect(url.searchParams.get("version")).toBe("2");
      expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{32,128}$/);
    });

    it("mints a distinct state per call", async () => {
      const first = new URL((await (await anonymous("POST", "/api/auth/login")).json()).url);
      const second = new URL((await (await anonymous("POST", "/api/auth/login")).json()).url);

      expect(first.searchParams.get("state")).not.toBe(second.searchParams.get("state"));
    });

    it("names no API or web app URL in the local posture, so nothing new is disclosed", async () => {
      const body = await (await anonymous("POST", "/api/auth/login")).json();

      expect(Object.keys(body).sort()).toEqual(["kind", "url"]);
    });
  });

  describe("POST /api/auth/session in the local posture", () => {
    it("refuses outright, so a token cannot be submitted to a bridge server", async () => {
      const response = await anonymous("POST", "/api/auth/session");

      expect(response.status).toBe(403);
      expect((await response.json()).error).toMatch(/bridge/i);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(identities.seen).toHaveLength(0);
    });
  });

  describe("GET /callback", () => {
    const callback = (query: string) => handler(new Request(`http://localhost/callback?${query}`));

    it("establishes a session and redirects to the configured UI", async () => {
      const state = states.mint();

      const response = await callback(`state=${state}&api_key=k`);

      expect(response.status).toBe(302);
      // Not a bare "/": in the documented two-process flow this API serves no UI,
      // so "/" is its own 404 and the operator has to navigate back by hand.
      expect(response.headers.get("location")).toBe("http://127.0.0.1:5174");
      const cookie = response.headers.get("set-cookie") ?? "";
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\//);
      // Loopback is plain http: a Secure cookie would be dropped by the browser
      // and sign-in would fail silently.
      expect(cookie).not.toMatch(/Secure/i);
    });

    it("refuses a state this server never minted", async () => {
      const response = await callback("state=not-a-real-state&api_key=k");

      expect(response.status).toBe(403);
      // The credential must not even be looked at once the state fails.
      expect(identities.seen).toHaveLength(0);
      expect(response.headers.get("set-cookie")).toBeNull();
    });

    it("refuses a replayed state, so a copied callback URL cannot sign in twice", async () => {
      const state = states.mint();
      expect((await callback(`state=${state}&api_key=k`)).status).toBe(302);

      const replay = await callback(`state=${state}&api_key=k`);

      expect(replay.status).toBe(403);
      expect(replay.headers.get("set-cookie")).toBeNull();
    });

    it("refuses a callback with no credential", async () => {
      const state = states.mint();

      const response = await callback(`state=${state}`);

      expect(response.status).toBe(403);
      expect(identities.seen).toHaveLength(0);
    });

    it("refuses an identity outside the allowed domain and discards the credential", async () => {
      identities.identity = { email: "someone@evil.example", emailVerified: true, name: "Outsider" };
      const state = states.mint();

      const response = await callback(`state=${state}&api_key=radioactive`);
      const text = await response.text();

      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
      // Exchanged once, then dropped: never echoed to the browser.
      expect(identities.seen).toEqual(["radioactive"]);
      expect(text).not.toContain("radioactive");
    });

    it("refuses an unverified address", async () => {
      identities.identity = { email: "operator@index.network", emailVerified: false, name: "Operator" };
      const state = states.mint();

      expect((await callback(`state=${state}&api_key=k`)).status).toBe(403);
    });

    it("escapes the refusal reason rather than rendering the address as markup", async () => {
      // The address is user-controlled and the reason interpolates it verbatim,
      // so the callback page is an injection sink unless it escapes.
      identities.identity = {
        email: "<img src=x onerror=alert(1)>@evil.example",
        emailVerified: true,
        name: "x",
      };
      const state = states.mint();

      const text = await (await callback(`state=${state}&api_key=k`)).text();

      expect(text).not.toContain("<img src=x");
      expect(text).toContain("&lt;img");
    });

    it("escapes each character once, without re-escaping its own ampersands", async () => {
      // A chained replace that escaped < before & would turn < into &amp;lt;,
      // rendering the escape itself. One pass cannot get the order wrong. The
      // address is the only interpolated value, so this is the whole sink.
      identities.identity = { email: `a&b<c>"d'e@evil.example`, emailVerified: true, name: "x" };
      const state = states.mint();

      const text = await (await callback(`state=${state}&api_key=k`)).text();

      expect(text).toContain("a&amp;b&lt;c&gt;&quot;d&#39;e@evil.example");
      expect(text).not.toContain("&amp;lt;");
    });

    it("answers 502 when the identity service cannot be reached", async () => {
      // "The API is down" is not "you are not allowed in", and must not read as it.
      identities.failure = new Error("connect ECONNREFUSED 127.0.0.1:3001");
      const state = states.mint();

      const response = await callback(`state=${state}&api_key=k`);

      expect(response.status).toBe(502);
      expect(response.headers.get("set-cookie")).toBeNull();
    });

    it("refuses a callback addressed to a foreign host", async () => {
      // The bridge redirect lands in a browser, so the rebinding guard must cover
      // this route too — it is not under /api/.
      const state = states.mint();

      const response = await handler(
        new Request(`http://localhost/callback?state=${state}&api_key=k`, {
          headers: { Host: "evil.example.com" },
        }),
      );

      expect(response.status).toBe(403);
      expect(identities.seen).toHaveLength(0);
    });
  });

  describe("POST /api/auth/logout", () => {
    it("clears the session and requires one to call", async () => {
      expect((await anonymous("POST", "/api/auth/logout")).status).toBe(401);

      const response = await post("/api/auth/logout", {});

      expect(response.status).toBe(200);
      expect((await (await get("/api/auth/status")).json()).authenticated).toBe(false);
      // The gate closes again immediately.
      expect((await get("/api/runs")).status).toBe(401);
    });
  });

  describe("401 and 403 are distinguishable", () => {
    it("answers 401 with no session and 403 for a session the policy later refuses", async () => {
      expect((await anonymous("GET", "/api/runs")).status).toBe(401);

      // A session established for an identity the policy no longer admits: the
      // UI must be able to tell "sign in" from "your account is not permitted".
      const stale = sessions.establish({ email: "someone@evil.example", name: "Outsider" });
      const response = await handler(
        new Request("http://localhost/api/runs", { headers: { Cookie: `eval_ops_session=${stale}` } }),
      );

      expect(response.status).toBe(403);
    });
  });

  describe("the existing loopback guards still apply", () => {
    it("refuses a foreign Host before it considers the session", async () => {
      const response = await handler(
        new Request("http://localhost/api/runs", { headers: { Host: "evil.example.com", ...sessionCookie } }),
      );

      expect(response.status).toBe(403);
      expect((await response.json()).error).toMatch(/evil\.example\.com/);
    });

    it("refuses a cross-origin write from a signed-in browser", async () => {
      // A session does not license a drive-by: both guards still have to pass.
      const response = await post("/api/runs", RUN_BODY, { Origin: "https://evil.example" });

      expect(response.status).toBe(403);
      expect((await store.list()).records).toHaveLength(0);
    });

    it("still requires a JSON content type on a signed-in write", async () => {
      const response = await handler(
        new Request("http://localhost/api/runs", {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8", ...sessionCookie },
          body: JSON.stringify(RUN_BODY),
        }),
      );

      expect(response.status).toBe(415);
    });
  });
});

/**
 * The deployed sign-in: a better-auth JWT, resolved server-side.
 *
 * On a real host the bridge is unusable — `validateCliCallbackUrl` in
 * apps/web/src/lib/cli-auth.ts accepts only `http:` on loopback, by design, and
 * that rule is shared with the released CLI. So the browser fetches a token from
 * the API against its own session and posts it here; this server presents it to
 * `/api/auth/me` and applies the *same* `assessIdentity` policy to what comes
 * back. Nothing is client-asserted: the browser supplies a token, never an
 * identity.
 */
describe("deployed sign-in with a better-auth token", () => {
  const TOKEN_POSTURE = {
    kind: "token",
    apiUrl: "https://protocol.dev.index.network",
    webAppUrl: "https://index.network",
  } as const;
  const PUBLIC_ORIGIN = resolvePublicOrigin({ EVAL_OPS_PUBLIC_ORIGIN: "https://eval.index.network" });

  beforeEach(async () => {
    await build({ publicOrigin: PUBLIC_ORIGIN }, { signIn: TOKEN_POSTURE });
  });

  /** Submits a token exactly as the browser does, with no session of its own. */
  const submit = (body: unknown, headers: Record<string, string> = {}) =>
    handler(
      new Request("http://localhost/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );

  describe("POST /api/auth/login", () => {
    it("tells the browser where to get a token and where to sign in", async () => {
      const response = await handler(
        new Request("http://localhost/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      );
      const body = await response.json();

      expect(body.kind).toBe("token");
      // Exactly two fields, both of them public DNS names the browser already
      // talks to. This is not a "dump the server's configuration" route.
      expect(Object.keys(body).sort()).toEqual(["apiUrl", "kind", "webAppUrl"]);
      expect(body.apiUrl).toBe("https://protocol.dev.index.network");
      expect(body.webAppUrl).toBe("https://index.network");
      // No loopback bridge callback: it could never complete from here.
      expect(JSON.stringify(body)).not.toContain("/cli-auth");
      expect(JSON.stringify(body)).not.toContain("127.0.0.1");
    });
  });

  describe("POST /api/auth/session", () => {
    it("establishes a session for a token that resolves to an allowed identity", async () => {
      const response = await submit({ token: JWT });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ authenticated: true, email: "operator@index.network", name: "Operator" });
      // Resolved server-side, exactly once.
      expect(identities.seen).toEqual([JWT]);

      const cookie = response.headers.get("set-cookie") ?? "";
      expect(cookie).toMatch(/^eval_ops_session=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      // And the session it establishes actually opens the gate.
      const gated = await handler(
        new Request("http://localhost/api/runs", { headers: { Cookie: cookie.split(";")[0] } }),
      );
      expect(gated.status).toBe(200);
    });

    it("never returns, stores or echoes the token", async () => {
      const response = await submit({ token: JWT });
      const cookie = response.headers.get("set-cookie") ?? "";

      expect(await response.text()).not.toContain(JWT);
      expect(cookie).not.toContain(JWT);
      // The session holds an identity and nothing else, so no later response can
      // carry the credential back out.
      const status = await handler(
        new Request("http://localhost/api/auth/status", { headers: { Cookie: cookie.split(";")[0] } }),
      );
      expect(await status.text()).not.toContain(JWT);
    });

    it("refuses an identity outside the allowed domain and discards the credential", async () => {
      identities.identity = { email: "someone@evil.example", emailVerified: true, name: "Outsider" };

      const response = await submit({ token: JWT });
      const text = await response.text();

      expect(response.status).toBe(403);
      // The UI has to tell "sign in" from "your account is not permitted".
      expect(JSON.parse(text)).toMatchObject({ authenticated: true, permitted: false });
      expect(response.headers.get("set-cookie")).toBeNull();
      // Exchanged once, then dropped: never echoed to the browser.
      expect(identities.seen).toEqual([JWT]);
      expect(text).not.toContain(JWT);
    });

    it("refuses an unverified address, which is the whole reason for the /me hop", async () => {
      // The jwt plugin's definePayload returns { id, email, name } and no
      // emailVerified, so verification can only come from the user record.
      identities.identity = { email: "operator@index.network", emailVerified: false, name: "Operator" };

      const response = await submit({ token: JWT });

      expect(response.status).toBe(403);
      expect((await response.json()).error).toMatch(/not verified/i);
      expect(response.headers.get("set-cookie")).toBeNull();
    });

    it("answers 401 for a token the API rejects, so the UI offers sign-in again", async () => {
      identities.identity = null;

      const response = await submit({ token: JWT });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ authenticated: false });
      expect(response.headers.get("set-cookie")).toBeNull();
    });

    it("answers 502 when the API cannot be reached, without echoing the token", async () => {
      // "The API is down" is not "you are not allowed in" — and a transport error
      // that happened to quote the request must still not carry the credential out.
      identities.failure = new Error(`fetch failed for Bearer ${JWT}`);

      const response = await submit({ token: JWT });
      const text = await response.text();

      expect(response.status).toBe(502);
      expect(text).not.toContain(JWT);
      expect(response.headers.get("set-cookie")).toBeNull();
    });

    it("refuses a body that is not exactly one token", async () => {
      for (const body of [{}, { token: "" }, { token: 42 }, { token: JWT, email: "a@index.network" }]) {
        const response = await submit(body);
        expect({ body, status: response.status }).toEqual({ body, status: 400 });
      }
      // In particular the browser cannot assert who it is.
      expect(identities.seen).toHaveLength(0);
    });

    it("is gated exactly like every other write", async () => {
      // Content type: `no-cors` cannot produce application/json.
      const untyped = await handler(
        new Request("http://localhost/api/auth/session", {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: JSON.stringify({ token: JWT }),
        }),
      );
      expect(untyped.status).toBe(415);

      // Origin: a page on another origin cannot drive a sign-in here.
      const foreignOrigin = await submit({ token: JWT }, { Origin: "https://evil.example" });
      expect(foreignOrigin.status).toBe(403);

      // Host: the rebinding guard runs first, on this route too.
      const foreignHost = await submit({ token: JWT }, { Host: "evil.example.com" });
      expect(foreignHost.status).toBe(403);

      // None of the three ever looked at the credential.
      expect(identities.seen).toHaveLength(0);
    });

    it("sets a Secure cookie when the browser reached the deployed origin", async () => {
      const response = await handler(
        new Request("https://eval.index.network/api/auth/session", {
          method: "POST",
          headers: {
            Host: "eval.index.network",
            Origin: "https://eval.index.network",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ token: JWT }),
        }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie") ?? "").toMatch(/Secure/i);
    });
  });

  describe("GET /callback", () => {
    it("refuses the bridge callback on the posture, not on a state it happens not to hold", async () => {
      // A deployed server mints no states at all, so the refusal has to come from
      // "this server does not run that exchange" rather than from an empty store
      // — which would look identical today and stop being a refusal the moment
      // anything else minted one.
      const response = await handler(new Request("http://localhost/callback?state=anything&api_key=k"));
      const text = await response.text();

      expect(response.status).toBe(403);
      expect(text).toMatch(/does not sign in through the local bridge/i);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(identities.seen).toHaveLength(0);
    });
  });

  describe("401 and 403 stay distinguishable", () => {
    it("answers 401 with no session and 403 for a session the policy refuses", async () => {
      const anonymous = await handler(new Request("http://localhost/api/runs"));
      expect(anonymous.status).toBe(401);

      const stale = sessions.establish({ email: "someone@evil.example", name: "Outsider" });
      const refused = await handler(
        new Request("http://localhost/api/runs", { headers: { Cookie: `eval_ops_session=${stale}` } }),
      );
      expect(refused.status).toBe(403);
    });
  });
});

describe("resolveSignInMode", () => {
  // The deployed posture is already named by EVAL_OPS_PUBLIC_ORIGIN, and it is
  // exactly the condition under which the loopback bridge cannot complete. One
  // rule, exported and pure, rather than an implicit guess inside the wiring.
  it("chooses the local bridge when no public origin is configured", () => {
    expect(resolveSignInMode({})).toBe("bridge");
    expect(resolveSignInMode({ EVAL_OPS_PUBLIC_ORIGIN: "" })).toBe("bridge");
    expect(resolveSignInMode({ EVAL_OPS_PUBLIC_ORIGIN: "   " })).toBe("bridge");
  });

  it("chooses the token exchange once the server answers on a deployed origin", () => {
    expect(resolveSignInMode({ EVAL_OPS_PUBLIC_ORIGIN: "https://eval.index.network" })).toBe("token");
  });

  it("refuses a malformed public origin rather than quietly falling back to the bridge", () => {
    // Falling back would produce a deployed server advertising a loopback
    // callback — the exact failure this posture exists to remove.
    expect(() => resolveSignInMode({ EVAL_OPS_PUBLIC_ORIGIN: "http://eval.index.network" })).toThrow(
      /EVAL_OPS_PUBLIC_ORIGIN/,
    );
  });

  it("is not decided by a wider bind or a platform port", () => {
    // Neither of those makes the bridge callback unreachable; only a deployed
    // origin does.
    expect(resolveSignInMode({ EVAL_OPS_BIND: "0.0.0.0", PORT: "8080" })).toBe("bridge");
  });
});

describe("resolveIdentityEndpoints", () => {
  // The bridge mints the API key and the resolver verifies it, so the two are one
  // pair. A mismatched pair does not fail at startup: it fails at the end of a
  // browser round-trip as "No Index account could be resolved for this sign-in",
  // which reads like a permissions problem and is not one. Pure, so this needs no
  // server, socket or environment mutation.
  it("defaults both endpoints to the same environment", () => {
    const resolved = resolveIdentityEndpoints({});

    // Both local. The old defaults paired a production bridge with a local API.
    expect(resolved).toEqual({ webAppUrl: "http://localhost:3000", apiUrl: "http://localhost:3001" });
  });

  it("refuses a half-configured pair rather than silently defaulting the other half", () => {
    // This is exactly how the production-bridge/local-resolver trap was reachable.
    expect(() => resolveIdentityEndpoints({ WEB_APP_URL: "https://index.network" })).toThrow(/API_URL/);
    expect(() => resolveIdentityEndpoints({ API_URL: "https://protocol.dev.index.network" })).toThrow(/WEB_APP_URL/);
  });

  it("refuses a local bridge with a remote resolver, and the reverse", () => {
    expect(() =>
      resolveIdentityEndpoints({ WEB_APP_URL: "https://index.network", API_URL: "http://localhost:3001" }),
    ).toThrow(/not the same environment/);
    expect(() =>
      resolveIdentityEndpoints({ WEB_APP_URL: "http://localhost:3000", API_URL: "https://protocol.dev.index.network" }),
    ).toThrow(/not the same environment/);
  });

  it("accepts a coherent pair, local or remote", () => {
    expect(resolveIdentityEndpoints({ WEB_APP_URL: "http://localhost:3000", API_URL: "http://127.0.0.1:3001" }))
      .toEqual({ webAppUrl: "http://localhost:3000", apiUrl: "http://127.0.0.1:3001" });
    // The pair .env.test sets, which is what `eval:web` actually runs with.
    expect(resolveIdentityEndpoints({ WEB_APP_URL: "https://dev.index.network", API_URL: "https://protocol.dev.index.network" }))
      .toEqual({ webAppUrl: "https://dev.index.network", apiUrl: "https://protocol.dev.index.network" });
  });

  it("reads an empty value as unset, not as an empty origin", () => {
    expect(resolveIdentityEndpoints({ WEB_APP_URL: "  ", API_URL: "" })).toEqual({
      webAppUrl: "http://localhost:3000",
      apiUrl: "http://localhost:3001",
    });
  });

  it("refuses a value that is not a URL at all", () => {
    expect(() => resolveIdentityEndpoints({ WEB_APP_URL: "index.network", API_URL: "http://localhost:3001" }))
      .toThrow(/not a usable URL/);
  });
});

describe("resolveBindPort", () => {
  // Two entrypoints, two postures, one rule. ops.serve.ts is the local dev API,
  // started by `bun run eval:web` with --env-file=../../.env.test — and that file
  // sets PORT=3001 for the *API service*. Honouring PORT there would silently move
  // the ops API onto the API's port and break the documented two-process flow for
  // every developer. apps/eval-ops/server.ts is what the platform starts, and the
  // platform injects PORT.
  it("defaults to 4321 in both postures", () => {
    expect(resolveBindPort({ env: {}, honourPlatformPort: false })).toBe(4321);
    expect(resolveBindPort({ env: {}, honourPlatformPort: true })).toBe(4321);
  });

  it("honours the platform's PORT in the deployed posture", () => {
    expect(resolveBindPort({ env: { PORT: "8080" }, honourPlatformPort: true })).toBe(8080);
  });

  it("ignores PORT in the local posture, because .env.test sets it to the API's port", () => {
    expect(resolveBindPort({ env: { PORT: "3001" }, honourPlatformPort: false })).toBe(4321);
  });

  it("lets EVAL_OPS_PORT win over the platform's PORT", () => {
    expect(resolveBindPort({ env: { PORT: "8080", EVAL_OPS_PORT: "4399" }, honourPlatformPort: true })).toBe(4399);
    expect(resolveBindPort({ env: { EVAL_OPS_PORT: "4399" }, honourPlatformPort: false })).toBe(4399);
  });

  it("reads an empty value as unset", () => {
    expect(resolveBindPort({ env: { PORT: "", EVAL_OPS_PORT: "  " }, honourPlatformPort: true })).toBe(4321);
  });

  it("refuses a value that is not a usable TCP port, rather than binding something arbitrary", () => {
    expect(() => resolveBindPort({ env: { EVAL_OPS_PORT: "http" }, honourPlatformPort: false })).toThrow(/EVAL_OPS_PORT/);
    expect(() => resolveBindPort({ env: { EVAL_OPS_PORT: "4321.5" }, honourPlatformPort: false })).toThrow(/usable TCP port/);
    expect(() => resolveBindPort({ env: { PORT: "70000" }, honourPlatformPort: true })).toThrow(/PORT/);
    expect(() => resolveBindPort({ env: { PORT: "0" }, honourPlatformPort: true })).toThrow(/usable TCP port/);
  });
});

describe("resolveBindHostname", () => {
  it("binds loopback unless the environment deliberately says otherwise", () => {
    expect(resolveBindHostname({})).toBe("127.0.0.1");
    // A platform PORT does not imply a wider bind: widening stays one explicit act.
    expect(resolveBindHostname({ PORT: "8080" })).toBe("127.0.0.1");
    expect(resolveBindHostname({ EVAL_OPS_BIND: "  " })).toBe("127.0.0.1");
  });

  it("binds exactly what EVAL_OPS_BIND names", () => {
    expect(resolveBindHostname({ EVAL_OPS_BIND: "0.0.0.0" })).toBe("0.0.0.0");
  });
});

describe("resolvePublicOrigin", () => {
  it("means loopback-only when it is unset", () => {
    expect(resolvePublicOrigin({})).toBeUndefined();
    expect(resolvePublicOrigin({ EVAL_OPS_PUBLIC_ORIGIN: "  " })).toBeUndefined();
  });

  it("accepts one absolute https origin and normalises it", () => {
    expect(resolvePublicOrigin({ EVAL_OPS_PUBLIC_ORIGIN: "https://eval.index.network" }))
      .toEqual({ origin: "https://eval.index.network", host: "eval.index.network" });
    // A trailing slash names no path, and the host is compared case-insensitively.
    expect(resolvePublicOrigin({ EVAL_OPS_PUBLIC_ORIGIN: "https://EVAL.index.network/" }))
      .toEqual({ origin: "https://eval.index.network", host: "eval.index.network" });
    // A non-default port is part of the host a Host header must equal.
    expect(resolvePublicOrigin({ EVAL_OPS_PUBLIC_ORIGIN: "https://eval.index.network:8443" }))
      .toEqual({ origin: "https://eval.index.network:8443", host: "eval.index.network:8443" });
  });

  it("refuses anything that is not exactly one https origin, loudly", () => {
    const refused: Array<[string, RegExp]> = [
      ["eval.index.network", /not a usable URL/],
      ["http://eval.index.network", /https/],
      ["https://*.index.network", /host/i],
      ["https://*", /host/i],
      ["*", /not a usable URL/],
      ["https://eval.index.network/ops", /path/i],
      ["https://eval.index.network/?a=b", /query/i],
      ["https://eval.index.network/#f", /fragment/i],
      ["https://user:pass@eval.index.network", /credential/i],
      ["https://a.example https://b.example", /./],
    ];
    for (const [value, message] of refused) {
      expect(() => resolvePublicOrigin({ EVAL_OPS_PUBLIC_ORIGIN: value })).toThrow(message);
    }
  });

  it("names the variable in every refusal, so a bad deploy says what to fix", () => {
    expect(() => resolvePublicOrigin({ EVAL_OPS_PUBLIC_ORIGIN: "http://eval.index.network" }))
      .toThrow(/EVAL_OPS_PUBLIC_ORIGIN/);
  });
});

describe("the entrypoints resolve one port and use it twice", () => {
  // The bridge callback URL must name the port the server actually bound. It used
  // to be re-read from the environment inside createDefaultOpsContext, which is
  // exactly how an advertised callback drifts from the real listener; the port is
  // now resolved once per entrypoint and passed to both. This pins that shape,
  // and the posture each entrypoint declares.
  const ENTRYPOINTS: Array<{ file: string; honoursPlatformPort: boolean }> = [
    { file: path.join(import.meta.dir, "../ops.serve.ts"), honoursPlatformPort: false },
    { file: path.join(import.meta.dir, "../../../../../apps/eval-ops/server.ts"), honoursPlatformPort: true },
  ];

  for (const entrypoint of ENTRYPOINTS) {
    it(`${path.basename(path.dirname(entrypoint.file))}/${path.basename(entrypoint.file)} resolves the port once and declares its posture`, async () => {
      const source = await readFile(entrypoint.file, "utf8");

      expect(source.match(/resolveBindPort\(/g)).toHaveLength(1);
      expect(source).toContain(`honourPlatformPort: ${entrypoint.honoursPlatformPort}`);
      // The same resolved value reaches the listener and the bridge callback.
      expect(source).toMatch(/createDefaultOpsContext\(\{[^}]*\bport\b[^}]*\}\)/);
      expect(source).toMatch(/Bun\.serve\(\{[^{]*\bport,/);
      expect(source).toMatch(/hostname: resolveBindHostname\(/);
      // Both entrypoints mount the same SSE stream, whose heartbeat is 15s. Bun's
      // default request idle timeout is 10s, so an entrypoint that omits this
      // closes a quiet run-log stream before the first heartbeat can hold it
      // open — which the deployed entrypoint did.
      expect(source).toMatch(/idleTimeout: 255/);
    });
  }
});

describe("createDefaultOpsContext", () => {
  const ENV_KEYS = ["API_URL", "WEB_APP_URL", "PORT", "EVAL_OPS_PORT", "EVAL_OPS_UI_URL", "EVAL_OPS_PUBLIC_ORIGIN"] as const;
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Saved and then cleared: these tests assert what the *defaults* wire, so an
    // ambient API_URL or WEB_APP_URL in the shell that runs them would otherwise
    // decide the answer — and a half-set ambient pair now refuses to start.
    for (const key of ENV_KEYS) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it("advertises the bridge callback on the port it was told the server bound", async () => {
    // The port is resolved once by the entrypoint and passed in, rather than
    // re-read from the environment here. If the two ever disagree the bridge
    // delivers the credential to a port nothing is listening on, and sign-in
    // fails with no visible cause — so this drives the same resolution the local
    // entrypoint performs and asserts the advertised callback matches it.
    process.env.EVAL_OPS_PORT = "4399";
    // Set as a pair: a half-configured environment now refuses to start.
    process.env.WEB_APP_URL = "https://index.network";
    process.env.API_URL = "https://protocol.index.network";
    const port = resolveBindPort({ env: process.env, honourPlatformPort: false });

    const built = await createDefaultOpsContext({ repoRoot: root, port });
    const response = await createOpsHandler(built)(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    const url = new URL((await response.json()).url);

    expect(port).toBe(4399);
    expect(url.searchParams.get("callback")).toBe(`http://127.0.0.1:${port}/callback`);
  });

  it("advertises the platform's port when the deployed entrypoint resolves one", async () => {
    process.env.PORT = "8080";
    const port = resolveBindPort({ env: process.env, honourPlatformPort: true });

    const built = await createDefaultOpsContext({ repoRoot: root, uiUrl: "/", port });

    expect(built.auth?.signIn).toMatchObject({ kind: "bridge", callbackPort: 8080 });
  });

  it("wires the bridge and its API-key resolver when no public origin is configured", async () => {
    const built = await createDefaultOpsContext({ repoRoot: root, port: 4321 });

    // The resolver and the posture are chosen together, by one decision: a bridge
    // that minted API keys for a JWT resolver would refuse every sign-in.
    expect(built.auth?.signIn.kind).toBe("bridge");
    expect(built.auth?.identities).toBeInstanceOf(ApiIdentityResolver);
  });

  it("wires the token exchange and its JWT resolver once a public origin is configured", async () => {
    process.env.EVAL_OPS_PUBLIC_ORIGIN = "https://eval.index.network";
    process.env.WEB_APP_URL = "https://index.network";
    process.env.API_URL = "https://protocol.dev.index.network";

    const built = await createDefaultOpsContext({ repoRoot: root, uiUrl: "/", port: 4321 });

    expect(built.auth?.signIn).toEqual({
      kind: "token",
      apiUrl: "https://protocol.dev.index.network",
      webAppUrl: "https://index.network",
    });
    expect(built.auth?.identities).toBeInstanceOf(JwtIdentityResolver);
  });

  it("wires identity, so the default server is never unauthenticated", async () => {
    const built = await createDefaultOpsContext({ repoRoot: root, port: 4321 });

    expect(built.auth).toBeDefined();
    // An anonymous read is refused by the context the real entrypoint uses.
    const response = await createOpsHandler(built)(new Request("http://localhost/api/runs"));
    expect(response.status).toBe(401);
  });

  it("sends a completed sign-in to the UI, not to a route this server does not serve", async () => {
    // The standalone API serves no UI: a bare "/" here is its own 404.
    const built = await createDefaultOpsContext({ repoRoot: root, port: 4321 });

    expect(built.auth?.uiUrl).toBe("http://127.0.0.1:5174");
  });

  it("lets an embedder that serves the UI itself say so", async () => {
    // apps/eval-ops/server.ts serves the SPA on the same origin as the API.
    const built = await createDefaultOpsContext({ repoRoot: root, uiUrl: "/", port: 4321 });

    expect(built.auth?.uiUrl).toBe("/");
  });

  it("lets the environment override the redirect target", async () => {
    process.env.EVAL_OPS_UI_URL = "http://127.0.0.1:6000";

    const built = await createDefaultOpsContext({ repoRoot: root, uiUrl: "/", port: 4321 });

    expect(built.auth?.uiUrl).toBe("http://127.0.0.1:6000");
  });

  it("refuses to send a completed sign-in off loopback", async () => {
    // Configuration, never a request parameter — but a sign-in that hands the
    // browser to another origin is a mistake worth refusing loudly.
    process.env.EVAL_OPS_UI_URL = "https://evil.example";

    await expect(createDefaultOpsContext({ repoRoot: root, port: 4321 })).rejects.toThrow(/loopback/);
  });

  it("refuses to start on a half-configured identity pair", async () => {
    process.env.WEB_APP_URL = "https://index.network";
    delete process.env.API_URL;

    await expect(createDefaultOpsContext({ repoRoot: root, port: 4321 })).rejects.toThrow(/API_URL/);
  });

  it("stays loopback-only when no public origin is configured", async () => {
    const built = await createDefaultOpsContext({ repoRoot: root, port: 4321 });

    expect(built.publicOrigin).toBeUndefined();
  });

  it("carries the configured public origin into the guards", async () => {
    process.env.EVAL_OPS_PUBLIC_ORIGIN = "https://eval.index.network";

    const built = await createDefaultOpsContext({ repoRoot: root, uiUrl: "/", port: 4321 });

    expect(built.publicOrigin).toEqual({ origin: "https://eval.index.network", host: "eval.index.network" });
  });

  it("refuses to start on a malformed public origin rather than falling back to permissive", async () => {
    process.env.EVAL_OPS_PUBLIC_ORIGIN = "https://eval.index.network/ops?x=1";

    await expect(createDefaultOpsContext({ repoRoot: root, port: 4321 })).rejects.toThrow(/EVAL_OPS_PUBLIC_ORIGIN/);
  });

  it("refuses a wildcard public origin outright", async () => {
    process.env.EVAL_OPS_PUBLIC_ORIGIN = "*";

    await expect(createDefaultOpsContext({ repoRoot: root, port: 4321 })).rejects.toThrow(/EVAL_OPS_PUBLIC_ORIGIN/);
  });
});
