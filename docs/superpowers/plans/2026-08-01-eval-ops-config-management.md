# Eval Ops Configuration Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators launch eval runs under different configurations — ad-hoc or named, created in the browser — and automatically compare two runs when both finish.

**Architecture:** UI configs are the existing profile concept stored in a Neon table instead of repo JSON, validated by the existing profile schema plus a new curated model allowlist. Ad-hoc launch overrides resolve through the same profile path so fingerprints match named configs. Run-vs-run comparison reads each run's captured `report.json` (written for every run, even `--no-save`) and diffs them with the existing `compareArtifacts`, with config mismatch explicitly allowed because config is the variable under test.

**Tech Stack:** Bun, zod, Bun.SQL (postgres), React + vitest (apps/eval-ops), plain-TypeScript ops package (packages/protocol/eval/ops, `bun test`).

**Spec:** `docs/superpowers/specs/2026-08-01-eval-ops-config-management-design.md` (same worktree).

## Global Constraints

- Worktree: `/home/yanek/Projects/index/.worktrees/feat-eval-ops-deploy`, branch `feat/eval-ops-deploy`. Never edit the canonical root.
- Ops package tests: `cd packages/protocol && bun test eval/ops/tests/`. App tests: `cd apps/eval-ops && bun run test` (**vitest** — `bun test` is the wrong runner here and produces spurious failures).
- Typecheck: `bunx tsc --noEmit` in each touched package.
- `docs/superpowers/` is gitignored: `git add -f` for spec/plan files (precedent exists in history).
- Client-originated config must validate through the SAME zod + allowlist path everywhere (save, edit, launch). No parallel validation.
- Any run with overrides is experimental → `--no-save` forced. Baselines must not be polluted through the UI.
- `compareArtifacts` config-mismatch refusal stays ON for artifact compare; only run-vs-run compare relaxes it.
- SemVer bump + regenerated `bun.lock` for every touched package, per repo convention, in the final task.

## File Structure

- `packages/protocol/eval/ops/ops.profiles.ts` (modify) — curated model allowlist, `validateConfigOverrides`, `resolveAdHoc`.
- `packages/protocol/eval/ops/ops.registry.ts` (modify) — `agents` on each harness descriptor.
- `packages/protocol/eval/ops/ops.types.ts` (modify) — `HarnessDescriptor.agents`, `EvalRunSpec.overrides`.
- `packages/protocol/eval/ops/ops.configs.ts` (create) — config store: interface, in-memory, Bun.SQL impl, DDL.
- `packages/protocol/eval/ops/ops.argv.ts` (modify) — `RunSpecSchema.overrides`.
- `packages/protocol/eval/ops/ops.compare.ts` (modify) — `allowConfigMismatch` option.
- `packages/protocol/eval/ops/ops.server.ts` (modify) — config routes, launch resolution, run-vs-run compare, boot DDL.
- `apps/eval-ops/src/api/client.ts` (modify) — config + compareRuns methods, types.
- `apps/eval-ops/src/components/OverridesEditor.tsx` (create) — shared override editing widget.
- `apps/eval-ops/src/routes/Launch.tsx` (modify) — overrides section, A/B mode.
- `apps/eval-ops/src/routes/Profiles.tsx` (modify) — becomes the Configs page (repo + saved, CRUD, launch).
- `apps/eval-ops/src/routes/Compare.tsx` (modify) — pair mode: dual progress → auto diff.
- Tests: `packages/protocol/eval/ops/tests/{profiles,configs,server,compare}.spec.ts`, `apps/eval-ops/tests/{launch,profiles,compare}.test.tsx`.

---

### Task 1: Curated model allowlist, agent map, override validation

**Files:**
- Modify: `packages/protocol/eval/ops/ops.profiles.ts`
- Modify: `packages/protocol/eval/ops/ops.registry.ts` (descriptor entries)
- Modify: `packages/protocol/eval/ops/ops.types.ts` (`HarnessDescriptor`)
- Test: `packages/protocol/eval/ops/tests/profiles.spec.ts`

**Interfaces:**
- Produces:
  - `export const ALLOWED_CONFIG_MODELS: readonly string[]`
  - `export function validateConfigOverrides(overrides: { models: Record<string, string>; env: Record<string, string> }): string[]` — returns issue messages, empty when valid.
  - `export function resolveAdHoc(overrides: { models: Record<string, string>; env: Record<string, string> }): ResolvedProfile` — synthetic profile named `default`, `experimental: true`, fingerprint identical to a named profile with the same payload.
  - `HarnessDescriptor.agents: readonly string[]`
- Consumes: existing `PROFILE_ENV_ALLOWLIST`, `ConfigProfileSchema`, `resolveProfile`, `ResolvedProfile` from `ops.profiles.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/protocol/eval/ops/tests/profiles.spec.ts`:

