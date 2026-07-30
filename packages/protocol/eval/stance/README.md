# Negotiator stance eval

Measures whether `NEGOTIATOR_STANCE` (IND-611) actually changes negotiation
outcomes, and in which direction.

From `packages/protocol`:

```bash
bun run eval:stance                      # 3 stances × 8 cases × 3 runs
bun run eval:stance -- --runs 1          # cheap smoke
bun run eval:stance -- --stance skeptic
bun run eval:stance -- --case low/       # one bucket
bun run eval:stance -- --json eval/stance/runs/stance.json   # gitignored
```

Each case is played as a full bilateral v2 negotiation — seats alternating,
initiator first, capped at 6 turns — driving the live `IndexNegotiator` under
each stance in turn. Both seats run under the same stance, because
`NEGOTIATOR_STANCE` is a process-wide environment variable in production.

## What it measures

The corpus is deliberately half **genuinely valuable** matches and half
**plausible but low value** ones: topical adjacency, one-sided extraction, a
stage mismatch, and a satisfied discovery query that hides an unusable fit. An
obviously bad match discriminates nothing — `advocate` already rejects those.

| metric | meaning |
|---|---|
| decline rate (low value) | share of low-value fixtures the stance walks away from — the win |
| decline rate (high value) | share of genuinely good fixtures it walks away from — the cost |
| discrimination | low − high. **The headline.** A stance that declines everything scores zero |
| turn-0 refusals | opening-move refusals, reachable only after the IND-611 graph prerequisite |

## Contract

- **No committed baseline, no pass/fail gate.** The harness exits 0 on a null
  result by design. Its output is a table to report, not a check to satisfy.
- **The corpus is not tunable toward a result.** If the stances do not change
  behaviour, that is the finding. `tests/stance.scorer.spec.ts` pins the
  authoring rules — balanced buckets, a shared discovery query across both
  buckets, comparable prose length, and no stance vocabulary in any text a model
  reads.
- **Provider-free specs** under `tests/` are gated by `bun run eval:verify`,
  which strips provider credentials; they inject a scripted agent and never
  reach a live model.

## Cost

A full default run is roughly `3 stances × 8 cases × 3 runs × 2–6 turns` live
`negotiator` model calls. Use `--runs 1 --case <id>` for a smoke.
