# Rebase TODO

Integrate `origin/dev` into `feat/agent-communication` while preserving our
agent's behavior. Local implementation and bounded workflow verification are
complete; publication is approved. Live-provider and interactive checks remain
explicitly unrun below.

Related discussion: https://github.com/indexnetwork/index/discussions/1612

## Reviewed baseline

- Feature branch: `78ad2a676f64e0d4dcb9799cfcddbe014334f9b1`.
- `origin/dev`: `eeab341624fe67b2eeb623abf8f8ed1afc20b5c6`.
- Merge base: `428ffcd359d58758b66c001a40e9f91e9c471b50`.
- 31 feature-only commits, 83 dev-only commits, and 57 conflicting paths in the
  tip-to-tip merge preview. These are not per-commit rebase conflict counts.

Refresh this comparison if the target moves before implementation.

## Agreed boundaries

- Keep `packages/agent` and `packages/agentv2` as separate implementations.
  Consolidating their prompts, briefs, or scheduling policies is not a rebase
  prerequisite.
- **Our agent remains the default hosted agent in `services/api`.** Preserve
  our host wiring instead of switching startup to dev's `HostedAgent`.
- Import agentv2 and its independent runner. Never let two runtimes act for the
  same principal/intent seat concurrently; preserve executor ownership checks.
- Preserve our agent's brief provenance and freshness checks, scoped authority,
  question batches and retirement, activation rules, and durable-record model.
- Preserve our scenario TUI and API-backed agent host.
- Keep our live, explicit-query `packages/discovery`; do not restore HyDE.
- Keep the shared protocol authoritative for both agents. Package separation
  does not isolate them from shared API, database, or protocol changes.
- Do not introduce a runtime-selection framework, compatibility layer, or third
  agent implementation as part of the rebase.
- Do not merge the PR, deploy, or migrate production as part of this work.

## Import decisions

### Take dev's implementation, with normal integration verification

- [x] Add `packages/agentv2` and `packages/client`, including the independent
  runner and necessary workspace/build entries. Their API interoperability
  still needs the shared-boundary work below.
- [x] Take network join approvals and invitation improvements as a complete
  API/UI feature; retain their schema additions when combining schemas.
- [x] Take independent mac Help/SSE fixes, dashboard layout and selectable-text
  fixes, Discover overlay fixes, and dataroom updates. Preserve our behavior
  where UI files overlap.
- [x] Take removal of unused LangGraph checkpoints, their retention cron, and
  startup wiring. These are not our agent's durable records.
- [x] Take unused-route and intent-visit-tracking cleanup with all callers.
- [x] Take generated-file attributes, ignore changes, and Edge City submodule
  removal. Merge workspace/CI changes; do not discard checks for packages we
  still use.

### Adapt shared boundaries rather than replacing our behavior

- [x] **Redis Streams:** adopt dev's event transport and convert our
  `PersonalAgentService` and `ApiNegotiationHost` subscribers. Retain our event
  types/payloads, including `intent.broadcast`, and our activation rules.
  Transport replay must not introduce automatic H2A activations or duplicate
  effects that our runtime did not previously permit.
- [x] **Negotiation routes:** adopt opportunity-based routes and update web,
  mac, CLI, plugin, client, and host callers together. Preserve our session
  identity, history, opportunity status, and context-fenced writes.
- [x] **Conversation contracts:** reconcile shared inbox reads/writes and
  external-executor publication without replacing our hosted question batches,
  retirement records, private briefs, or stale-input rejection.
- [x] **Hermes runtime:** preserve Seref's native think/speaker sessions using
  `NegotiationSpeaker`, current tools and completion/cancellation fences.
  `FilePrincipalRecords` stores durable domain outputs, not model checkpoints.
  `INDEX_EXECUTOR_ID` explicitly binds this device instead of taking over any
  selected external agent.
- [x] **Discovery:** retain `CandidateDiscovery` and the embedding helpers used
  by our API host and TUI. Incorporate compatible dev retrieval/API changes
  without deleting the live package or restoring the old HyDE path.
- [x] **Match readiness:** reconcile the shared `matchReadyIntentWhere()` and
  negotiation-opening checks. Our hosted intents require a standing brief;
  selected external executors have a different eligibility path. Agentv2's
  per-opportunity briefs are not our intent-wide standing briefs.
- [x] **Protocol actions:** preserve responder-only acceptance and make affected
  consumers use authoritative legal actions. Agentv2 now reads the API's action
  list instead of assuming either side can accept after the first turn.
- [x] **Persistence ownership:** move any still-needed responsibilities and
  callers of dev's `agent-session.database.adapter.ts` into the retained
  architecture before removing obsolete storage. Do not lose external inbox
  functionality or allow concurrent hosted writers.
- [x] **Database:** retain dev's squashed baseline, unprefixed table names, and
  network-approval schema. Reapply our standing-brief, question, and negotiation
  session changes against that baseline with explicit data transformations.

