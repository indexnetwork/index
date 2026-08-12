# Background-only discovery: Release 1 → Release 2 gate

Release 1 removes the public direct-discovery contract but intentionally retains `opportunity_discovery_runs` and its schema. Do **not** run a destructive migration until every item below is recorded and an authorized operator approves Release 2.

## Required evidence

1. Deployed Release 1 commit SHA in dev and production.
2. Zero old API replicas remain serving traffic (verify deployment/instance inventory after rollout). Railway `preDeploy` migration timing does **not** prove replica drain.
3. Direct-tool invocation telemetry for `discover_opportunities`, `get_discovery_run`, and `cancel_discovery_run` is zero for the agreed observation window.
4. Retained-table row count for `opportunity_discovery_runs` is captured in production.
5. A verified production backup/Neon branch identifier is captured before any destructive action.
6. Explicit written authorization names the Release 2 migration, target environment, evidence above, and rollback/restore owner.

Only then may the Release 2 migration plan be reviewed and executed in a separate change.

## Evidence recorded 2026-08-12

- Release 1 is commit `b259674e3aa08d17c9b8fc20dad27e6ed2d15c74`; both `origin/dev` and `origin/main` contain it.
- Railway main reports the `protocol` service healthy with one active deployment. The active deployment is `0193d37b-4c6e-4487-95a3-db90934a4cf5` at commit `c0417c989fcc84ee6bd861b3ef3712dccfc590aa`.
- Railway HTTP logs for that active deployment show no requests to `/api/tools/discover_opportunities`, `/api/tools/get_discovery_run`, or `/api/tools/cancel_discovery_run` from its 2026-08-09 deployment through 2026-08-12. This is a deployment-bounded observation, not yet an agreed long-term telemetry window.
- A read-only query against Railway main's `protocol_prod` database counted **939** retained rows: 934 `succeeded` and 5 `cancelled`; the newest row was created 2026-07-17T19:55:35.390Z. There are no queued or running rows.

## Still required before Release 2

- Complete and record an agreed zero-invocation observation window. A 30-day window from Release 1 begins at 2026-07-30T15:23:41Z and completes at 2026-08-29T15:23:41Z; the deployment-bounded Railway evidence above is only interim evidence.
- Capture and record a verified production backup/Neon branch identifier immediately before the destructive release.
- Obtain explicit written authorization naming the Release 2 migration, production target, evidence, and rollback/restore owner.

No destructive migration is included with this evidence update.
