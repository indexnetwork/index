import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_PROFILE_NAME, loadProfiles, resolveProfile } from "../ops.profiles.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ops-profiles-"));
  await writeFile(
    path.join(dir, "default.json"),
    JSON.stringify({ name: "default", description: "d", models: {}, env: {} }),
  );
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadProfiles", () => {
  it("loads a valid profile", async () => {
    await writeFile(
      path.join(dir, "claude-evaluator.json"),
      JSON.stringify({
        name: "claude-evaluator",
        description: "Claude as evaluator",
        models: { opportunityEvaluator: "anthropic/claude-sonnet-4" },
        env: {},
      }),
    );

    const profiles = await loadProfiles(dir);

    expect(profiles.map((p) => p.name).sort()).toEqual(["claude-evaluator", "default"]);
  });

  it("rejects an environment key outside the allowlist", async () => {
    await writeFile(
      path.join(dir, "sneaky.json"),
      JSON.stringify({ name: "sneaky", description: "x", models: {}, env: { DATABASE_URL: "postgres://evil" } }),
    );

    await expect(loadProfiles(dir)).rejects.toThrow(/DATABASE_URL/);
  });

  it("rejects a file whose name does not match its profile name", async () => {
    await writeFile(
      path.join(dir, "mismatch.json"),
      JSON.stringify({ name: "other", description: "x", models: {}, env: {} }),
    );

    await expect(loadProfiles(dir)).rejects.toThrow(/mismatch/);
  });

  it("rejects a default profile that carries overrides", async () => {
    await writeFile(
      path.join(dir, "default.json"),
      JSON.stringify({ name: "default", description: "d", models: { hydeGenerator: "x" }, env: {} }),
    );

    await expect(loadProfiles(dir)).rejects.toThrow(/default/i);
  });
});

describe("resolveProfile", () => {
  it("marks the default profile non-experimental with no env", () => {
    const resolved = resolveProfile({ name: DEFAULT_PROFILE_NAME, description: "d", models: {}, env: {} });

    expect(resolved.experimental).toBe(false);
    expect(resolved.env).toEqual({});
  });

  it("marks any other profile experimental and emits EVAL_MODEL_OVERRIDES", () => {
    const resolved = resolveProfile({
      name: "claude-evaluator",
      description: "x",
      models: { opportunityEvaluator: "anthropic/claude-sonnet-4" },
      env: { DISCOVERY_CONTEXT_TO_INTENT: "0" },
    });

    expect(resolved.experimental).toBe(true);
    expect(resolved.env.DISCOVERY_CONTEXT_TO_INTENT).toBe("0");
    expect(JSON.parse(resolved.env.EVAL_MODEL_OVERRIDES)).toEqual({
      opportunityEvaluator: "anthropic/claude-sonnet-4",
    });
  });

  it("fingerprints identical profiles identically and differing ones differently", () => {
    const a = resolveProfile({ name: "p", description: "x", models: { hydeGenerator: "m" }, env: { A: "1" } as never });
    const b = resolveProfile({ name: "p", description: "y", models: { hydeGenerator: "m" }, env: { A: "1" } as never });
    const c = resolveProfile({ name: "p", description: "x", models: { hydeGenerator: "n" }, env: { A: "1" } as never });

    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });
});
