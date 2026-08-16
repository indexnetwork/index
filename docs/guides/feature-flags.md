# Feature Flags

Every env-gated flag in this repo lives on **four primary surfaces**, updated at two
different stages: registration and docs ship with the code; live values change at flip
time. Missing an applicable surface produces "works on dev but not locally" drift, or an
undocumented flag nobody can find.

## The four surfaces

| Surface | Tracked? | Role | When |
|---|---|---|---|
| `services/api/src/startup.env.ts` | yes (feature PR) | zod registration, e.g. `z.union([z.literal(''), z.enum(['off','on'])]).optional()` | with the feature code |
| `.env.example` | yes (feature PR) | commented-out entry + docs, **default off**, in the correct numbered section beside related flags | with the feature code |
| Railway dev (`protocol` service) | no | the live value | at flip time |
| root `.env.development` | no (gitignored) | local mirror of Railway dev, so local runs behave like dev | at flip time, same value as Railway |

`.env.test` is a **conditional fifth surface**, used only when a test deliberately needs
a non-default value. Otherwise leave the flag unset there so tests cover the default-off
contract.

**House style.** Code reads a flag through a centralized accessor module
(`discriminator.env.ts`, `questioner.env.ts`, …) — never bare `process.env` at a call
site — and the default is always the "off" behavior.

## Order of operations

1. **Ship dark.** The feature PR carries the code (default off), the `startup.env.ts`
   registration, and the commented `.env.example` entry. Merge, then verify the deploy
   is healthy.

2. **Flip Railway.** This is a mutation and needs explicit user approval.

   ```
   railway_set_variables({
     service_id: "protocol",
     environment_id: "dev",
     variables: { FLAG_NAME: "on" }
   })
   ```

   Gotchas: parameter names are **snake_case** (`service_id`, not `service`);
   `variables` is a **map**, not an array of `KEY=value` strings; and setting a variable
   **triggers an automatic redeploy** — wait for the new deployment to reach `SUCCESS`
   (`railway_list_deployments`) and health-check it before claiming the flag is live.
   Confirm with `railway_list_variables`.

3. **Mirror locally.** Add or update the same value in the root `.env.development`,
   grouped with related flags, with one comment line naming the feature or issue.
   Worktrees pick it up automatically — `worktree:setup` symlinks the root file.

4. **Pre-flipping** is allowed when the deployed code does not read the flag yet: the
   Railway variable sits inert and activates the moment the feature PR's deploy lands
   (this is how `POOL_QUESTIONS_RANKING` shipped). Do it only when activating-on-deploy
   is the explicit intent — it forfeits the ship-dark observation window.

## Auditing a flag

```bash
bun run check:flags FLAG_NAME
```

This reports where the flag is registered — `startup.env.ts` for api-side flags, or a
`packages/protocol/src/**/*.env.ts` accessor for protocol-side ones — plus its value on
`.env.example`, `.env.development`, and `.env.test`, and it flags the common drift
patterns. Values that are not flag-shaped are redacted rather than printed, so running it
on a non-flag key like `DATABASE_URL` cannot leak a credential into a log or transcript.

It cannot read Railway — pair it with
`railway_list_variables({ service_id: "protocol", environment_id: "dev" })`.

A flag present on Railway but absent from `.env.development` (or the reverse) is drift.
Fix it in the same sitting.

## The pool-questions flag family

Six related flags, all with accessors in
`packages/protocol/src/opportunities/discriminator/discriminator.env.ts` and documented
commented-off in `.env.example` section 13:

`POOL_QUESTIONS_MINING`, `POOL_QUESTIONS_MODE`, `POOL_QUESTIONS_PUSH`,
`POOL_QUESTIONS_RANKING`, `POOL_QUESTIONS_STAMP_NEWBORN`, `POOL_QUESTIONS_VISIT_TRIGGER`.

This list records the *names* only. Live values rot — check them with `check:flags` plus
`railway_list_variables` before reasoning about pool-question behavior.

## See also

- [Railway auth](./railway-auth.md) — headless tokens for the Railway MCP tools.
- [Routing and surfaces](./routing-and-surfaces.md) — flag-gated route/persona cutovers.
