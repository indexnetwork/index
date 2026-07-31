import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { assessFixtureTarget, buildResetPipeline, FIXTURE_PERSONA_EMAIL_PREFIX, MAX_PERSONAS, redactDatabaseUrl } from "../ops.fixture.js";

/** The audited guard this module mirrors; see the "guard parity" describe block. */
const READINESS_SOURCE_PATH = path.resolve(
  import.meta.dir,
  "../../../../../services/api/src/lib/drizzle/test-database-readiness.ts",
);
const SEED_DATA_SOURCE_PATH = path.resolve(
  import.meta.dir,
  "../../../../../services/api/src/cli/test-data.ts",
);

describe("assessFixtureTarget", () => {
  it("refuses a missing DATABASE_URL", () => {
    const guard = assessFixtureTarget(undefined);
    expect(guard.allowed).toBe(false);
  });

  it("refuses a production database name", () => {
    const guard = assessFixtureTarget("postgres://u:p@host/protocol_prod");
    expect(guard.allowed).toBe(false);
    if (guard.allowed) throw new Error("unreachable");
    expect(guard.reason).toMatch(/prod/i);
  });

  it("refuses any *_production database name", () => {
    expect(assessFixtureTarget("postgres://u:p@host/anything_production").allowed).toBe(false);
  });

  it("refuses a percent-encoded production database name", () => {
    // The upstream guard decodes the path before matching, so "%70rod" is "prod"
    // to the server that will be flushed. Matching the raw path would allow it.
    expect(assessFixtureTarget("postgres://u:p@host/protocol_%70rod").allowed).toBe(false);
  });

  it("refuses a production database name padded with whitespace", () => {
    expect(assessFixtureTarget("postgres://u:p@host/protocol_prod%20").allowed).toBe(false);
  });

  it("refuses a malformed percent escape rather than guessing the name", () => {
    expect(assessFixtureTarget("postgres://u:p@host/protocol%ZZ").allowed).toBe(false);
  });

  it("refuses a non-postgres connection string", () => {
    expect(assessFixtureTarget("https://host/neondb").allowed).toBe(false);
  });

  it("refuses a URL that names no database", () => {
    expect(assessFixtureTarget("postgres://u:p@host/").allowed).toBe(false);
  });

  it("allows a disposable database", () => {
    const guard = assessFixtureTarget("postgres://u:p@ep-example.neon.tech/neondb");
    expect(guard.allowed).toBe(true);
    if (!guard.allowed) throw new Error("unreachable");
    expect(guard.target.databaseName).toBe("neondb");
    expect(guard.target.host).toBe("ep-example.neon.tech");
    expect(guard.target.redactedUrl).not.toContain("p@");
  });

  it("never leaks credentials in a refusal reason", () => {
    const guard = assessFixtureTarget("postgres://neon_owner:hunter2@host/protocol_prod");
    if (guard.allowed) throw new Error("unreachable");
    expect(guard.reason).not.toContain("hunter2");
    expect(guard.reason).not.toContain("neon_owner");
  });
});

describe("redactDatabaseUrl", () => {
  it("removes credentials", () => {
    const redacted = redactDatabaseUrl("postgres://user:secret@host:5432/neondb");
    expect(redacted).not.toContain("secret");
    expect(redacted).toContain("neondb");
  });

  it("keeps the host and database name", () => {
    expect(redactDatabaseUrl("postgresql://user:secret@ep-example.neon.tech/neondb"))
      .toBe("postgresql://ep-example.neon.tech/neondb");
  });

  it("never echoes a connection string it cannot redact", () => {
    // WHATWG URL parses this as protocol "user:" with no credentials to clear,
    // so anything short of failing closed would return the secret verbatim.
    expect(redactDatabaseUrl("user:secret@host/neondb")).not.toContain("secret");
    expect(redactDatabaseUrl("not a url")).toBe("(unrecognised connection string)");
  });
});

