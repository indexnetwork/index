/**
 * Test-database fixture control.
 *
 * Writes are never new database code: they delegate to the audited CLIs in
 * services/api. The target always comes from the server's own .env.test, never
 * from a request.
 */

/**
 * Mirrors REAL_DATA_DATABASE_NAMES in
 * services/api/src/lib/drizzle/test-database-readiness.ts.
 *
 * Copied rather than imported: that module pulls in `postgres` and
 * `node:child_process` at import time, which neither this package nor its
 * provider-free eval suite may depend on. eval/ops/tests/fixture.spec.ts pins
 * this copy — pattern and name normalisation — to the original so it cannot
 * drift silently.
 */
const REAL_DATA_DATABASE_NAMES = /^(.*_)?(prod|production)$/i;

export const FIXTURE_PERSONA_EMAIL_PREFIX = "seed-tester-";
export const MAX_PERSONAS = 50;

export interface FixtureTarget {
  databaseName: string;
  host: string;
  redactedUrl: string;
}

export type FixtureGuard = { allowed: true; target: FixtureTarget } | { allowed: false; reason: string };

/** Removes credentials from a connection string so it can be displayed. */
export function redactDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      // Fails closed. WHATWG URL parses nearly anything: "user:secret@host/db"
      // becomes protocol "user:" with empty credentials, so clearing username
      // and password would return the secret verbatim.
      throw new Error("unsupported protocol");
    }
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return "(unrecognised connection string)";
  }
}

/**
 * Reads the database name exactly as readDatabaseName does upstream: the server
 * decodes the URL path, so "protocol_%70rod" is the same database as
 * "protocol_prod" and must be refused as one.
 */
function readDatabaseName(parsed: URL): string {
  return decodeURIComponent(parsed.pathname.replace(/^\//, "")).trim();
}

/**
 * Decides whether a database may be flushed and reseeded.
 *
 * The database NAME, not the branch, distinguishes real data from a disposable
 * target: every Neon branch here exposes a protocol_prod database holding a copy
 * of real data. There is deliberately no override flag.
 *
 * Reasons are credential-free: they are shown to operators and written to logs.
 */
export function assessFixtureTarget(databaseUrl: string | undefined): FixtureGuard {
  if (!databaseUrl?.trim()) {
    return { allowed: false, reason: "DATABASE_URL is not set in .env.test; fixture control is unavailable." };
  }
  let parsed: URL;
  let databaseName: string;
  try {
    parsed = new URL(databaseUrl);
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      throw new Error("invalid protocol");
    }
    // Throws on a malformed percent escape, which fails closed below.
    databaseName = readDatabaseName(parsed);
  } catch {
    return {
      allowed: false,
      reason: "DATABASE_URL in .env.test is not a valid postgres:// or postgresql:// connection string.",
    };
  }
  if (databaseName === "") {
    return { allowed: false, reason: "DATABASE_URL does not name a database." };
  }
  if (REAL_DATA_DATABASE_NAMES.test(databaseName)) {
    return {
      allowed: false,
      reason:
        `Refusing to operate on database "${databaseName}": *_prod / *_production names hold real user data. `
        + "Point .env.test at a dedicated disposable database with migrations applied.",
    };
  }
  return {
    allowed: true,
    target: { databaseName, host: parsed.host, redactedUrl: redactDatabaseUrl(databaseUrl) },
  };
}

export interface ResetStep {
  label: "flush" | "migrate" | "seed";
  argv: string[];
  cwd: "services/api";
}

/** The reset pipeline: existing audited CLIs, in order, every destructive step confirmed. */
export function buildResetPipeline(options: { personas: number; migrate: boolean }): ResetStep[] {
  if (!Number.isInteger(options.personas) || options.personas < 0 || options.personas > MAX_PERSONAS) {
    throw new Error(`persona count must be an integer in 0..${MAX_PERSONAS}`);
  }
  const steps: ResetStep[] = [
    { label: "flush", argv: ["bun", "run", "db:flush", "--", "--confirm", "--silent"], cwd: "services/api" },
  ];
  if (options.migrate) {
    // No --confirm: this step runs `drizzle-kit migrate`, which accepts no such
    // flag. Its safety comes from services/api/drizzle.config.ts, which loads
    // the repository-root .env.test and refuses to run without TEST_DATABASE_SAFE=1.
    steps.push({ label: "migrate", argv: ["bun", "run", "db:migrate:test"], cwd: "services/api" });
  }
  steps.push({
    label: "seed",
    argv: ["bun", "run", "db:seed", "--", "--confirm", `--personas=${options.personas}`],
    cwd: "services/api",
  });
  return steps;
}