```ts
import { ALLOWED_CONFIG_MODELS, resolveAdHoc, validateConfigOverrides } from "../ops.profiles.js";
import { HARNESS_REGISTRY } from "../ops.registry.js";

describe("validateConfigOverrides", () => {
  it("accepts a valid override set", () => {
    expect(validateConfigOverrides({
      models: { opportunityEvaluator: ALLOWED_CONFIG_MODELS[0] },
      env: { RUN_OPPORTUNITY_EVAL_IN_PARALLEL: "true" },
    })).toEqual([]);
  });

  it("rejects a model outside the curated allowlist and names it", () => {
    const issues = validateConfigOverrides({
      models: { opportunityEvaluator: "anthropic/claude-opus-4.8" },
      env: {},
    });
    expect(issues.some((i) => i.includes("claude-opus-4.8"))).toBe(true);
  });

  it("rejects an agent key no scorecard harness exercises", () => {
    const issues = validateConfigOverrides({ models: { negotiator: ALLOWED_CONFIG_MODELS[0] }, env: {} });
    expect(issues.some((i) => i.includes("negotiator"))).toBe(true);
  });

  it("rejects an env key outside PROFILE_ENV_ALLOWLIST", () => {
    const issues = validateConfigOverrides({ models: {}, env: { OPENROUTER_API_KEY: "x" } });
    expect(issues.some((i) => i.includes("OPENROUTER_API_KEY"))).toBe(true);
  });
});

describe("resolveAdHoc", () => {
  it("fingerprints identically to a named profile with the same payload", () => {
    const overrides = { models: { opportunityEvaluator: "anthropic/claude-sonnet-4" }, env: {} };
    const adHoc = resolveAdHoc(overrides);
    const named = resolveProfile({ name: "candidate", description: "x", ...overrides });
    expect(adHoc.fingerprint).toBe(named.fingerprint);
    expect(adHoc.experimental).toBe(true);
    expect(adHoc.profile.name).toBe("default");
    expect(adHoc.env.EVAL_MODEL_OVERRIDES).toBe(JSON.stringify(overrides.models));
  });
});

describe("HARNESS_REGISTRY agents", () => {
  it("maps each harness to the agents it exercises", () => {
    expect(HARNESS_REGISTRY.matching.agents).toEqual(["opportunityEvaluator"]);
    expect(HARNESS_REGISTRY.opportunity.agents).toEqual(["opportunityPresenter"]);
    expect(HARNESS_REGISTRY.profile.agents).toEqual(["profileGenerator"]);
    expect(HARNESS_REGISTRY.premise.agents).toEqual(["premiseDecomposer", "premiseAnalyzer"]);
  });
});
```

