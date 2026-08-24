# Feature Flags

There are none, and adding one needs a better reason than "this feels risky".

Every behaviour-changing environment variable was deleted in one pass
(`chore/remove-env-feature-gates`). What each environment was running became
what the code does. Configuration narrowed to three kinds of value:

- **Credentials and endpoints** — `DATABASE_URL`, `OPENROUTER_API_KEY`,
  `REDIS_*`, `S3_*`, `API_URL`, `WEB_APP_URL`, and the rest of `.env.example`.
  These differ by environment for reasons that are not product decisions.
- **Two ops levers** — `CHAT_MODEL` / `CHAT_REASONING_EFFORT` choose which
  model answers; `LOG_LEVEL` is the incident lever. Values, not gates.
- **Test opt-ins** — `TEST_DATABASE_SAFE`, `RUN_PAID_INTEGRATION_TESTS`,
  `RUN_REDIS_INTEGRATION_TESTS`, `RUN_LOCAL_API_E2E`.

`services/api/src/startup.env.ts` is the registry, `.env.example` is the
documentation, and a test pins them to each other. If a name is in one it must
be in the other.

## Why the flags went

They were designed to converge: ship dark, flip dev, watch, flip main, delete.
The middle steps happened; the last one never did. The result was three
different products — what CI proved, what dev demoed, and what users got — and
the most thoroughly tested configuration in the repo was the one no environment
had run in months. The default-off contract the suite defended was fiction.

## What to do instead

**Ship it on.** New behaviour ships enabled, for everyone, in every
environment. If that is too frightening to do, the change is not ready — the
fear is information about the change, not a reason for a switch.

**Make it small enough to ship.** A change you can reason about end to end
does not need an escape hatch. One that does not fit in your head will not be
made safe by a boolean.

**Roll back with git.** Reverting a commit and redeploying is the rollback.
It is one action, it is auditable, and unlike a flag it cannot leave the code
in a state nobody has tested.

**Pass it as an argument.** When two callers genuinely need different
behaviour, that is a parameter on the function, injected by the composition
root — not a process-wide switch read at the point of use. The frame-drift
cohort bounds and the opportunity graph's threshold overrides both work this
way: production uses the constant, a test injects something else.

**Shadow it in code, not in config.** A pipeline that mines and measures
without writing is a mode of the pipeline, expressed as a constant beside it
(`NEGOTIATION_EVIDENCE_QUESTIONS_MODE`, `OUTCOME_QUESTIONS_MODE`). Moving to
the next mode is a one-line diff and a deploy.

**If you still need a switch,** it is a product decision and belongs in the
database next to the thing it decides — a per-network setting, a per-user
preference — with a UI and an owner. Not an environment variable nobody
remembers setting.

## See also

- [Railway auth](./railway-auth.md) — headless tokens for the Railway MCP tools.
- [Routing and surfaces](./routing-and-surfaces.md) — route and persona cutovers.