describe("guard parity with services/api", () => {
  // ops.fixture.ts copies the *_prod refusal instead of importing it: the
  // upstream module pulls in `postgres` and `node:child_process` at import time,
  // which the protocol package (and this provider-free suite) must not depend
  // on. These tests exist so the copy cannot drift from the original silently.

  it("uses the same real-data database-name pattern as validateTestDatabaseUrl", async () => {
    const source = await readFile(READINESS_SOURCE_PATH, "utf8");
    const match = source.match(/const REAL_DATA_DATABASE_NAMES = \/(.+)\/([a-z]*);/);
    if (!match) throw new Error(`REAL_DATA_DATABASE_NAMES not found in ${READINESS_SOURCE_PATH}`);
    const upstream = new RegExp(match[1], match[2]);

    const names = [
      "protocol_prod",
      "anything_production",
      "prod",
      "production",
      "PROD",
      "neondb",
      "protocol_test",
      "prod_copy",
      "production_backup",
    ];
    for (const name of names) {
      const guard = assessFixtureTarget(`postgres://u:p@host/${name}`);
      expect({ name, refused: !guard.allowed }).toEqual({ name, refused: upstream.test(name) });
    }
  });

  it("normalises the database name the same way readDatabaseName does", async () => {
    // Text pin: name normalisation decides what the pattern above sees, so a
    // change upstream must fail here and be mirrored in ops.fixture.ts.
    const source = await readFile(READINESS_SOURCE_PATH, "utf8");
    expect(source).toContain("decodeURIComponent(parsed.pathname.replace(/^\\//, '')).trim()");
  });

  it("describes the personas db:seed actually creates", async () => {
    // The seeded persona set is what fixture consumers identify rows by, so both
    // constants are pinned to services/api/src/cli/test-data.ts.
    const source = await readFile(SEED_DATA_SOURCE_PATH, "utf8");
    expect(source).toContain(`export const TESTER_PERSONAS_MAX = ${MAX_PERSONAS};`);
    expect(source.split(`email: '${FIXTURE_PERSONA_EMAIL_PREFIX}`).length - 1).toBe(MAX_PERSONAS);
  });
});

describe("buildResetPipeline", () => {
  it("flushes then seeds, always confirmed, always in services/api", () => {
    const steps = buildResetPipeline({ personas: 50, migrate: false });

    expect(steps.map((s) => s.label)).toEqual(["flush", "seed"]);
    for (const step of steps) {
      expect(step.cwd).toBe("services/api");
      expect(step.argv).toContain("--confirm");
    }
    expect(steps[1].argv).toContain("--personas=50");
  });

  it("inserts the migrate step only when drift was detected", () => {
    const steps = buildResetPipeline({ personas: 10, migrate: true });
    expect(steps.map((s) => s.label)).toEqual(["flush", "migrate", "seed"]);
  });

  it("confirms every destructive step; migrate is exempt because drizzle-kit takes no --confirm", () => {
    const steps = buildResetPipeline({ personas: 10, migrate: true });
    for (const step of steps) {
      expect(step.cwd).toBe("services/api");
      // `db:flush` and `db:seed` are the steps that destroy rows and both parse
      // `--confirm`; `db:migrate:test` runs `drizzle-kit migrate`, which accepts
      // no such flag and would treat it as an unknown argument.
      expect(step.argv.includes("--confirm")).toBe(step.label !== "migrate");
    }
  });

  it("rejects a persona count outside 0..50", () => {
    expect(() => buildResetPipeline({ personas: 51, migrate: false })).toThrow(/persona/i);
    expect(() => buildResetPipeline({ personas: -1, migrate: false })).toThrow(/persona/i);
    expect(() => buildResetPipeline({ personas: 1.5, migrate: false })).toThrow(/persona/i);
  });
});

describe("injected DATABASE_URL", () => {
  it("survives the CLIs' dotenv(.env.development) preamble", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ops-dotenv-"));
    await writeFile(path.join(dir, ".env.development"), "DATABASE_URL=postgres://dev-database/should-not-win\n");

    const proc = Bun.spawn({
      cmd: ["bun", path.join(import.meta.dir, "dotenv-probe.ts"), dir],
      env: { ...process.env, DATABASE_URL: "postgres://injected/test-database" },
      stdout: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;
    await rm(dir, { recursive: true, force: true });

    expect(stdout.trim()).toBe("postgres://injected/test-database");
  });
});
