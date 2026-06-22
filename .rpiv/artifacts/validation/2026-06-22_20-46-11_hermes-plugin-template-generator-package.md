---
template_version: 1
date: 2026-06-22T20:46:11+0300
author: Yanek Yuk
commit: a7077aebc2
branch: feat/hermes-plugin-package
repository: index
topic: "Validation of Hermes plugin template generator package"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-06-22_18-06-59_hermes-plugin-package.md"
tags: [validation, plan, blueprint, hermes, plugin, dashboard, template]
last_updated: 2026-06-22T20:46:11+0300
---

## Validation Report: Hermes plugin template generator package

### Implementation Status

- ✓ Phase 1: Package scaffold and basic plugin preset — Fully implemented.
- ○ Phase 2: Index dashboard preset templates — Not implemented; out of scope for this Phase 1 validation.
- ○ Phase 3: Generator CLI with preset selection — Not implemented; out of scope for this Phase 1 validation.
- ○ Phase 4: Tests and documentation — Not implemented; out of scope for this Phase 1 validation.

Validation was run against worktree `.worktrees/feat-hermes-plugin-package` because the implementation lives there; canonical root `dev` was not modified during validation.

### Automated Verification Results

- ✓ Root workspace includes the Hermes package: `grep -n 'packages/hermes-plugin' package.json` — found workspace entry at `package.json:11`.
- ✓ Package metadata is valid JSON: `bun -e "JSON.parse(await Bun.file('packages/hermes-plugin/package.json').text()); console.log('ok')"` — printed `ok`.
- ✓ Lockfile is refreshed for frozen installs: `bun install && bun install --frozen-lockfile` — both installs completed with no changes.
- ✓ Phase 1 does not declare a dangling CLI before `src/main.ts` exists: `! grep -q '"bin"' packages/hermes-plugin/package.json && ! grep -q 'src/main.ts' packages/hermes-plugin/package.json` — no `bin` or `src/main.ts` references found.
- ✓ Basic template files exist: `test -f packages/hermes-plugin/templates/basic/plugin.yaml && test -f packages/hermes-plugin/templates/basic/__init__.py && test -f packages/hermes-plugin/templates/basic/schemas.py && test -f packages/hermes-plugin/templates/basic/tools.py` — all required files exist.
- ✓ Basic template contains no Index MCP wiring: `! grep -R "mcp_servers\|INDEX_API_KEY\|index-network" packages/hermes-plugin/templates/basic` — no matches.
- ✓ No regressions detected in Phase 1 scope.

### Code Review Findings

#### Matches Plan:

- `package.json:5-11` — root workspaces explicitly include `packages/hermes-plugin`.
- `bun.lock:81-85` and `bun.lock:419` — lockfile contains the new `@indexnetwork/hermes-plugin` workspace package after `bun install`.
- `packages/hermes-plugin/package.json:2-27` — package metadata matches the Phase 1 plan, publishes templates/docs/license only, and does not expose a CLI `bin` before the Phase 3 entrypoint exists.
- `packages/hermes-plugin/LICENSE:1-21` — package-local MIT license is present.
- `packages/hermes-plugin/templates/basic/plugin.yaml:1-6` — basic template includes Hermes plugin manifest placeholders and `hello_world` tool declaration.
- `packages/hermes-plugin/templates/basic/__init__.py:19-28` — plugin defines `register(ctx)`, registers the example tool through `ctx.register_tool()`, and invokes skill registration.
- `packages/hermes-plugin/templates/basic/__init__.py:8-16` — bundled skills are discovered under `skills/` and registered with `ctx.register_skill(child.name, skill_md)`.
- `packages/hermes-plugin/templates/basic/schemas.py:3-16` — LLM-facing `HELLO_WORLD` schema is present.
- `packages/hermes-plugin/templates/basic/tools.py:6-14` — handler accepts `**kwargs` and returns a JSON string.
- `packages/hermes-plugin/templates/basic/skills/example-skill/SKILL.md:1-15` — bundled skill example is neutral and placeholder-renderable.
- `packages/hermes-plugin/README.md:1-13` — initial docs explain scope and explicitly state that MCP, scheduled cron jobs, and default enablement are not included.

#### Deviations from Plan:

None. Implementation is a faithful realization of Phase 1 of the plan.

#### Pattern Conformance:

- ✓ Workspace registration follows the repository's explicit Bun workspace convention.
- ✓ Package metadata follows existing package conventions from `packages/claude-plugin` and `packages/cli` while appropriately using a monorepo `repository.directory` field.
- ✓ Static template publishing through a `files` whitelist is consistent with package publish patterns.
- Minor observation: README wording calls the package a "template generator" and mentions `--enable`, while Phase 1 intentionally contains templates only and no CLI. This is acceptable forward-looking documentation because package metadata exposes no executable and the plan adds the CLI in Phase 3.

### Manual Testing Required:

1. Phase 1 template review:
   - [x] Confirm basic template names are neutral and populate-able.
   - [x] Confirm bundled skills are registered through plugin `ctx.register_skill()` rather than copied into `$HERMES_HOME/skills`.

### Recommendations:

- Ready to commit — Phase 1 implementation is complete and validated.
- Continue with Phase 2 separately when ready; Phases 2-4 remain intentionally unimplemented in this validation run.
