import { describe, expect, it } from "bun:test";

import { CONFIG_TABLE_DDL, ConfigConflictError, InMemoryConfigStore } from "../ops.configs.js";

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
