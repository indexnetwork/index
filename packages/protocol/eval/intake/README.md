# Answer-first signal intake eval

Live semantic corpus for `SignalIntakeOrchestrator.generateFollowUps`.

The harness checks that a newly stated domain remains authoritative when the user's cached profile brief emphasizes something else. It requires a domain-specific prompt, at least two domain-grounded options, no more than one profile-themed option, and no model-error fallback. One case requires no profile-themed option when no natural bridge exists.

From `packages/protocol`:

```bash
bun run eval:intake                         # 4 cases × 3 runs
bun run eval:intake -- --runs 1             # cheap smoke
bun run eval:intake -- --case unrelated/    # case-prefix filter
bun run eval:intake -- --list-cases          # provider-free corpus listing
```

The package script loads `OPENROUTER_API_KEY` from the repository-root `.env.test`. Each run calls the real configured `signalIntakePack` model twice (answer-only core generation, then optional profile bridge) and, after deterministic checks pass, one independent semantic judge (`SMARTEST_VERIFIER_MODEL`, default `google/gemini-2.5-flash`). The default therefore costs at most 36 model calls (4 cases × 3 runs × core + bridge + judge). It writes no baseline or artifact. Exit `0` means every selected run passed, `1` means measured semantic failure, and `2` means arguments, credentials, or execution failed.

Provider-free scorer, corpus, and runner tests live under `tests/` and run through `bun run eval:verify`.
