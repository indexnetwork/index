---
name: manage-feature-flags
description: Ship and flip feature flags consistently across the four primary env surfaces in the index monorepo — .env.example, root .env.development, Railway dev service variables, and startup.env.ts — plus .env.test when tests intentionally need a non-default value. Use when adding a new env-gated flag, enabling/disabling one on dev, or diagnosing local/Railway drift. Covers ship-dark→flip order and railway_set_variables gotchas.
---

# Flag rollout consistency

Every feature flag in this repo has **four primary surfaces**, but they are updated at
different stages: registration/docs ship with the code; active values change at flip
time. Missing the applicable surface produces "works on dev but not locally" drift or
undocumented flags. `.env.test` is a conditional fifth surface only when tests must
exercise a non-default value.

## The four surfaces

| Surface | Tracked? | Role | When |
|---|---|---|---|
| `services/api/src/startup.env.ts` | yes (in feature PR) | zod registration, e.g. `z.union([z.literal(''), z.enum(['off','on'])]).optional()` | with the feature code |
| `.env.example` | yes (in feature PR) | commented-out entry + docs, **default off**, in the correct numbered section next to related flags | with the feature code |
| Railway dev (`protocol` service) | no | the live value | at flip time |
| root `.env.development` | no (gitignored) | local mirror of Railway dev so local runs behave like dev | at flip time, same value as Railway |

When affected tests deliberately require the flag on (or another non-default value),
also set/document it in root `.env.test`; otherwise leave it unset so tests cover the
default-off contract.

House style: code reads the flag through a centralized accessor module (e.g. `discriminator.env.ts`, `questioner.env.ts`) — never bare `process.env` at call sites; default is always the "off" behavior.

## Order of operations

1. **Ship dark**: feature PR carries code (default off) + `startup.env.ts` + commented `.env.example` entry. Merge, verify deploy healthy.
2. **Flip Railway** (needs explicit user approval — it's a mutation):
   ```
   railway_set_variables({ service_id: "protocol", environment_id: "dev", variables: { FLAG_NAME: "on" } })
   ```
   Gotchas: parameter names are **snake_case** (`service_id`, not `service`); `variables` is a **map**, not an array of `KEY=value` strings; setting a variable **triggers an automatic redeploy** — wait for the new deployment to reach `SUCCESS` (`railway_list_deployments`) and health-check before claiming the flag is live. Verify with `railway_list_variables`.
3. **Mirror locally**: add/update the same value in root `/Users/yanek/Projects/index/.env.development` (grouped with related flags, one comment line naming the feature/issue). The **root-dev-guard warning on this edit is cosmetic** — the file is gitignored, so it cannot dirty dev. Worktrees see it automatically: `worktree:setup` symlinks the root file.
4. Pre-flip is allowed when the deployed code doesn't read the flag yet: the Railway var sits inert and activates the moment the feature PR's deploy lands (used for `POOL_QUESTIONS_RANKING`). Only do this when activating-on-deploy is the explicit intent — it forfeits the ship-dark observation window.

## Quick audit

Check all surfaces for a flag in one pass:

```bash
grep -n "FLAG_NAME" .env.example .env.development services/api/src/startup.env.ts
# If tests use a non-default value: grep -n "FLAG_NAME" .env.test
# + railway_list_variables({service_id:"protocol", environment_id:"dev"})
```

If a flag exists on Railway but is absent from `.env.development` (or vice versa), that's drift — fix it in the same sitting.

## Pool-questions flag family (reference)

Six related flags, all with accessors in `packages/protocol/src/opportunity/discriminator/discriminator.env.ts` and documented commented-off in `.env.example` section 13: `POOL_QUESTIONS_MINING`, `POOL_QUESTIONS_MODE`, `POOL_QUESTIONS_PUSH`, `POOL_QUESTIONS_RANKING`, `POOL_QUESTIONS_STAMP_NEWBORN`, `POOL_QUESTIONS_VISIT_TRIGGER`. This list is the *names* only — do not record live values here, they rot. Check current values on all applicable surfaces with the Quick audit above (`.env.development`, conditional `.env.test`, and `railway_list_variables`) before reasoning about pool-question behavior.
