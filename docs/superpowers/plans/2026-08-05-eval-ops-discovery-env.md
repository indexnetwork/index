# Plan — Discovery, and env configuration for every harness

Spec: `docs/superpowers/specs/2026-08-05-eval-ops-discovery-env-design.md`
Branch: `feat/eval-ops-discovery-env`

Tests are **vitest** for the app (`cd apps/eval-ops && bun run test`), `bun test`
for protocol ops and api CLI. `bunx tsc --noEmit` in `packages/protocol` does not
cover `eval/ops` — `bun run eval:verify` is the guard there.

Task order matters: the rename lands first so no later task edits a file under
its old name, and the catalogue lands before the metadata that must cover it.

---

## Task 1 — Rename `discovery-ab` → `discovery`

Mechanical and wide. Nothing else in this plan may start until it lands.

1. `services/api/src/cli/discovery-ab.*.ts` → `discovery.*.ts` (7 files), and
   their 9 spec files.
2. `OpsHarness` member, `OPS_HARNESSES`, registry key and `script`
   (`eval:discovery-ab` → `eval:discovery`), package.json script in
   `services/api`.
3. Operational env: `DISCOVERY_AB_TARGETS` → `DISCOVERY_TARGETS`,
   `DISCOVERY_AB_CONFIRM` → `DISCOVERY_CONFIRM`. Also the internal
   `DISCOVERY_AB_ENV_KEYS` pin and `AB_BRANCH_NAMES` prefix if it embeds the
   name.
4. UI copy, `ops.metadata.ts` harness blurb, docs, `.env.example`.
5. Identifiers whose meaning is the pair — `abSideIssues`, `SIDES_PER_RUN`,
   `AbComparison` — keep "ab"/"side" where they genuinely mean the two sides.
   Rename only what names the *harness*.

**Verify:** `rg -i "discovery[-_]ab|discoveryAb"` returns only intentional
matches (the branch names on Neon, which are data, are handled in Task 8).
All suites green. `eval:verify` green.

---

## Task 2 — Derived per-harness env catalogue

1. Move `reachableEnvKeys` somewhere both `services/api` and
   `packages/protocol/eval/ops` can use, or duplicate deliberately with a test
   pinning them equal. It must not enter the browser bundle — it uses
   `Bun.Transpiler` and `node:fs`.
2. `ENV_SECRET_KEYS` (`OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`), exported.
3. Generator script producing `ops.envcatalog.ts`:
   `HARNESS_ENV_KEYS: Readonly<Record<OpsHarness, readonly string[]>>`,
   dependency-free, sorted, secrets excluded. Committed.
4. Entry points: the four `eval/<h>/<h>.eval.ts`, and for `discovery` the
   opportunity graph.
5. Spec test: regenerate, compare to the committed file, fail on drift. Prove it
   bites by mutating the committed file.
6. Spec test: `HARNESS_ENV_KEYS ∩ ENV_SECRET_KEYS === ∅` for every harness.

**Expected:** discovery 26, each scorecard 8. Assert the exact sets — a count
alone would pass if two keys swapped.

---

## Task 3 — Metadata for every offered key (3 parallel workers)

Split by family; each worker reads the **read site** for each of its keys and
writes `label`, `description` (naming the file), `kind`, `values`, `min`,
`defaultDescription`.

- **3a** `NEGOTIATION_*`: ask-user pair, consultation policy mode, deadlock
  pair, protocol version, screen mode, evidence questions mode.
- **3b** `NEGOTIATOR_STANCE`, `NEGOTIATOR_TURN_TIMEOUT_MS`,
  `HYDE_FRAME_CONSTRAINTS_ENABLED`, plus any remaining `DISCOVERY_*`.
- **3c** Model/provider set: `CHAT_MODEL`, `CHAT_REASONING_EFFORT`,
  `EVAL_MODEL_OVERRIDES`, `SMARTEST_VERIFIER_MODEL`,
  `OPENROUTER_FALLBACK_MODEL`, `OPENROUTER_MAX_RETRIES`,
  `OPENROUTER_REQUEST_TIMEOUT_MS`, `OPENROUTER_RUNNABLE_MAX_ATTEMPTS`.

Then, in one place: spec test that **every** key in `HARNESS_ENV_KEYS` has
metadata, and that no metadata entry describes a key no harness reads. Prove it
bites both ways.

`CHAT_MODEL` and `EVAL_MODEL_OVERRIDES` overlap the existing model pickers —
document precedence at the read site and pin it with a test rather than
guessing.

---

## Task 4 — Engine: a single-sided discovery run

1. `--env KEY=VALUE`, repeatable. Exactly one of `--env` or `--a`+`--b`.
2. One target branch, one reset, one child, one scorecard artifact.
3. Exit-4 message names what actually happened (one branch, one child).
4. Refusals: `--env` with `--a`/`--b`; `--env` with an unknown or secret key;
   the existing value validation.
5. Round-trip test: argv → parse → plan for both shapes.

---

## Task 5 — Server and schema: env for every harness

1. Launch schema accepts `overrides.env` for every harness (it already does);
   validate each key against **that harness's** catalogue, not the union.
2. Refuse secrets explicitly, with the key named.
3. Discovery with `sides` → two-sided argv; discovery without → `--env`.
4. Recorded-but-not-read: when a named config carries keys the harness does not
   read, return them so the UI can list them. Not an error.
5. Single-slot exclusivity still applies to discovery in both shapes.

---

## Task 6 — Launch UI

1. Env editor for every harness, driven by `HARNESS_ENV_KEYS[harness]`.
2. A/B off → one editor; on → two, keys symmetric.
3. Themed listbox replacing the native select, showing each flag's description.
4. One `add flag` control, not one per column.
5. `reference` / `candidate` labels for discovery too.
6. Descriptions wrap.
7. Harness switch resets env, as it already resets models.

---

## Task 7 — Run view

1. Single discovery run renders as a scorecard with its env configuration shown.
2. Comparison unchanged.
3. Scorecard harnesses show their env configuration when non-empty.

---

## Task 8 — Ship

1. Versions: protocol minor, api minor, eval-ops minor. Hand-edit `bun.lock`.
2. Docs: ops README, development reference, `.env.example`.
3. Railway: set `DISCOVERY_TARGETS` / `DISCOVERY_CONFIRM`, remove the
   `DISCOVERY_AB_*` pair.
4. Full gates, PR, review, merge, deploy.
5. Live: a single discovery run and a comparison, both from the site.
