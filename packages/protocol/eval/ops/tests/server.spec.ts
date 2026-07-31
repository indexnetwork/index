import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { FsArtifactSource } from "../ops.artifacts.js";
import type { ExecutionStep, RunExecutor } from "../ops.executor.js";
import { SEED_STEP_CWD, type FixtureCounts, type FixtureInspector } from "../ops.fixture.js";
import { RunQueue } from "../ops.queue.js";
import { createOpsHandler, type OpsContext } from "../ops.server.js";
import { FsRunStore, type RunStore } from "../ops.store.js";
import type { RunRecord } from "../ops.types.js";

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

let root: string;
let store: FsRunStore;
let executor: FakeExecutor;
let context: OpsContext;
let handler: (request: Request) => Promise<Response>;

async function build(overrides: Partial<OpsContext> = {}): Promise<void> {
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
  context = {
    evalDir,
    protocolDir: root,
    repoRoot: root,
    profilesDir,
    artifacts: new FsArtifactSource({ evalDir }),
    store,
    executor,
    queue: new RunQueue({ executor, store }),
    databaseUrl: DATABASE_URL,
    inspector: { count: async () => COUNTS },
    ...overrides,
  };
  handler = createOpsHandler(context);
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ops-server-"));
  await build();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const get = (url: string) => handler(new Request(`http://localhost${url}`));
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  handler(
    new Request(`http://localhost${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );

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
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(RUN_BODY),
      }),
    );

    expect(response.status).toBe(415);
    await context.queue.drain();
    expect(executor.starts).toHaveLength(0);
  });

  it("leaves reads reachable: a GET is not a state change", async () => {
    const response = await handler(
      new Request("http://localhost/api/harnesses", { headers: { Origin: "https://evil.example" } }),
    );
    // Nothing here mutates, and without a CORS header the body stays unreadable.
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
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

  it("refuses when .env.test is missing", async () => {
    const response = await post("/api/fixture/reset", { confirmDatabaseName: "neondb", personas: 1 });

    expect(response.status).toBe(409);
    expect(executor.starts).toHaveLength(0);
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
