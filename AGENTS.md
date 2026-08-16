# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Repository Guidance

- Read the [Development Reference](./docs/guides/development-reference.md) for project commands, architecture, conventions, testing, Git workflow, and operational safety.
- More deeply nested `AGENTS.md` files, when present, add to or override these instructions for files in their directory tree. They are the preferred home for guidance that applies to specific code — see `services/api/src/cli/AGENTS.md` and `packages/protocol/src/opportunities/AGENTS.md`.
- Skills live in `.claude/skills/`. They are reserved for long, rare, high-stakes procedures: `backfill-production-data`, `verify-production-release`, `open-release-pr`, `run-protocol-evals`, `clean-codebase`. Everything shorter or more frequent belongs in a script, a nested `AGENTS.md`, or `docs/guides/`.

## Testing and PR verification

- This repository overrides generic full-suite branch-finishing guidance: follow the Development Reference’s targeted-validation policy.
- For each change, run affected tests plus applicable build, typecheck, static-inventory, lint, and generated-artifact checks; report exact evidence in the PR.
- Run database-backed tests only when the changed behavior requires them and only after proving `DATABASE_URL` is dedicated and disposable and setting `TEST_DATABASE_SAFE=1`; never bypass the fail-closed guard.
