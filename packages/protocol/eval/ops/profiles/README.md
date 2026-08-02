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
- `env` keys must appear in `PROFILE_ENV_ALLOWLIST` in `../ops.profiles.ts`. Adding a key
  is a deliberate code change, reviewed like any other.
- The file name must match `name`. `default` overrides nothing and must stay empty.

Any profile other than `default` makes a run **experimental**: it is forced to
`--no-save` and is never diffed against the committed baseline.
