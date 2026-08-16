# IND-609 — MCP breaking-change rollout, release & post-deploy verification

Coordinates the MCP permission-model migration (IND-606/607), the exact
question affected-domain enforcement and authorization tests (IND-608), and the
breaking MCP tool removals already merged on `feat/mcp-refactoring`, across the
protocol package, the API deployment, and the generated plugins.

> **Production execution requires a separate, explicit user authorization** and
> MUST follow the `backfill-production-data` workflow (Neon project `Protocol`,
> database `protocol_prod`). Nothing in this document may be run against Neon,
> dev, shared, staging, or production without that authorization. The wave that
> produced this plan ran **no** database mutation, Neon action, or deploy.

## 0. Scope & artifacts

| Concern | Artifact |
| --- | --- |
| Durable permission migration | `services/api/drizzle/0109_migrate_agent_permission_actions.sql` (+ journal `0109`) |
| Backfill runbook (predicate/dry-run/recovery/sweep) | `services/api/drizzle/0109_migrate_agent_permission_actions.md` |
| Transform + static/journal invariants (DB-free) | `services/api/src/lib/drizzle/tests/permission-action-migration.spec.ts` |
| Actual-SQL behavior (TEST_DATABASE_SAFE-gated, skipped locally) | `services/api/src/lib/drizzle/tests/permission-action-migration.integration.spec.ts` |
| Transport `tools/call` authz matrix | `services/api/tests/mcp.spec.ts` |
| Central policy matrix | `packages/protocol/src/mcp/tests/mcp.authorization-policy.spec.ts` |
| Question provenance / exact-domain / clamps | `packages/protocol/src/questions/tests/question.tools.authz.spec.ts` |
| Discovery-run ownership | `packages/protocol/src/opportunities/tests/discovery-run-ownership.spec.ts` |
| Opportunity approval forgery/replay | `packages/protocol/src/opportunities/tests/opportunity.lifecycle.spec.ts` |
| Negotiation participant-only A2A | `packages/protocol/src/negotiations/tests/negotiation.tools.spec.ts` |

## 1. Release & versioning

- **Protocol package.** The public `QUESTION_MODE_TO_DOMAIN.enrichment` value
  changes (`identity` → `premises`) and question authorization is hardened, so
  the next `@indexnetwork/protocol` release is a **minor** bump (≥ 7.3.0) from
  the 7.2.0 floor. `[Unreleased]` in `packages/protocol/CHANGELOG.md` records the
  MCP permission migration, exact question affected-domain inheritance, and the
  mapping correction. The integration owner finalizes the version and the root
  `bun.lock` (not hand-edited here).
- **SemVer floors respected:** `@indexnetwork/protocol` ≥ 7.2.0, Hermes ≥ 0.12.0,
  Claude plugin ≥ 0.2.0. This change set touches only `@indexnetwork/protocol`
  (behavior) plus `services/api` and a minimal `apps/web` label surface.
- **Generated plugin wrappers.** No MCP tool was added or removed by this change
  set (the breaking tool removals landed earlier on `feat/mcp-refactoring`), and
  the canonical registry ↔ matrix parity test still passes
  (`classifies every MCP-surface registry tool in the canonical production
  matrix`). Therefore the generated plugin wrappers remain compatible with the
  final registry; regenerate and diff them at release time to confirm an empty
  diff. Hermes and the Claude plugin need no bump for this change set.

## 2. Mixed-version ordering — preDeploy migration is not the completeness proof

`railway.toml` runs `db:migrate` as `preDeployCommand`, so migration `0109`
executes **before** the new release drains the old replicas. The currently
deployed code (`origin/dev`) still WRITES `manage:profile` / `manage:contacts`
(agent service and network-invitation defaults, participant-agent
`register_agent`). So during the rolling window, old replicas can re-introduce
retired-action rows **after** `0109` has already run.

The coherent mixed-version-safe design:

1. **New code is canonical-only.** Issuers (`AgentService`, `agent.tools`,
   `db-seed`), validation, tool schemas, and the MCP policy emit/accept only the
   canonical action set and reject the retired actions. Legacy names are never
   re-exposed as input or in `tools/list`/docs.
2. **New runtime interprets residual legacy STORED rows** at the
   capability-loading boundary — `projectStoredPermissionActions`
   (`packages/protocol/src/mcp/mcp.authorization-policy.ts`): `manage:profile` →
   `manage:identity` + `manage:premises`; `manage:contacts` → no capability;
   owner/scope matching preserved; unknown actions fail closed. This is temporary
   rolling-data compatibility for stored rows only, **not** a public alias.
3. **`0109` runs at preDeploy** as a first convergence pass, but is **not** the
   completeness proof (old replicas may write new retired rows afterward).
4. **A mandatory post-drain final sweep** (§5) proves `retired_remaining = 0`.

Why no **access loss**: the read-time projection means a residual (or
old-replica-rewritten) `manage:profile` row still grants identity+premises
capabilities during the window; `0109` and the final sweep converge the durable
rows. Why no **over-authorization**: projection/expansion is exactly
profile → identity + premises (never broader), `manage:contacts` → nothing
(removed tools are unregistered and fail closed), scope matching is preserved,
and control rows are untouched.

## 3. Recovery points (before deploy) — see the 0109 runbook §3

Two mandatory artifacts, captured **before** the deploy that runs `0109`; the
migration itself creates **no** table and leaves **no** durable app schema:

- **Neon backup branch** of `protocol_prod` (record `branchId` + timestamp) —
  coarse incident restore via the approved Neon branch restore/reset workflow.
- **Protected offline artifact** exported from the dry-run: exact affected rows
  as `(id, before_actions, after_actions)`, plus row count and a content
  checksum, in secure offline storage owned by the release owner. Fine-grained
  incident restore replays `before_actions` by `id` via a controlled one-off
  `VALUES`-driven `UPDATE` (no table, no cross-branch join).