(`resolveProfile` is already imported in the existing test file; add it if not.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/protocol && bun test eval/ops/tests/profiles.spec.ts`
Expected: FAIL — `ALLOWED_CONFIG_MODELS`/`validateConfigOverrides`/`resolveAdHoc` not exported; `agents` missing on descriptors.

- [ ] **Step 3: Implement**

In `ops.types.ts`, add to `HarnessDescriptor`:

```ts
  /** Model-overridable agents this harness exercises, in pipeline order. */
  agents: readonly string[];
```

In `ops.registry.ts`, add to each descriptor: matching → `agents: ["opportunityEvaluator"]`, opportunity → `agents: ["opportunityPresenter"]`, profile → `agents: ["profileGenerator"]`, premise → `agents: ["premiseDecomposer", "premiseAnalyzer"]`. (Grounded in source: matching constructs `OpportunityEvaluator`; opportunity `OpportunityPresenter`; profile's `EnrichmentGenerator` calls `createStructuredModel("profileGenerator", …)`; premise constructs `PremiseDecomposer` + `PremiseAnalyzer`.)

In `ops.profiles.ts`, append:

```ts
/**
 * The only models a client may select. Live spend on a shared URL with no
 * actor attribution yet: free-text slugs stay out until attribution exists.
 * Repo profiles are code-reviewed and exempt.
 */
export const ALLOWED_CONFIG_MODELS = [
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "google/gemini-3-pro-preview",
  "anthropic/claude-sonnet-4",
  "anthropic/claude-haiku-4.5",
  "openai/gpt-4.1-mini",
] as const;

/** Agent keys any scorecard harness can actually exercise (from the registry). */
function overridableAgents(): ReadonlySet<string> {
  return new Set(Object.values(HARNESS_REGISTRY).flatMap((d) => d.agents));
}

/**
 * Validates client-originated overrides. Returns human-readable issues;
 * empty means valid. Used by the config routes and the launch path — never
 * by the repo profile loader, whose files are code-reviewed.
 */
export function validateConfigOverrides(overrides: {
  models: Record<string, string>;
  env: Record<string, string>;
}): string[] {
  const issues: string[] = [];
  const agents = overridableAgents();
  for (const [agent, model] of Object.entries(overrides.models)) {
    if (!agents.has(agent)) {
      issues.push(`Unknown agent "${agent}". Overridable agents: ${[...agents].sort().join(", ")}`);
    } else if (!(ALLOWED_CONFIG_MODELS as readonly string[]).includes(model)) {
      issues.push(`Model "${model}" is not selectable. Allowed: ${ALLOWED_CONFIG_MODELS.join(", ")}`);
    }
  }
  for (const key of Object.keys(overrides.env)) {
    if (!PROFILE_ENV_ALLOWLIST.includes(key)) {
      issues.push(`env key ${key} is not in PROFILE_ENV_ALLOWLIST`);
    }
  }
  return issues;
}

/**
 * Resolves ad-hoc launch overrides through the same path as a named profile,
 * so fingerprints match a saved config with the same payload. The synthetic
 * profile is named "default" (renderRun asserts the resolved name matches the
 * requested one) but is always experimental: ad-hoc runs never save.
 */
export function resolveAdHoc(overrides: {
  models: Record<string, string>;
  env: Record<string, string>;
}): ResolvedProfile {
  const resolved = resolveProfile({ name: DEFAULT_PROFILE_NAME, description: "ad-hoc overrides", ...overrides });
  return { ...resolved, experimental: true };
}
```

Import `HARNESS_REGISTRY` from `./ops.registry.js` in `ops.profiles.ts` (check for an import cycle first: `ops.registry.ts` must not import `ops.profiles.ts` — it currently does not).

Wait — `resolveProfile` rejects a `default` profile with overrides? No: the *loader* (`loadProfiles`) rejects default-with-overrides; `resolveProfile` itself does not. Confirm while implementing; if it does, inline the fingerprint/env construction instead of calling `resolveProfile`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/protocol && bun test eval/ops/tests/profiles.spec.ts`
Expected: PASS. Also `bun test eval/ops/tests/` (registry shape change ripples) and `bunx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/eval/ops/ops.profiles.ts packages/protocol/eval/ops/ops.registry.ts packages/protocol/eval/ops/ops.types.ts packages/protocol/eval/ops/tests/profiles.spec.ts
git commit -m "feat(eval-ops): curated model allowlist, harness agent map, override validation"
```

---

### Task 2: Config store (DB-backed, with in-memory fake)

**Files:**
- Create: `packages/protocol/eval/ops/ops.configs.ts`
- Test: `packages/protocol/eval/ops/tests/configs.spec.ts`

**Interfaces:**
- Consumes: `ConfigProfile`, `ConfigProfileSchema`, `validateConfigOverrides` (Task 1).
- Produces:
  - `export interface ConfigStore { list(): Promise<ConfigProfile[]>; get(name: string): Promise<ConfigProfile | null>; create(profile: ConfigProfile): Promise<void>; update(name: string, patch: { description?: string; models?: Record<string, string>; env?: Record<string, string> }): Promise<ConfigProfile | null>; remove(name: string): Promise<boolean>; }`
  - `export class InMemoryConfigStore implements ConfigStore`
  - `export class BunSqlConfigStore implements ConfigStore` — `constructor(databaseUrl: string)`; `async ensureTable(): Promise<void>` runs idempotent DDL.
  - `export const CONFIG_TABLE_DDL: string`
  - `export class ConfigConflictError extends Error` (name already exists)

- [ ] **Step 1: Write the failing tests**

`packages/protocol/eval/ops/tests/configs.spec.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { InMemoryConfigStore, ConfigConflictError, CONFIG_TABLE_DDL } from "../ops.configs.js";

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
```

- [ ] **Step 2: Run to verify fail** — `cd packages/protocol && bun test eval/ops/tests/configs.spec.ts` → module not found.

- [ ] **Step 3: Implement `ops.configs.ts`**

```ts
import { SQL } from "bun";
import { ConfigProfileSchema, type ConfigProfile } from "./ops.profiles.js";

export class ConfigConflictError extends Error {
  constructor(name: string) {
    super(`A config named "${name}" already exists`);
    this.name = "ConfigConflictError";
  }
}

export const CONFIG_TABLE_DDL = `
  CREATE TABLE IF NOT EXISTS eval_ops_configs (
    name        text PRIMARY KEY,
    description text NOT NULL,
    models      jsonb NOT NULL DEFAULT '{}',
    env         jsonb NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
  )`;

export interface ConfigStore {
  list(): Promise<ConfigProfile[]>;
  get(name: string): Promise<ConfigProfile | null>;
  create(profile: ConfigProfile): Promise<void>;
  update(name: string, patch: { description?: string; models?: Record<string, string>; env?: Record<string, string> }): Promise<ConfigProfile | null>;
  remove(name: string): Promise<boolean>;
}

export class InMemoryConfigStore implements ConfigStore {
  private readonly configs = new Map<string, ConfigProfile>();
  async list(): Promise<ConfigProfile[]> {
    return [...this.configs.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  async get(name: string): Promise<ConfigProfile | null> {
    return this.configs.get(name) ?? null;
  }
  async create(profile: ConfigProfile): Promise<void> {
    if (this.configs.has(profile.name)) throw new ConfigConflictError(profile.name);
    this.configs.set(profile.name, profile);
  }
  async update(name: string, patch: { description?: string; models?: Record<string, string>; env?: Record<string, string> }): Promise<ConfigProfile | null> {
    const existing = this.configs.get(name);
    if (existing === undefined) return null;
    const updated: ConfigProfile = {
      name,
      description: patch.description ?? existing.description,
      models: patch.models ?? existing.models,
      env: patch.env ?? existing.env,
    };
    this.configs.set(name, updated);
    return updated;
  }
  async remove(name: string): Promise<boolean> {
    return this.configs.delete(name);
  }
}

/**
 * Config persistence in the same Neon database the fixture control plane uses.
 * The table is eval-ops app state, not fixture corpus: db:flush truncates a
 * hard-coded list of api-owned tables, so a fixture reset never touches it.
 */
export class BunSqlConfigStore implements ConfigStore {
  private readonly sql: SQL;
  constructor(databaseUrl: string) {
    this.sql = new SQL(databaseUrl);
  }
  async ensureTable(): Promise<void> {
    await this.sql.unsafe(CONFIG_TABLE_DDL);
  }
  async list(): Promise<ConfigProfile[]> {
    const rows = await this.sql`SELECT name, description, models, env FROM eval_ops_configs ORDER BY name`;
    return rows.map((row) => ConfigProfileSchema.parse(row));
  }
  async get(name: string): Promise<ConfigProfile | null> {
    const rows = await this.sql`SELECT name, description, models, env FROM eval_ops_configs WHERE name = ${name}`;
    return rows.length === 0 ? null : ConfigProfileSchema.parse(rows[0]);
  }
  async create(profile: ConfigProfile): Promise<void> {
    try {
      await this.sql`INSERT INTO eval_ops_configs (name, description, models, env)
        VALUES (${profile.name}, ${profile.description}, ${JSON.stringify(profile.models)}, ${JSON.stringify(profile.env)})`;
    } catch (error) {
      if (error instanceof Error && error.message.includes("duplicate key")) throw new ConfigConflictError(profile.name);
      throw error;
    }
  }
  async update(name: string, patch: { description?: string; models?: Record<string, string>; env?: Record<string, string> }): Promise<ConfigProfile | null> {
    const existing = await this.get(name);
    if (existing === null) return null;
    const updated: ConfigProfile = {
      name,
      description: patch.description ?? existing.description,
      models: patch.models ?? existing.models,
      env: patch.env ?? existing.env,
    };
    await this.sql`UPDATE eval_ops_configs
      SET description = ${updated.description}, models = ${JSON.stringify(updated.models)},
          env = ${JSON.stringify(updated.env)}, updated_at = now()
      WHERE name = ${name}`;
    return updated;
  }
  async remove(name: string): Promise<boolean> {
    const rows = await this.sql`DELETE FROM eval_ops_configs WHERE name = ${name} RETURNING name`;
    return rows.length > 0;
  }
}
```

Note for implementer: `ConfigProfileSchema` is not currently exported from `ops.profiles.ts` — export it. The SQL jsonb columns: Bun.SQL serialises bound JS objects for jsonb; if binding plain objects fails, bind `JSON.stringify(...)` with `::jsonb` casts — verify against the real driver behaviour used in `ops.fixture.ts` (`BunSqlFixtureInspector`).

- [ ] **Step 4: Run to verify pass** — `bun test eval/ops/tests/configs.spec.ts` and full `bun test eval/ops/tests/`, `bunx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/eval/ops/ops.configs.ts packages/protocol/eval/ops/ops.profiles.ts packages/protocol/eval/ops/tests/configs.spec.ts
git commit -m "feat(eval-ops): config store with in-memory and Bun.SQL implementations"
```

---

### Task 3: Config routes + boot DDL in the ops server

**Files:**
- Modify: `packages/protocol/eval/ops/ops.server.ts`
- Test: `packages/protocol/eval/ops/tests/server.spec.ts`

**Interfaces:**
- Consumes: `ConfigStore`, `BunSqlConfigStore`, `InMemoryConfigStore`, `ConfigConflictError`, `validateConfigOverrides`, `ALLOWED_CONFIG_MODELS`, `ConfigProfileSchema`.
- Produces (HTTP, under the existing auth gate):
  - `GET /api/configs` → `{ repo: ConfigProfile[], saved: ConfigProfile[] }`
  - `GET /api/configs/models` → `{ models: string[] }`
  - `POST /api/configs` body `ConfigProfile` → 201 created config; 400 with issue list; 409 on name collision (repo profile OR saved config)
  - `PATCH /api/configs/:name` body `{ description?, models?, env? }` → updated config; 404 unknown; 400 invalid; 409 if `:name` is a repo profile
  - `DELETE /api/configs/:name` → 204; 404 unknown; 409 if repo profile

- [ ] **Step 1: Write the failing tests**

Follow the existing `server.spec.ts` harness (it builds the server with an in-memory run store; extend that context with an `InMemoryConfigStore`). Tests:

```ts
describe("config routes", () => {
  it("lists repo profiles and saved configs in one response", async () => {
    // seed InMemoryConfigStore with one config; GET /api/configs
    // expect body.repo to equal the committed profiles and body.saved the seeded one
  });

  it("creates a config and rejects a name colliding with a repo profile", async () => {
    // POST valid config → 201
    // POST { name: "default", ... } → 409 (repo profile name)
    // POST same name twice → 409
  });

  it("rejects models outside the curated list with a 400 naming the model", async () => {
    // POST { models: { opportunityEvaluator: "x/y" } } → 400, body contains "x/y"
  });

  it("rejects env keys outside the allowlist", async () => {
    // POST { env: { OPENROUTER_API_KEY: "x" } } → 400
  });

  it("updates and deletes a saved config, 404s unknown names, 409s repo profile names", async () => {
    // PATCH saved → 200; PATCH "default" → 409; PATCH "ghost" → 404
    // DELETE saved → 204; DELETE "default" → 409; DELETE "ghost" → 404
  });

  it("serves the curated model list", async () => {
    // GET /api/configs/models → 200, body.models includes "google/gemini-2.5-flash"
  });
});
```

- [ ] **Step 2: Run to verify fail** — routes 404.

- [ ] **Step 3: Implement**

In `ops.server.ts`:

1. `OpsContext` gains `configs: ConfigStore`. In the production context factory (where `profilesDir` etc. are assembled), build `BunSqlConfigStore` from `process.env.DATABASE_URL` when set, else `InMemoryConfigStore` (and log loudly that configs will not persist). Await `ensureTable()` at boot when the store is `BunSqlConfigStore`; on DDL failure, throw — the server must refuse to start (fail closed per spec).
2. Route registrations inside `route()`:

```ts
if (request.method === "GET") {
  // ...
  if (resource === "configs" && rest.length === 0) return await listConfigs(context);
  if (resource === "configs" && rest.length === 1 && rest[0] === "models") return json({ models: [...ALLOWED_CONFIG_MODELS] });
}
if (request.method === "POST") {
  // ...
  if (resource === "configs" && rest.length === 0) return await createConfig(context, request);
}
if (request.method === "PATCH") {
  if (resource === "configs" && rest.length === 1) return await updateConfig(context, rest[0], request);
}
if (request.method === "DELETE") {
  if (resource === "configs" && rest.length === 1) return await deleteConfig(context, rest[0]);
}
```

(Check how `route()` is dispatched for non-GET/POST methods today — if the router only branches on GET/POST, add PATCH/DELETE branches.)

3. Handlers (new, near `compare()`):

```ts
async function listConfigs(context: OpsContext): Promise<Response> {
  return json({ repo: await loadProfiles(context.profilesDir), saved: await context.configs.list() });
}

async function createConfig(context: OpsContext, request: Request): Promise<Response> {
  const body = await readJson(request);
  if (!body.ok) return json({ error: body.error }, body.status);
  const parsed = ConfigProfileSchema.safeParse(body.value);
  if (!parsed.success) return json({ error: describeIssues(parsed.error) }, 400);
  const issues = validateConfigOverrides(parsed.data);
  if (issues.length > 0) return json({ error: issues.join("; ") }, 400);
  if (parsed.data.name === DEFAULT_PROFILE_NAME) {
    return json({ error: `"${DEFAULT_PROFILE_NAME}" names the shipped default profile` }, 409);
  }
  const repoNames = new Set((await loadProfiles(context.profilesDir)).map((p) => p.name));
  if (repoNames.has(parsed.data.name)) {
    return json({ error: `"${parsed.data.name}" names a shipped repo profile` }, 409);
  }
  try {
    await context.configs.create(parsed.data);
  } catch (error) {
    if (error instanceof ConfigConflictError) return json({ error: error.message }, 409);
    throw error;
  }
  return json(parsed.data, 201);
}
```

`updateConfig`/`deleteConfig` follow the same pattern: repo-name check → 409; store miss → 404; patch re-validated through `ConfigProfileSchema.partial()` minus `name` (name is immutable) plus `validateConfigOverrides` on the merged result.

- [ ] **Step 4: Run to verify pass** — `bun test eval/ops/tests/server.spec.ts`, full ops suite, typecheck.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/eval/ops/ops.server.ts packages/protocol/eval/ops/tests/server.spec.ts
git commit -m "feat(eval-ops): config CRUD routes with repo-profile collision guards"
```

---

### Task 4: Ad-hoc overrides at launch + DB configs in profile resolution

**Files:**
- Modify: `packages/protocol/eval/ops/ops.argv.ts` (`RunSpecSchema`)
- Modify: `packages/protocol/eval/ops/ops.types.ts` (`EvalRunSpec`)
- Modify: `packages/protocol/eval/ops/ops.server.ts` (`launchRun`)
- Test: `packages/protocol/eval/ops/tests/server.spec.ts` (launch section)

**Interfaces:**
- Consumes: `validateConfigOverrides`, `resolveAdHoc` (Task 1), `ConfigStore` (Task 2/3).
- Produces: `EvalRunSpec.overrides?: { models: Record<string, string>; env: Record<string, string> }`. Launch accepts either a named profile (repo or DB) or `profile: "default"` + `overrides`; both present (named profile + overrides) → 400.

- [ ] **Step 1: Write the failing tests**

```ts
describe("launch with overrides", () => {
  it("launches an ad-hoc run as experimental with the overrides env injected", async () => {
    // POST /api/runs { kind: "eval", harness: "matching", profile: "default",
    //   flags: { runs: 1 }, overrides: { models: { opportunityEvaluator: "anthropic/claude-sonnet-4" }, env: {} } }
    // → 202; record.experimental === true;
    // record.env.EVAL_MODEL_OVERRIDES contains claude-sonnet-4;
    // record.argv contains --no-save
  });

  it("fingerprints an ad-hoc run identically to a saved config with the same payload", async () => {
    // create config "candidate" with payload P via POST /api/configs
    // launch profile "candidate"; launch ad-hoc with P
    // → both records share profileFingerprint; both experimental
  });

  it("rejects a named profile combined with overrides", async () => {
    // POST { profile: "default" /* or any */, overrides, and profile != "default" } → 400
    // also: schema rejects overrides key on a non-default profile at parse time
  });

  it("rejects override models outside the curated list at launch", async () => {
    // → 400 naming the model
  });

  it("resolves a saved DB config exactly like a repo profile", async () => {
    // seed config store; POST /api/runs with profile = saved name → 202,
    // env injected, experimental true, --no-save in argv
  });
});
```

- [ ] **Step 2: Run to verify fail** — schema rejects `overrides` (strict) / unknown profile.

- [ ] **Step 3: Implement**

1. `ops.types.ts`:

```ts
export interface EvalRunSpec {
  kind: "eval";
  harness: OpsHarness;
  /** Name of a committed or saved profile. "default" + overrides = ad-hoc. */
  profile: string;
  /** Ad-hoc overrides; only valid with profile "default". Never credentials. */
  overrides?: { models: Record<string, string>; env: Record<string, string> };
  flags: RunFlags;
}
```

2. `ops.argv.ts` `RunSpecSchema`: add

```ts
      overrides: z
        .object({ models: z.record(z.string().min(1)), env: z.record(z.string()) })
        .strict()
        .optional(),
```

and extend `superRefine`: when `spec.overrides !== undefined && spec.profile !== "default"`, add an issue at `["overrides"]`: "ad-hoc overrides require profile \"default\"; launch a named config and tweak it from the Configs page instead".

3. `ops.server.ts` `launchRun`, replace the profile lookup block:

```ts
    let resolved: ResolvedProfile;
    if (parsed.data.overrides !== undefined) {
      const issues = validateConfigOverrides(parsed.data.overrides);
      if (issues.length > 0) return json({ error: issues.join("; ") }, 400);
      resolved = resolveAdHoc(parsed.data.overrides);
    } else {
      // Profiles resolve from both sources: shipped repo files and saved configs.
      const repoProfiles = await loadProfiles(context.profilesDir);
      const profile =
        repoProfiles.find((candidate) => candidate.name === parsed.data.profile)
        ?? await context.configs.get(parsed.data.profile)
        ?? undefined;
      if (profile === undefined) return json({ error: `Unknown profile "${parsed.data.profile}"` }, 400);
      resolved = resolveProfile(profile);
    }
```

Nothing else in `launchRun` changes: `renderRun` already forces `--no-save` for experimental runs and pins `OPENROUTER_FALLBACK_MODEL=none` for model overrides.

- [ ] **Step 4: Run to verify pass** — server spec, full ops suite, typecheck.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/eval/ops/ops.argv.ts packages/protocol/eval/ops/ops.types.ts packages/protocol/eval/ops/ops.server.ts packages/protocol/eval/ops/tests/server.spec.ts
git commit -m "feat(eval-ops): ad-hoc launch overrides and DB-config profile resolution"
```

---

### Task 5: Run-vs-run comparison endpoint

**Files:**
- Modify: `packages/protocol/eval/ops/ops.compare.ts`
- Modify: `packages/protocol/eval/ops/ops.server.ts` (`compare()`)
- Test: `packages/protocol/eval/ops/tests/compare.spec.ts` (create or extend)

**Interfaces:**
- Consumes: `context.store.get(id)`, `context.store.reportPath(id)`, `readEvalArtifact` from `../shared/index.js` (already used by `ops.artifacts.ts` via `parseEvalArtifact`; use `parseEvalArtifact(json, { expectedType: EVAL_RUN_REPORT_ARTIFACT_TYPE })`), `getExecutionEvidence` from `../shared/index.js`.
- Produces:
  - `compareArtifacts(reference, subject, alpha?, opts?: { allowConfigMismatch?: boolean })`
  - `GET /api/compare?referenceRun=<id>&subjectRun=<id>` → `CompareOutcome & { runs: { reference: RunSide; subject: RunSide } }` where `RunSide = { id: string; profile: string; profileFingerprint: string; complete: boolean | null }`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("compareArtifacts allowConfigMismatch", () => {
  it("still refuses artifact compare when configs differ (default)", () => {
    // two envelopes differing only in configFingerprint → comparable: false
  });
  it("compares across configs when allowConfigMismatch is set", () => {
    // same pair with opts → comparable: true, regressions/improvements present
  });
});

describe("run-vs-run compare route", () => {
  it("diffs two run reports and labels each side", async () => {
    // seed store with two runs whose report.json files exist (fixtures under
    // a temp .ops-runs dir — follow how server.spec.ts seeds run records)
    // GET /api/compare?referenceRun=a&subjectRun=b
    // → 200; body.runs.reference.id === "a"; comparable true; evidence complete flags present
  });
  it("422s naming the side whose report is missing", async () => {
    // subject run without report.json → 422, message contains the subject run id
  });
  it("404s an unknown run id", async () => { /* ... */ });
  it("400s when run params and artifact params are mixed", async () => { /* ... */ });
});
```

Envelope fixtures: build minimal v2 envelopes via `buildEvalArtifact(EVAL_RUN_REPORT_ARTIFACT_TYPE, scorecard, meta)` from `../shared/index.js` — copy the scorecard/meta shape from an existing compare or artifact test.

- [ ] **Step 2: Run to verify fail** — `allowConfigMismatch` not accepted; route 400s on run params.

- [ ] **Step 3: Implement**

1. `ops.compare.ts`: extend the signature and gate the config finding:

```ts
export function compareArtifacts(
  reference: EvalArtifactEnvelope,
  subject: EvalArtifactEnvelope,
  alpha = 0.05,
  opts: { allowConfigMismatch?: boolean } = {},
): CompareOutcome {
  // ...
  if (!opts.allowConfigMismatch && reference.configFingerprint !== subject.configFingerprint) {
    findings.push({ dimension: "configFingerprint", /* ... */ });
  }
```

(When the mismatch is allowed it is the variable under test, not a finding.)

2. `ops.server.ts` `compare()`:

```ts
async function compare(context: OpsContext, url: URL): Promise<Response> {
  const referenceId = url.searchParams.get("reference");
  const subjectId = url.searchParams.get("subject");
  const referenceRun = url.searchParams.get("referenceRun");
  const subjectRun = url.searchParams.get("subjectRun");
  const artifactMode = referenceId !== null || subjectId !== null;
  const runMode = referenceRun !== null || subjectRun !== null;
  if (artifactMode === runMode) {
    return json({ error: "compare requires either reference+subject artifact ids or referenceRun+subjectRun run ids" }, 400);
  }
  if (runMode) {
    if (referenceRun === null || subjectRun === null) {
      return json({ error: "compare requires both referenceRun and subjectRun" }, 400);
    }
    return await compareRuns(context, referenceRun, subjectRun);
  }
  // … existing artifact path unchanged …
}

async function compareRuns(context: OpsContext, referenceRunId: string, subjectRunId: string): Promise<Response> {
  const sides: { id: string; record: RunRecord; envelope: EvalArtifactEnvelope }[] = [];
  for (const id of [referenceRunId, subjectRunId]) {
    const record = await context.store.get(id);
    if (record === null) return json({ error: `Unknown run id: ${id}` }, 404);
    const reportPath = context.store.reportPath(record.id);
    if (!(await Bun.file(reportPath).exists())) {
      return json({ error: `Run ${id} has no report to compare (it may have died before writing one)` }, 422);
    }
    const envelope = parseEvalArtifact(await Bun.file(reportPath).json(), { expectedType: EVAL_RUN_REPORT_ARTIFACT_TYPE });
    sides.push({ id, record, envelope });
  }
  const [reference, subject] = sides;
  const outcome = compareArtifacts(reference.envelope, subject.envelope, 0.05, { allowConfigMismatch: true });
  const side = ({ id, record, envelope }: (typeof sides)[number]) => ({
    id,
    profile: record.spec.kind === "eval" ? record.spec.profile : "default",
    profileFingerprint: record.profileFingerprint,
    complete: getExecutionEvidence(envelope)?.complete ?? null,
  });
  return json({ ...outcome, runs: { reference: side(reference), subject: side(subject) } });
}
```

Check `getExecutionEvidence`'s evidence shape for the exact `complete` field name (`EvalExecutionEvidence` from `eval/shared/runner.ts` — the artifact test at `artifact.ts:68` shows `complete: z.boolean()` inside the evidence schema).

- [ ] **Step 4: Run to verify pass** — compare spec, full ops suite, typecheck.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/eval/ops/ops.compare.ts packages/protocol/eval/ops/ops.server.ts packages/protocol/eval/ops/tests/compare.spec.ts
git commit -m "feat(eval-ops): run-vs-run comparison across configs"
```

---

### Task 6: App client methods and types

**Files:**
- Modify: `apps/eval-ops/src/api/client.ts`
- Test: `apps/eval-ops/tests/client.test.ts`

**Interfaces:**
- Consumes: Task 3 routes, Task 5 route.
- Produces:
  - `export interface ConfigProfile { name: string; description: string; models: Record<string, string>; env: Record<string, string> }`
  - `api.configs(): Promise<{ repo: ConfigProfile[]; saved: ConfigProfile[] }>`
  - `api.createConfig(profile: ConfigProfile): Promise<ConfigProfile>`
  - `api.updateConfig(name: string, patch: Partial<Omit<ConfigProfile, "name">>): Promise<ConfigProfile>`
  - `api.deleteConfig(name: string): Promise<void>`
  - `api.configModels(): Promise<{ models: string[] }>`
  - `api.compareRuns(referenceRun: string, subjectRun: string): Promise<RunCompareResult>`
  - `export type RunCompareResult = CompareResult & { runs?: { reference: RunSide; subject: RunSide } }`, `RunSide = { id: string; profile: string; profileFingerprint: string; complete: boolean | null }`
  - `RunSpec` (client copy) gains `overrides?: { models: Record<string, string>; env: Record<string, string> }`

- [ ] **Step 1: Failing tests** in `client.test.ts`: stub `fetch` per-URL and assert each method hits the right route with the right method/body (`PATCH`/`DELETE` verbs included), and that `compareRuns` builds `/api/compare?referenceRun=a&subjectRun=b`.

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement** — mirror existing `api` methods; add `patchJson`/`deleteJson` helpers next to `postJson`:

```ts
async function patchJson<T>(url: string, body: unknown): Promise<T> {
  return fetchJson<T>(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
async function deleteJson(url: string): Promise<void> {
  await fetchJson<unknown>(url, { method: "DELETE" });
}
```

(Match the exact existing `postJson` error/refusal handling — copy its shape, do not improvise a second style.)

- [ ] **Step 4: Run to verify pass** — `cd apps/eval-ops && bun run test` and `bunx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add apps/eval-ops/src/api/client.ts apps/eval-ops/tests/client.test.ts
git commit -m "feat(eval-ops): client methods for configs and run comparison"
```

---

### Task 7: OverridesEditor component + Launch page (ad-hoc + save-as-config + A/B)

**Files:**
- Create: `apps/eval-ops/src/components/OverridesEditor.tsx`
- Modify: `apps/eval-ops/src/routes/Launch.tsx`
- Test: `apps/eval-ops/tests/launch.test.tsx`

**Interfaces:**
- Consumes: `api.configs`, `api.configModels`, `api.createConfig`, `api.launch`, `HarnessDescriptor.agents` (already served by `/api/harnesses`).
- Produces:
  - `<OverridesEditor agents: readonly string[]; models: readonly string[]; value: Overrides; onChange: (next: Overrides) => void />` where `Overrides = { models: Record<string, string>; env: Record<string, string> }`. Per-agent dropdown ("default" + curated models) and env key/value rows (key dropdown from a server-agnostic list passed via prop `envKeys: readonly string[]`, value text input, remove button; "add env override" button).
  - Launch submits `overrides` only when at least one model or env value is set.

- [ ] **Step 1: Failing tests** (`launch.test.tsx`, extend existing):

```tsx
it("submits ad-hoc overrides with profile default", async () => {
  // render Launch, open "overrides (this run only)", pick a model for the
  // harness's agent, submit → the posted spec has profile "default" and
  // overrides.models[agent] === chosen model
});

it("saves the current overrides as a named config", async () => {
  // set an override, click "save as config…", enter name+description,
  // confirm → POST /api/configs fired with the overrides payload
});

it("A/B mode fires two launches and navigates to the pair URL", async () => {
  // toggle A/B, give the candidate side an override, submit →
  // two POST /api/runs (reference first), navigate to
  // /compare?referenceRun=<first>&subjectRun=<second>
});

it("A/B mode defaults both sides to the same profile and shares flags", async () => {
  // flags (runs=1) appear in both posted specs
});
```

The existing launch tests stub `fetch` naïvely — follow the `run.test.tsx`/`Harness` lesson: compute derived data BEFORE setState, and keep extra fetches (`api.configs`, `api.configModels`) non-blocking with `.catch(() => {})` so a naïve stub can never crash the form.

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

`OverridesEditor.tsx`:

```tsx
export interface Overrides {
  models: Record<string, string>;
  env: Record<string, string>;
}

export const EMPTY_OVERRIDES: Overrides = { models: {}, env: {} };

export function hasOverrides(value: Overrides): boolean {
  return Object.keys(value.models).length > 0 || Object.keys(value.env).length > 0;
}
```

Render: for each agent in `agents`, a row `<span className="text-term-dim">{agent}</span>` + `<select>` with options `default` (empty string) and each curated model; onChange writes/deletes `value.models[agent]`. Env section: rows of `<select>` of unused `envKeys` + `<input>` value + `✕`; an "add env override" button appending a row with the first unused key. All plain controlled inputs — the site is mouse-first, no keyboard handlers.

`Launch.tsx` changes:
1. State gains `configs: { repo: ConfigProfile[]; saved: ConfigProfile[] }`, `models: string[]`, `ab: boolean`, `referenceOverrides: Overrides`, `candidateOverrides: Overrides`. Fetch configs/models on mount, non-blocking.
2. The profile `<select>` lists repo profiles then saved configs (labelled `(saved)`).
3. "overrides (this run only)" `<details>` section renders `<OverridesEditor>` for the harness's `agents`. In A/B mode the section becomes two columns labelled `reference` and `candidate`, each with its own editor.
4. Submit: build spec(s). Single mode: `overrides: hasOverrides(ref) ? ref : undefined`. A/B mode: two specs — reference `{ profile, overrides: hasOverrides(ref) ? ref : undefined }`, candidate likewise — POST sequentially (`await api.launch(a)` then `await api.launch(b)`), then `navigate(`/compare?referenceRun=${a.id}&subjectRun=${b.id}`)`. Single mode navigates to `/r/:id` as today. When a named profile other than `default` is chosen, overrides are not submitted (server rejects the combination); the UI disables the overrides section unless `profile === "default"` and points to the Configs page for tweaking saved configs.
5. "save as config…" (visible when `hasOverrides`): inline name + description inputs; POST; on success refresh `configs.saved` and switch the profile select to the new name.

- [ ] **Step 4: Run to verify pass** — `bun run test`, `bunx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add apps/eval-ops/src/components/OverridesEditor.tsx apps/eval-ops/src/routes/Launch.tsx apps/eval-ops/tests/launch.test.tsx
git commit -m "feat(eval-ops): launch overrides, save-as-config, A/B launch mode"
```

---

### Task 8: Profiles page becomes the Configs page

**Files:**
- Modify: `apps/eval-ops/src/routes/Profiles.tsx`
- Test: `apps/eval-ops/tests/profiles.test.tsx`

**Interfaces:**
- Consumes: `api.configs`, `api.updateConfig`, `api.deleteConfig`, `OverridesEditor` (Task 7).
- Produces: route `/profiles` (path unchanged) listing both sources; nav label updated to `configs`.

- [ ] **Step 1: Failing tests**

```tsx
it("lists shipped profiles read-only and saved configs with edit/delete", async () => {
  // shipped rows render dimmed with a "shipped" label and no delete button;
  // saved rows show edit + delete
});

it("deletes a saved config after confirmation", async () => { /* DELETE fired, row gone */ });

it("edits a saved config's models through the overrides editor", async () => { /* PATCH fired with merged payload */ });

it("links every config to a prefilled launch", async () => {
  // each row's "launch →" links to /launch?profile=<name>
});
```

(Launch reads `?profile=` to preselect — add that one-liner to Launch.tsx in this task.)

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement** — extend the existing Profiles page: fetch `api.configs()`; render `repo` entries dimmed with `shipped`, `saved` entries with edit (inline expansion with `OverridesEditor` + description input + save), delete (confirm inline: "delete? yes / no"), and `launch →`. Update the page heading to "configs" and the nav label where navigation is defined (find the nav component — likely `App.tsx` or a header component; the Overview nav pills list `harnesses profiles compare fixture launch`).

- [ ] **Step 4: Run to verify pass.**

- [ ] **Step 5: Commit**

```bash
git add apps/eval-ops/src/routes/Profiles.tsx apps/eval-ops/src/routes/Launch.tsx apps/eval-ops/tests/profiles.test.tsx
git commit -m "feat(eval-ops): configs page managing saved configs alongside shipped profiles"
```

---

### Task 9: Pair page — dual progress, automatic diff

**Files:**
- Modify: `apps/eval-ops/src/routes/Compare.tsx`
- Create: `apps/eval-ops/src/components/CompareDiff.tsx` (extract the existing diff rendering from Compare.tsx unchanged in behaviour)
- Test: `apps/eval-ops/tests/compare.test.tsx`

**Interfaces:**
- Consumes: `subscribeToRun`, `RunProgressView` + `HarnessProgressParser` (existing run page machinery), `api.compareRuns`, `CompareDiff`.
- Produces: `/compare?referenceRun=A&subjectRun=B` pair mode. Artifact mode (`reference`/`subject`) unchanged.

- [ ] **Step 1: Failing tests**

```tsx
it("shows both runs' progress while either is active", async () => {
  // referenceRun/subjectRun params; emit status+log frames for both
  // → two progress frames with each side's profile label
});

it("flips to the diff view when both runs are terminal", async () => {
  // both runs terminal → api.compareRuns fetched; regressions render;
  // each side header shows profile + config fingerprint prefix
});

it("renders the incomplete-evidence caveat when a side is incomplete", async () => {
  // compare result with runs.subject.complete === false → caveat text
});

it("keeps artifact compare working unchanged", async () => {
  // reference/subject params → existing behaviour (existing tests must pass)
});
```

Reuse the `MockEventSource` pattern from `run.test.tsx` — two subscriptions means the mock must hand out one instance per URL; extend the stub to a tiny factory keyed by run id.

- [ ] **Step 2: Run to verify fail.**

- [ ] **Step 3: Implement**

1. Extract the diff rendering (the `result.comparable ? … : … findings …` JSX) from `Compare.tsx` into `components/CompareDiff.tsx` as `<CompareDiff result={CompareOutcome} />`; Compare's artifact mode renders it. No behaviour change; existing tests pin this.
2. Pair mode in `Compare.tsx`: when `referenceRun`/`subjectRun` params are present, subscribe to both runs (two `subscribeToRun` calls, each feeding its own parser + timestamps, exactly like `Run.tsx`). Layout: two stacked panels headed `reference · <profile>` / `candidate · <profile>` (subject is the candidate), each with `RunProgressView`. A `useEffect` on both statuses: when `isTerminalStatus` for both, call `api.compareRuns(referenceRun, subjectRun)` and render `<CompareDiff>` plus side headers (`profile`, `profileFingerprint.slice(0, 12)`, and when `complete === false` a yellow `incomplete evidence — interpret with care` line).
3. While waiting, a dim line `comparison appears when both runs finish`.

- [ ] **Step 4: Run to verify pass** — full app suite + typecheck.

- [ ] **Step 5: Commit**

```bash
git add apps/eval-ops/src/routes/Compare.tsx apps/eval-ops/src/components/CompareDiff.tsx apps/eval-ops/tests/compare.test.tsx
git commit -m "feat(eval-ops): pair page flips from dual progress to automatic diff"
```

---

### Task 10: Version bumps, lockfile, deploy verification

**Files:**
- Modify: `packages/protocol/package.json`, `apps/eval-ops/package.json`, `bun.lock`

- [ ] **Step 1: SemVer bump** both touched packages (minor — new features), regenerate `bun.lock` from the repo root (`bun install`), commit.

- [ ] **Step 2: Full targeted validation**

```bash
cd packages/protocol && bunx tsc --noEmit && bun test eval/ops/tests/
cd ../../apps/eval-ops && bunx tsc --noEmit && bun run test
```

- [ ] **Step 3: Push and watch the deploy**

```bash
git push origin feat/eval-ops-deploy
```

Then verify the deployed service: boot log clean (DDL ran), `GET /api/configs` responds after sign-in, and the launch page shows the overrides section. Record evidence in PR #1318.

- [ ] **Step 4: Commit + push**

```bash
git commit -m "chore: bump protocol and eval-ops versions"
git push origin feat/eval-ops-deploy
```

---

## Self-Review Notes

- Spec coverage: model allowlist (T1), storage + reset survival (T2, T3 boot DDL; flush-list exclusion verified in spec), CRUD routes (T3), ad-hoc launch + fingerprint parity + xor rule (T4), run-vs-run compare + completeness + 422 (T5), UI surfaces (T7/T8/T9), curated dropdown (T1/T7), testing (per-task + T10). A/B toggle + pair page + auto-diff (T7/T9, spec addendum).
- `resolveAdHoc` relies on `resolveProfile` accepting a `default`-named profile with overrides — flagged in Task 1 Step 3 to verify; fallback given.
- PATCH/DELETE routing: Task 3 flags checking the dispatcher; the router currently branches only on GET/POST.
- Type consistency: `Overrides`, `ConfigProfile`, `RunSide`, `RunCompareResult`, `validateConfigOverrides`, `resolveAdHoc`, `ConfigStore` names used consistently across tasks.