## Execution order

### 1. Checkpoint and establish the baseline

- [x] Confirm the current branch/worktree and fetch the intended remote base.
  Use `origin/dev`, not the independently diverged local `dev` branch.
- [x] Record both commit SHAs and the feature branch's remote SHA. The remote
  feature SHA is `78ad2a676f64e0d4dcb9799cfcddbe014334f9b1`.
- [x] Create a recoverable backup ref for our current feature history:
  `chore/agent-communication-pre-rebase`. A complete history bundle was verified
  under the common Git directory's `rebase-safety/` directory.
- [x] Preserve tracked edits and untracked files separately. The plan and both
  untracked hooks were copied into that checkpoint; the hooks remain in place.
- [x] Run focused existing checks: agent typecheck, 26 tests and build;
  discovery/protocol builds; TUI typecheck, lint and build all passed.

### 2. Rebase with explicit preservation rules

- [x] Use the existing task worktree; do not create another follow-up worktree.
- [x] Replay onto the pinned dev commit, resolving by responsibility rather
  than blanket `ours`/`theirs` choices. Completed as `8cdc9cc67`.
- [x] Retain our final agent behavior; do not reinstate superseded intermediate
  implementations merely to make an old commit apply.
- [x] Drop or combine changes only when their intended behavior is already
  present or deliberately superseded; record the disposition.
- [x] Bring across independent dev features, then adapt shared contracts in
  small, reviewable slices: transport, routes/inbox, Hermes, discovery,
  protocol/session behavior, and affected UI/TUI consumers.
- [x] Keep our default hosted ownership. Do not start dev's hosted scheduler
  alongside it. Remove integration code made genuinely unused by this choice.

### 3. Regenerate schema and derived artifacts

- [x] Do not concatenate migration journals or replay our old `0182`–`0187` SQL
  against dev's renamed tables. Use dev's reviewed `0000`–`0002` history as the
  starting point, or its newer equivalent if the target was refreshed.
- [x] Generate fresh migrations for the final schema and preserve relevant
  existing records before dropping obsolete storage. Follow the repository's
  migration naming/journal rules.
- [x] Validate fresh setup and upgrade from the dev schema in a disposable
  sandbox, using `bun run db:migrate`; confirm a subsequent `db:generate`
  reports no schema changes. Do not touch production.
- [x] Rebuild generated plugin artifacts from the selected source instead of
  manually merging bundles.
- [x] Reconcile package versions and changelogs from the final changes, including
  public breaking changes. Sync and verify root lockfile workspace versions.

### 4. Verify behavior and integration

- [x] Verify our agent and both TUI modes retain their brief, question,
  activation, discovery, and negotiation contracts through focused checks and
  adapter probes. TUI/discovery source matches the feature snapshot exactly;
  interactive/live-provider checks remain unrun as noted below.
- [x] Verify agentv2/client and Hermes builds, client tests, native-session
  fixture behavior and shared API adapter contracts; confirm executor-handover
  fences. This is not a live-provider end-to-end certification.
- [x] Check event disconnect/reconnect and retained-event replay without
  treating Redis delivery or acknowledgement as successful agent execution.
- [x] Check principal corrections during model work, stale/duplicate writes,
  question retirement, scope of authority, session reopening, and responder-only
  acceptance. A successful compile is not evidence for these behaviors.
- [x] Run focused package checks first, then API typecheck/build, affected UI
  builds, existing protocol specs and architecture checks, and repository lint
  as warranted. Do not add new tests without approval.
- [x] Run subtree-parity and lockfile-version checks for affected packages.

### 5. Review and publish

- [x] Review the final diff against dev: independent dev improvements retained,
  our agent behavior preserved, shared boundaries reconciled, no accidental
  runtime consolidation or duplicated hosted execution.
- [x] Obtain explicit approval to rewrite the published feature branch and
  update existing draft PR #1595. Approval is bound to the recorded remote SHA.
- [ ] Push with `--force-with-lease` bound to that SHA, never plain force.
- [ ] Open or update the PR into `dev`, summarizing breaking contracts,
  verification, and remaining risks. Do not merge it.

## Reconciliation and verification evidence

Local rebase completed on `feat/agent-communication` at `8cdc9cc67`, directly
above pinned dev `eeab34162`. Existing PR:
https://github.com/indexnetwork/index/pull/1595. The operator approved exact-lease
publication, then requested behavioral verification of both agents according to
their own definitions. Those probes and the resulting fixes are recorded below.
The pre-publication remote feature ref is `78ad2a676`.

Verification scripts and logs are retained outside the source tree under the
common Git directory's `rebase-safety/agent-communication-20260918T095446Z/verification/`.

- Original feature history remains in `chore/agent-communication-pre-rebase`
  and `chore/agent-communication-replay-source`; the replay was squashed to
  `8de4aaa7b` with a verified identical tree before reconciliation.
- Dev's deleted `docs/` planning tree is not restored. The original planning
  files remain in the backup history. Untracked Primitive hooks are preserved.
