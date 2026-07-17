# Profile Quality Eval Harness

Measures whether the profile generator (`ProfileGenerator.invoke`) produces good
structured profiles against a curated golden set, and — on every case — upholds the
**privacy guarantee**. Standalone and opt-in — NOT part of `bun test`.

## Run

```bash
# from packages/protocol
bun run eval:profile                          # all cases, 3 runs, judge on, diff baseline
bun run eval:profile -- --runs 5              # more runs = less noise
bun run eval:profile -- --rule privacy         # one rule
bun run eval:profile -- --case extraction/     # one case or id prefix
bun run eval:profile -- --tier 1               # one tier
bun run eval:profile -- --list-cases           # print selected cases and exit
bun run eval:profile -- --no-judge             # skip LLM coverage/apply/preserve checks (free)
bun run eval:profile -- --update-baseline --force # replace the committed baseline
bun run eval:profile -- --report [path]        # write a full run report incl. generated profiles
bun run eval:profile -- --html [path]          # write a standalone HTML scorecard
bun run eval:profile -- --rolling-baseline [d] # compare against trailing run average (default 7d)
bun run eval:profile -- --alpha 0.01           # stricter regression significance threshold
bun run eval:profile -- --no-save              # do not auto-save full-corpus run JSON
```

Requires `OPENROUTER_API_KEY` (loaded via `.env.test`). Exits non-zero on a regression
versus `baselines/profile.baseline.json` (one-sided beta-binomial posterior-predictive
test, default α=0.05). Shared machinery lives in [`eval/shared`](../shared).

## Checks

Deterministic: `name` and `location` substring match, `skills` / `interests` minimum
counts, and **`privacy`** — public fields (name, bio, location, narrative.context,
skills, interests) are scanned for email/phone PII via `profile.pii.ts`; any hit fails the
run. Privacy is asserted on every case by default (opt out per-case with `noPII: false`).

Judged (skipped with `--no-judge`): `coverage_skills` / `coverage_interests` (expected
items captured, allowing synonyms), and for update cases `apply` (the requested change
landed) + `preserve` (the rest of the profile is intact). An optional `reasoning` rubric
grades the whole profile.

## Adding a case

Append a `ProfileCase` to `CASES` in `profile.cases.ts`. Set `rule`, `tier` (1 surgical, 2
realistic), the raw `input`, and `expect`. Prefer deterministic expectations; reach for
judged `mustHaveSkills` / `mustApply` / `mustPreserve` / `reasoningCriteria` only when a
code check can't express it. Privacy cases should feed contact identifiers in the input and
rely on the default `privacy` assertion to prove they were redacted. Re-run with
`--update-baseline --force` after an intentional change.

## Layout

- `profile.cases.ts` — the golden corpus.
- `profile.pii.ts` — deterministic email/phone PII detectors (privacy guarantee).
- `profile.types.ts` — harness types (specializes the shared scorecard types).
- `profile.runner.ts` — invokes the generator N times (shared retry loop).
- `profile.scorer.ts` — per-run assertions → `CaseResult`.
- `profile.reporter.ts` — HTML scorecard via the shared shell.
- `profile.selection.ts` — `--rule` / `--case` / `--tier` filtering.
- `profile.eval.ts` — CLI.
- `baselines/profile.baseline.json` — committed baseline (per-run detail stripped).
- `runs/*.json` — gitignored full run reports (rolling-baseline fuel).
- `tests/` — unit tests (no live agents).