## 4. Dev verification (before production)

Run the full predicate → control-group → dry-run → execute → idempotent-sweep
sequence from the 0109 runbook on **dev** first, and record exact counts:

1. `affected_rows`, `control_rows`, `total_rows` (runbook §1).
2. Dry-run preview: confirm `after_actions` for every distinct legacy shape
   (runbook §2) equals `migrateAgentPermissionActions`.
3. Execute `0109` (via `drizzle-kit migrate` on the dev deploy).
4. **`tools/list` + representative `tools/call` on dev:** for a migrated agent,
   confirm `tools/list` shows the expected permission-projected inventory and
   representative calls succeed — `read_premises` (now backed by the expanded
   `manage:premises`), a `manage:identity` call, and a previously
   `manage:profile`-only agent regaining identity+premises. Confirm removed tools
   (`add_contact`, `import_gmail_contacts`, `scrape_url`, profile aliases) are
   rejected as unknown.
5. Idempotent sweep: `retired_remaining = 0`, `total_rows` unchanged, and a
   re-run of `0109` reports 0 rows.

## 5. Production execution (separate explicit authorization)

Only after dev sign-off and explicit user authorization, via the
`backfill-production-data` workflow:

1. Take the mandatory Neon backup branch and export + checksum the protected
   offline affected-row artifact (§3) **before** the deploy.
2. Deploy the release train. The preDeploy `db:migrate` applies `0109` as a first
   convergence pass. During the rolling window, old replicas may still write
   retired rows; the new runtime's read-time projection keeps those agents
   correctly authorized (no access loss / over-auth) — runbook §6.
3. **Wait for full drain** — every old replica gone, only canonical-only writers
   remain.
4. **Run the mandatory post-drain final sweep** (runbook §6) via the approved
   backfill workflow, with its own backup/artifact/recovery: inventory retired
   rows, apply the idempotent `0109` transform, and re-inventory until
   `retired_remaining = 0`. This final sweep — not the preDeploy migration —
   proves completeness, independent of any Railway/`drizzle-kit` UPDATE count.
5. Do **not** remove the temporary read-time projection in this release; it is
   gated on the compatibility-removal conditions in §6.

## 6. Post-deploy monitoring, final-sweep gate & compatibility removal

- **Post-drain final sweep is mandatory and is NOT the automatic `db:migrate`.**
  Completeness (`retired_remaining = 0`) is proven only by the separately approved
  post-drain sweep, after every old replica has drained.
- **Backfill counts:** after the final sweep, `retired_remaining = 0`; count of
  rows now holding `manage:identity` + `manage:premises` matches the artifact's
  previously-profile set; `total_rows` unchanged. Re-run the sweep during the
  monitoring window.
- **Legacy-write watch:** track the retired-row inventory across the monitoring
  window; it must stay at 0 (a rise means a still-live old replica — investigate
  drain).
- **Compatibility-removal gate.** Remove the temporary read-time projection
  (`projectStoredPermissionActions`) only in a follow-up release, and only once:
  (1) all old replicas are drained; (2) the final sweep is complete and
  `retired_remaining = 0`; (3) the monitoring window elapsed with no new legacy
  writes. The single cutover deploy does **not** remove compatibility.
- **Auth denials & error rates:** watch MCP `MCP_CAPABILITY_DENIED` rates and
  tool error rates for a spike. An expected, benign uptick is possible for agents
  that previously leaned on removed tools; a sustained spike on core tools
  (`read_premises`, `create_intent`) indicates an under-granted cohort — remediate
  by confirming their `0109` expansion applied (owner/scope preserved).
- **No removed-tool traffic:** confirm no `tools/call` for removed surfaces
  (contacts/Gmail/scrape_url/profile aliases) is being attempted; if a client
  still calls them, it receives an unknown-tool rejection — coordinate a client
  update rather than re-registering the tool.
- **Remediation / rollback:** if a postcondition fails, restore from the offline
  artifact (fine-grained) or the Neon backup branch (coarse), both per §3; the
  migration is idempotent, so re-running after a fix is safe.
- **Cleanup:** after the monitoring window, the release owner deletes the offline
  artifact and expires the Neon backup branch, and confirms
  `to_regclass('public.agent_permissions_recovery_0109') IS NULL` (no durable
  recovery schema was ever created).

## 7. The three chat classes (MCP boundaries)

The authorization matrix keeps the three conversation classes separate on the
MCP surface (covered by IND-608 tests):

- **H2A (human ↔ agent) chat history** is `human_only`: `list_conversations` /
  `get_conversation` are available to the owning session human and denied to any
  agent key, even a permissioned one (mcp.spec.ts: *H2A chat history human-only*).
- **A2A (agent ↔ agent) negotiations** are participant-only: `get_negotiation` /
  `respond_to_negotiation` require `manage:negotiations` and admit only the
  negotiation's source or candidate; a third party is denied and the A2A
  transcript is never read (negotiation.tools.spec.ts: *participant-only A2A
  visibility*). `readAuthorizedNegotiationDetail` projects the counterparty seat.
- **H2H (human ↔ human)** threads are **absent** from the MCP surface: agent
  completion and owner acceptance never imply an H2H connection, and negotiation
  detail carries `directConversationEvidence: 'not_provided'` unless independently
  evidenced (negotiation detail projection asserts no H2H claim).

Question-answer provenance ties an answer to the authenticated caller
(`context.userId` threaded to both lookup and write), rejects foreign/replayed
question ids, fails closed for network-scoped agents, and enforces exact
affected-domain permission per question mode (question.tools.authz.spec.ts).