- The dashboard had no separate source or generation command. Its JavaScript
  is now authored in `dashboard/index.js`; `build:dashboard` and `build:desktop`
  regenerate the published bundles. No generated JavaScript is hand-maintained.
- Hosted Streams readers follow retained entries independently, because a
  competing group could dispatch to an API process that does not own the seat.
  SQL activation receipts and the existing runtime lease prevent duplicate work.
  External SSE consumers retain groups and drain every pending page before `>`.
- Intent-service creation emits its canonical activation after creation and
  assignment; chat creation uses the same canonical identity. The duplicate
  random-ID creation invalidation was removed.
- Current checks: agent typecheck/build and 26 tests; client check and 9 tests;
  agentv2 check; discovery/protocol/API builds; API typecheck; TUI check/build;
  web production build; native Mac ad-hoc build; Hermes runtime typecheck/build,
  dashboard/desktop builds, Python compilation and plugin doctor. Protocol
  architecture checks and 9 provider-free tests pass. Repository lint passes
  with 35 warnings. Subtree parity and lockfile-version checks pass.
- Disposable PostgreSQL fresh migration, dev-baseline upgrade with fixtures,
  repeat migration, and no-change generation passed. No shared database was used.
- A real isolated Redis 8.2.1 probe passed retained delivery, a 205-entry pending
  replay across reconnect, acknowledgement, independent groups, concrete live
  cursor continuity, stable frame identities and stream discovery.
- Real PostgreSQL/Redis adapter probes passed exclusive hosted ownership, exact
  concurrent batches, stale effect/turn rejection, brief invalidation, executor
  handover, idempotent publication, one input pointer per external batch, atomic
  opening/delegation and cancellation rollback, exact opening replay,
  responder-only acceptance, separate human approval, and successor-session history.
- Hermes file-record probes passed canonical-input freshness, complete-batch
  validation, stable publication replay after a lost response, restart and
  failure-safe persistence. The real native `AIAgent` loop passed think/speaker
  session creation, exact tool schemas, fresh context on session reuse, and
  immediate hard stop after completion or an uncertain tool response. Model
  replies came from a loopback fixture, not a live provider or the Index API.
- Live-provider evaluation, interactive TUI sessions and visual browser/device
  checks have not been run; builds and fixture probes do not establish those.
  No repository tests were added during reconciliation.

## Independent-agent workflow follow-up

The two implementations were exercised through their actual orchestration and
shared persistence, not just built. Temporary probes remain outside the source
tree; no repository tests were added.

- `/tmp/index-agent-workflows-check.ts` and its shell harness use disposable
  PostgreSQL/pgvector and Redis, real API controller methods/services, and the
  actual HTTP client and agent loops. Authentication and model replies are
  fixtures; embeddings are fixed vectors, while retrieval runs against SQL.
  Non-loopback HTTP is rejected. This is not a full authenticated API deployment
  or a live-model evaluation.
- V2 passed multi-query explicit discovery and opening before answers/standing
  briefs; isolated per-opportunity briefing; authoritative action projection;
  substantive-fact stalling; brief replacement after principal input; separate
  human approval; independent questions, partial external answers and retirement;
  and executor handover for messages, turns and openings.
- Our actual `NegotiationAgent` passed restoration without a think pass, stable
  creation replay, exact question batches, private A2A context, local pauses
  without H2A wakes, unchanged-event replay, correction-driven invalidation,
  standing-only updates without resumption, and explicit delegation resumption.
- `/tmp/index-agentv2-runner-check.ts` passed independent passive briefings,
  a single wake after a burst of stalls, stable holds on already-read stalls,
  and resumption from principal input and updated briefs.
- `/tmp/index-agentv2-reconnect-check.ts` initially failed on dropped startup
  input, first-signal-only catch-up, lost nonzero owed turns, and missed input
  replay. It also exposed a creation/adoption race. All now pass, including
  live input racing initial history and duplicate input-frame suppression.
  Redis transport is still not runtime authority or an exactly-once guarantee.
- An old v2 executor initially could open new negotiations after handover. The
  client now supplies its existing executor fence to openings; the opening
  transaction, turn transaction and H2A publication share the registry's
  selected-executor check. The negative handover probe now passes.
- V2 startup requires `INDEX_EXECUTOR_ID`, with its setup and distinct behavior
  documented in `packages/agentv2/README.md`. Our hosted default is unchanged.
- Re-ran agent/client existing suites (26 + 9), agentv2 checks, API typecheck/build,
  root lint (0 errors, 35 warnings), lockfile/subtree parity, and the existing
  real SQL/Redis authority/session probe. TUI/discovery source still exactly
  matches the preserved feature snapshot.

## Deferred discussion

Whether the two agents should eventually converge on brief contents, visibility,
question policy, discovery breadth, or stall-triggered wakes remains a separate
product decision. This rebase should not silently decide those questions.
