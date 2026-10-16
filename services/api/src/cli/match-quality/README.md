# Historical match-quality evaluator

An exploratory check of discovery, not a gate. Each case is a documented
introduction (for example, two people who later founded something together),
reconstructed from just before it happened: the initiator's anonymous signal and
profile, the later partner as the positive, and synthetic hard negatives (close
in topic but explicitly incompatible with the request) and easy negatives
(unrelated) in a small same-era community. The initiator's agent runs one
ordinary first wake with the live model and writes its own queries; every member
is scored from the same `discover()` results the agent merged. There is no pass
threshold.

| File | Role |
|---|---|
| `match-quality.cases.ts` | The roster: fixtures, human-only sources and rationales, and the frozen fingerprint |
| `match-quality.audit.ts` | Rule audit: chronology, sources, anonymization, hindsight, labels, explicit conflicts |
| `match-quality.target.ts` | Loads `.env.test`; refuses anything but local `index_test` and a local Redis |
| `match-quality.seed.ts` | Replaces the evaluator's rows and admits every signal through `IntentService.create` |
| `match-quality.wake.ts` | Runs `wake()` once per case through `HostedIndex.discover()`, without opening anything, and scores it |
| `match-quality.report.ts` | Markdown report of scores, ranks, misses, variation and failures |
| `match-quality.main.ts` | Entry point: `audit`, `seed`, `run [runs]` |

## Running

Follow `.agents/skills/neon-databases/SKILL.md` first. The evaluator writes only
to local `index_test` (`bun run db:setup:local`), and only rows it owns: users
under `@match-quality.example.invalid` and networks keyed `match-quality-*`.
`.env.test` names a remote Redis, so point `REDIS_URL` at a throwaway local one;
the target guard refuses anything else. If the `.env.test` OpenRouter key is not
valid, export a working `OPENROUTER_API_KEY` in the shell without printing it.

```bash
redis-server --port 6399 --bind 127.0.0.1 --save '' --appendonly no --daemonize yes
cd services/api
export REDIS_URL=redis://127.0.0.1:6399
bun run eval:match-quality audit
bun run eval:match-quality seed      # live model: admission of every signal
bun run eval:match-quality run 3     # live model: 3 wakes per case (at most 5)
redis-cli -p 6399 shutdown nosave
```

`run` reads the built `@indexnetwork/agent`, so build it after changing
`packages/agent`. Reports and admission logs go to the git-ignored
`ignored/match-quality/`; do not commit them.

## Changing the roster

Fixtures are frozen once every signal passes admission. A wording change is
allowed only to pass admission, before freezing, and must stay historically
plausible. Never change a frozen case because of its score. A deliberate roster
change re-runs `seed`, then updates `FROZEN_FINGERPRINT` in a reviewed commit
before any scored run.
