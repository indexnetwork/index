---
name: flag-rollout-consistency
description: Ship and flip feature flags consistently across ALL env surfaces in the index monorepo — .env.example (committed, commented docs), root .env.development (gitignored local mirror of Railway dev), Railway dev service variables (Railway MCP), and startup.env.ts registration. Use when adding a new env-gated feature flag, enabling/disabling a flag on dev, or when a flag behaves differently locally vs on Railway. Covers the ship-dark→flip order, railway_set_variables gotchas (snake_case ids, map-shaped variables, auto-redeploy), and why the root-dev-guard warning on .env.development edits is safe to ignore.
---

# Flag rollout consistency

Every feature flag in this repo lives on **four surfaces**. Shipping or flipping a flag means touching all of them — missing one produces "works on dev but not locally" drift or undocumented flags. This was learned the hard way during the pool-questions rollout (IND-416 P1–P3): the user had to ask twice for `.env.development` / `.env.example` to be kept in sync.

## The four surfaces

| Surface | Tracked? | Role | When |
|---|---|---|---|
| `services/api/src/startup.env.ts` | yes (in feature PR) | zod registration, e.g. `z.union([z.literal(''), z.enum(['off','on'])]).optional()` | with the feature code |
| `.env.example` | yes (in feature PR) | commented-out entry + docs, **default off**, in the correct numbered section next to related flags | with the feature code |
| Railway dev (`protocol` service) | no | the live value | at flip time |
| root `.env.development` | no (gitignored) | local mirror of Railway dev so local runs behave like dev | at flip time, same value as Railway |

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
# + railway_list_variables({service_id:"protocol", environment_id:"dev"})
```

If a flag exists on Railway but is absent from `.env.development` (or vice versa), that's drift — fix it in the same sitting.

## Current pool-questions flag set (reference)

`POOL_QUESTIONS_MINING=shadow`, `POOL_QUESTIONS_MODE=on`, `POOL_QUESTIONS_RANKING=on` on Railway dev + `.env.development`; all three documented commented-off in `.env.example`; accessors in `packages/protocol/src/opportunity/discriminator/discriminator.env.ts`.
