# Targeted Validation Policy Design

## Purpose

Make the repository-local validation policy explicit when it conflicts with generic branch-finishing guidance: verify the changed surface, rather than requiring an unrelated full monorepo/API suite.

## Decision

Add a `Testing and PR verification` section to the root `AGENTS.md`. It will state that this repository's Development Reference overrides generic full-suite instructions and requires targeted verification for changed surfaces.

## Required evidence

For each change, run the focused tests that exercise the modified behavior plus applicable typecheck/build, static inventory, lint, or generated-artifact validation. Record exact commands and results in the PR.

Database-backed tests are required only when the changed behavior uses the database. They may run only after the operator has proven the configured URL is a dedicated disposable database and explicitly sets `TEST_DATABASE_SAFE=1`. The policy must not weaken the existing fail-closed database guard.

## Scope and non-goals

This changes agent operating guidance only. It does not alter application code, test semantics, the root test command, the generic global finishing skill, or database safety controls.

## Verification

Validate `AGENTS.md` contains the override and links to the Development Reference. Run the targeted Release 1 validation set already applicable to this branch; do not invoke the unconfigured full database suite.
