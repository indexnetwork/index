---
name: run-protocol-evals
description: Run the packages/protocol eval harnesses correctly — the live LLM harnesses (bun run eval:matching/hyde/premise/profile/opportunity/clarification, which need OPENROUTER_API_KEY auto-loaded from root .env.test) versus the provider-free CI gate (bun run eval:verify, which strips credentials and never calls a model). Use when asked to "run the evals", verify eval suites, add a new eval harness, update a baseline, or when eval:verify fails on an unlisted directory or a baseline-coverage spec after adding a corpus case.
---

# Run protocol evals

Two distinct modes live under `packages/protocol/eval/`. Picking the wrong one is the
classic mistake:

| Mode | Command | Credentials | What it proves |
|---|---|---|---|
| **Live harness** | `bun run eval:<name>` | `OPENROUTER_API_KEY` required | Actual LLM agent behavior vs committed baseline |
| **CI gate** | `bun run eval:verify` | none — deliberately stripped | Types + provider-free specs + suite inventory |

When a user says "run the eval", they almost always mean the **live harness** — the
evals exist to test LLMs. Do not strip credentials for live runs.

## Live harness runs

Run from `packages/protocol`. Harnesses: `matching`, `hyde`, `premise`, `profile`,
`opportunity`, `clarification`.

- Package scripts embed `bun --env-file=../../.env.test`, so `OPENROUTER_API_KEY` is
  auto-loaded from the root `.env.test` (also present in root `.env.development`).
  No manual env exporting needed — just don't unset it.
- Defaults: all cases, **3 runs/case**, LLM judge on, diff vs committed baseline,
  exit 1 on statistically significant regression.
- Useful flags (after `--`): `--runs N`, `--case ID`, `--rule R`, `--tier N`,
  `--no-judge`, `--no-save`, `--report [path]`, `--html [path]`.
- Cost control: `--runs 1 --case <id>` for a cheap smoke; full-corpus runs cost real
  tokens. `hyde` is a staged evidence study (90 cases × 4 paired runs + human
  adjudication) — never run it casually.
- Run reports land in gitignored `eval/<name>/runs/`; baselines only change via
  `--update-baseline`.

## Provider-free CI gate

```bash
cd packages/protocol && bun run eval:verify
```

Type-checks every `eval/*/tsconfig.json`, runs every `eval/*/tests/` suite in its own
process (avoids `mock.module` leaks), and enforces the suite inventory. It strips
`OPENROUTER_API_KEY`/`OPENAI_API_KEY` from child processes — a spec that reaches for a
live model fails loudly. CI runs it in the `eval-verify` job of
`.github/workflows/lint.yml`.

## Gotchas learned the hard way

1. **New eval directory ⇒ update the manifest.** `eval/verify.ts` has an explicit
   `SUITES` list; an `eval/<dir>` not listed there fails `eval:verify` (as does a suite
   missing `tsconfig.json` or `tests/`). Adding a harness requires touching the manifest.
2. **New corpus case ⇒ baseline coverage spec breaks.** The provider-free spec
   "committed baseline covers every corpus case" fails if a case is added without a live
   `--update-baseline` run (e.g. `bun run eval:matching -- --runs 7 --update-baseline`).
   If a live run isn't feasible yet, add the id to `BASELINE_PENDING_CASE_IDS` in
   `eval/matching/tests/matching.cases.spec.ts` and remove it at the next refresh —
   stale allowlist entries fail the spec by design.
3. **src renames silently break evals.** Eval entrypoints import live `src/` classes
   (e.g. `EnrichmentGenerator`, formerly `ProfileGenerator` before IND-368); the normal
   protocol build only covers `src/**`, so run `eval:verify` after renaming protocol
   symbols — its per-suite `tsc --noEmit` is what catches the drift.

Canonical docs: `packages/protocol/eval/README.md` (harness table, baseline contract,
"Adding a new harness" checklist).

See also: `verify-production-release` (pre-merge gates), `finish-pr` (CI checks before merge).
