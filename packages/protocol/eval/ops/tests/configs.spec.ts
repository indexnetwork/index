import { describe, expect, it } from "bun:test";

import { CONFIG_TABLE_DDL, ConfigConflictError, InMemoryConfigStore, configFromRow } from "../ops.configs.js";

const candidate = {
  name: "sonnet-evaluator",
  description: "evaluator on sonnet",
  models: { opportunityEvaluator: "anthropic/claude-sonnet-4" },
  env: {},
};

describe("InMemoryConfigStore", () => {
  it("creates, lists, gets, updates and removes configs", async () => {
    const store = new InMemoryConfigStore();
    await store.create(candidate);
    expect(await store.get("sonnet-evaluator")).toEqual(candidate);
    expect((await store.list()).map((c) => c.name)).toEqual(["sonnet-evaluator"]);

    const updated = await store.update("sonnet-evaluator", { description: "better description" });
    expect(updated?.description).toBe("better description");
    expect(updated?.models).toEqual(candidate.models);

    expect(await store.remove("sonnet-evaluator")).toBe(true);
    expect(await store.get("sonnet-evaluator")).toBeNull();
    expect(await store.remove("sonnet-evaluator")).toBe(false);
  });

  it("rejects a duplicate name with ConfigConflictError", async () => {
    const store = new InMemoryConfigStore();
    await store.create(candidate);
    await expect(store.create(candidate)).rejects.toBeInstanceOf(ConfigConflictError);
  });

  it("returns null when updating an unknown name", async () => {
    expect(await new InMemoryConfigStore().update("nope", { description: "x" })).toBeNull();
  });
});

describe("CONFIG_TABLE_DDL", () => {
  it("is idempotent", () => {
    expect(CONFIG_TABLE_DDL).toContain("CREATE TABLE IF NOT EXISTS eval_ops_configs");
  });
});

describe("configFromRow", () => {
  it("parses string-typed jsonb fields (verified Bun v1.3.14 driver behaviour)", () => {
    const profile = configFromRow({
      name: "sonnet-evaluator",
      description: "evaluator on sonnet",
      models: JSON.stringify({ opportunityEvaluator: "anthropic/claude-sonnet-4" }),
      env: JSON.stringify({ RUN_OPPORTUNITY_EVAL_IN_PARALLEL: "true" }),
    });
    expect(profile).toEqual({
      name: "sonnet-evaluator",
      description: "evaluator on sonnet",
      models: { opportunityEvaluator: "anthropic/claude-sonnet-4" },
      env: { RUN_OPPORTUNITY_EVAL_IN_PARALLEL: "true" },
    });
  });

  it("passes object-typed fields through unchanged", () => {
    const profile = configFromRow(candidate);
    expect(profile).toEqual(candidate);
  });

  it("surfaces corrupt JSON as a clear error naming the config and field", () => {
    expect(() =>
      configFromRow({
        name: "broken",
        description: "x",
        models: "{not json",
        env: {},
      }),
    ).toThrow(/Config "broken" has corrupt JSON in models/);
  });

  it("still rejects schema violations (schema not relaxed)", () => {
    expect(() =>
      configFromRow({
        name: "Not Kebab Case",
        description: "x",
        models: {},
        env: {},
      }),
    ).toThrow();
  });
});
