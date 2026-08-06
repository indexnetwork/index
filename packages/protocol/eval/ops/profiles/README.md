# Configuration profiles

Each file declares one named configuration the eval ops site can run a harness under.

~~~json
{
  "name": "claude-evaluator",
  "description": "Matching under a Claude evaluator instead of Gemini Flash",
  "models": { "opportunityEvaluator": "anthropic/claude-sonnet-4" },
  "env": {}
}
~~~

- `models` keys are `ModelAgent` keys from `src/shared/agent/model.config.ts`. They are
  applied through `EVAL_MODEL_OVERRIDES`, which is ignored when `NODE_ENV=production`.
- `env` keys must appear in `PROFILE_ENV_ALLOWLIST`, defined in `../ops.allowlist.ts` and
  re-exported by `../ops.profiles.ts`. Adding a key is a deliberate code change, reviewed
  like any other.
- A profile is harness-agnostic, so it may legitimately carry a key the harness it runs
  under never reads. That is **not** refused: the launch reports those keys as recorded
  but not read, naming them (`unreadEnvKeys`, `../ops.envreach.ts`), rather than letting a
  control sit there doing nothing.
- The file name must match `name`. `default` overrides nothing and must stay empty.

Any profile other than `default` makes a run **experimental**: it is forced to
`--no-save` and is never diffed against the committed baseline.
