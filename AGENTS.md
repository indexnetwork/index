# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Repository Guidance

- Read the [Development Reference](./docs/guides/development-reference.md) for project commands, architecture, conventions, testing, Git workflow, and operational safety.
- Use `manage-pr` for pull-request review, acceptance, merge, or closeout. Apply the project-specific PR requirements in the Development Reference; do not use a separate PR-finishing skill.
- More deeply nested `AGENTS.md` files, when present, add to or override these instructions for files in their directory tree.

## Testing and PR verification

- This repository overrides generic full-suite branch-finishing guidance: follow the Development Reference’s targeted-validation policy.
- For each change, run affected tests plus applicable build, typecheck, static-inventory, lint, and generated-artifact checks; report exact evidence in the PR.
- Run database-backed tests only when the changed behavior requires them and only after proving `DATABASE_URL` is dedicated and disposable and setting `TEST_DATABASE_SAFE=1`; never bypass the fail-closed guard.

## Pi orchestration

When Superpowers coordinates work through Pi Subagents or RPIV, the top-level parent must load and follow the `using-pi-bridge` skill before dispatching.
Spawned children execute only their assigned task and do not orchestrate.
