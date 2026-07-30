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
