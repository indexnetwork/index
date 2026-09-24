# Changelog

All notable changes to the `@indexnetwork/api` service are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this service adheres to [Semantic Versioning](https://semver.org/). Keep this
file updated as part of every release (bump `package.json` and the `[Unreleased]`
section before promoting to `main`).

## [Unreleased]

### Removed
- The `agent:tui` development command and `ApiNegotiationHost`, which ran the
  retired stateful `@indexnetwork/agent` negotiator. The API now depends on the
  stateless agent (formerly `@indexnetwork/agentv2`) under the name
  `@indexnetwork/agent`.

### Changed
- The hosted personal agent groups its initial negotiations into one readable
  summary on the principal conversation instead of displaying the raw negotiation log.
  Direct replies are marked separately from notes and progress updates, with a
  focused retry when a wake omits the reply.
- The hosted personal agent answers an unanswered direct message from its principal
  once per wake, including a bare greeting, instead of treating it as a silent
  signal update. Wakes without an unanswered message retain their silence rules.
- **`POST /intents/prepare`** replaces `/intents/clarify`. Returns `ready` with a
  preparation receipt or `needs_revision` with admission feedback and a dynamic
  recovery form.
- `db:dev:resume --confirm [count]` accepts an optional intent count (default 5)
  and spaces activations 5–10 seconds apart (was 10–30).

### Fixed
- Run development intent reset and resume locally with root `.env.development`
  values instead of orchestrating the Railway dev API.
- Restore API architecture lint by keeping opportunity presentation and preload
  helpers in `lib/opportunity`, outside the service layer. Runtime behavior is
  unchanged.

### Removed
- Removed opportunity outcome-feedback capture, storage, shadow mining, and telemetry.
  Applying the migration that drops `opportunity_outcome_events` permanently deletes
  all recorded feedback history. Opportunity actions, actor stamps, chat creation,
  and negotiation outcomes remain unchanged.
- **BREAKING: the `negotiation.opened` user event is gone.** It was published
  only to `initiatorUserId`, which is always whoever called
  `createOpportunities`, so it reached the seat that had just opened those
  negotiations and started their negotiators in-process a moment earlier — it
  never told anybody anything they did not already know, and never reached the
  counterpart at all. Opening a pair now publishes `negotiation.changed` to
  both seats instead, which is what the web inbox and the A2A negotiation host
  already refresh on. `HostedAgent` no longer routes the frame and its
  `startUnstarted` sweep is deleted with it; consumers that filtered on the
  type must drop it.

### Changed
- **BREAKING: negotiation writes fence on `agentId`.**
  `POST /opportunities/:id/negotiation/turns` and
  `POST /conversations/agent/h2a` take `?agentId=` (`INDEX_AGENT_ID` on the
  client). `executorId` and `INDEX_EXECUTOR_ID` are no longer accepted.
- **A burst of stalls reaches the owner as one wake.** `HostedAgent` woke the
  signal on the first negotiator that stalled, so that wake read the transcript
  while its siblings were still running and asked about whichever missing fact
  it happened to see; the stalls that landed after it were folded into a
  follow-up wake which then had nothing to say, leaving those negotiations
  waiting on a question nobody had asked. A wake now fires once no negotiator of
  that signal is in flight and a stall no wake has read is waiting, so every
  stall of a burst is put to the owner together, and the wake may ask one
  question per missing fact rather than staying silent whenever any question is
  already open. A stall the owner already has stays standing until they answer
  and no longer re-wakes the signal over each turn that lands meanwhile.
- **The hosted seat is a whole personal agent, not just an A2A responder.**
  `HostedNegotiator` is replaced by `HostedAgent`, which runs
  `@indexnetwork/agentv2` — `briefIfMissing`, `wake`, `negotiate` — for every
  owner who has selected no external negotiator. It reaches Index through
  `HostedIndex`, an in-process implementation of the same `Index` protocol an
  external runner reaches over HTTP: the agent package is unchanged and no
  request leaves the process. Frames route the way the reference runner routes
  them — a counterpart's turn and an opening move one opportunity each and never
  wake, while the owner's input, a new signal and a resumed one do. The Redis
  consumer group is still `hosted-negotiator`, so a wake is taken by exactly one
  API process and no offset is lost on deploy. Consequences for owners on the
  hosted seat: it now searches their communities, opens opportunities, and asks
  them questions, where before it only took one A2A turn per wake.
- **`agent.status` no longer decides whether there are questions.**
  `GET /conversations/:id/messages` with `intentId` returns the unanswered
  questions on the signal's transcript for both seats; `status` still names the
  speaker (`hosted` or `external`). It previously hard-coded
  `{ status: 'hosted', questions: [] }`, which was correct only while the hosted
  seat could not speak to its owner.
- **`POST /intents/:id/opportunities` opens up to 30 counterparties per call**,
  where it took the first 10 and silently dropped the rest. An agent that
  searched its communities broadly can now act on what it found in one call
  instead of having two thirds of its picks disappear without saying so. Request
  validation shares that number with the service rather than carrying its own
  copy, which is what left a batch of 30 rejected as invalid after the service
  had already been raised.
- **`POST /intents/:id/discover` returns a top-N, not whatever clears a score.**
  The similarity floor of `0.20` is gone, and the body takes an optional
  `limit` (integer, 1..30, default 10). Retrieval now reads deeper than the
  limit and drops counterparties this signal already shares a negotiation with
  before cutting, so a caller asking for ten gets the ten strongest people it
  can still open rather than three survivors of a cutoff.
- **The H2A inbox is a chat, not the responder seat.**
  `POST /conversations/agent/answers` no longer returns 409 when Index holds the
  negotiator seat. Owner answers are recorded whether or not an external
  negotiator is selected, matching `POST /conversations/:id/messages`, which
  already accepted owner text unconditionally. `agent.status` still reports
  `hosted` or `external`, and the hosted negotiator still publishes no
  questions; it is no longer a write gate. The `message` frame's `metadata` is
  now part of the declared wire shape rather than an incidental passthrough:
  owner surfaces drive the H2A inbox live off `metadata.intentId`.
- **Realtime frames are Redis Streams, not pub/sub.** `events:user:<userId>` is
  a stream (`XADD` with `MAXLEN ~ 1000`) instead of a pub/sub channel, so a
  consumer keeps an offset rather than seeing only what is published while it is
  attached. Frame JSON is unchanged. `GET /events` sends each frame's stream id
  as the SSE `id:` field and accepts `Last-Event-ID` (or `?after=`) to resume
  from it. `?consumer=<agentId>` names one of the caller's own agents and keeps
  that consumer's offset in Redis instead: frames it never acknowledged are
  redelivered after a reconnect, and two connections under one agent compete for
  frames rather than each taking every one. An unknown or unowned `consumer` is
  `404`, and a consumer's first connection starts at the oldest retained frame
  rather than going live. An offset older than the 1000-frame window is gone — the client falls
  back to live frames and reconciles over REST, which is what it already did,
  and notification snapshots stay deleted. The hosted negotiator reads the
  `hosted-negotiator` group across every owner's stream, so a wake is taken by
  exactly one API process instead of every process racing on the same frame.
- **BREAKING: domain tables drop the `protocol_` prefix.** `protocol_intents`,
  `protocol_networks`, `protocol_network_members`, `protocol_intent_networks`,
  `protocol_agents`, `protocol_opportunities`, `protocol_negotiations`,
  `protocol_negotiation_turns`, and `protocol_opportunity_outcome_events`
  rename back to the unprefixed names. Indexes and constraints follow. Existing
  rows are preserved by `ALTER TABLE … RENAME`.
- **Migration history squashed to a single baseline.** The 182 journal entries
  accumulated since February are replaced by one `0000_initial_schema`
  generated from `database.schema.ts`, so `drizzle/` now holds one SQL file and
  one snapshot. Existing databases keep their data: they are baselined by
  replacing `drizzle.__drizzle_migrations` with the single row
  (`hash` `bc5e6550…`, `created_at` `1789588855899`), after which `db:migrate`
  is a no-op. Historical backfills stay applied; they are simply no longer
  replayable, and an empty database now gets the current schema plus `db:seed`.
- **BREAKING: a negotiation is reached through its opportunity.**
  `GET /negotiations/:opportunityId` is now `GET /opportunities/:id/negotiation`
  and `POST /negotiations/:opportunityId/turns` is now
  `POST /opportunities/:id/negotiation/turns`. There is exactly one negotiation
  per opportunity — unique index on `opportunity_id`, both written by the same
  `openCounterparties` transaction — so the old paths named one resource and
  took the other's key. Both nested routes accept a short id prefix, which the
  old ones did not. `GET /negotiations` is unchanged and remains the only view
  that spans opportunities.

### Removed
- **BREAKING: five routes nothing called.** `POST /negotiations/open` (staff
  hand-open; `POST /intents/:id/opportunities` already opens negotiations),
  `GET /networks/:networkId/opportunities` (duplicated
  `GET /opportunities?networkId=`), and `GET /debug/intents/:id` plus
  `GET /debug/chat/:id`. `GET /debug/radar` stays.
- **BREAKING: `POST /intents/:id/visit` and `protocol_intents.last_visited_at`.**
  The endpoint stamped a column no read path consulted any more, so the route,
  the web hook behind it, and the column are gone (the column is simply absent
  from the new baseline; its migration was squashed away).

### Added
- **Discovery is on demand, and the agent judges it.**
  `POST /intents/:id/discover` takes `{ query }`, embeds it as written, and
  returns ranked counterparties from the communities that signal is shared in,
  with each one's statement and owner. It writes nothing, and counterparties the
  signal already has an opportunity with are left out.
  `POST /intents/:id/opportunities` takes the counterparties the caller picked
  and creates one opportunity each, idempotent on the pair. Both are owner-only
  and need an active signal.

### Removed
- **LangGraph PostgresSaver.** The unused `PostgresSaver` checkpointer, its
  boot-time table setup, the hourly `checkpoint-retention` cron, and the
  `checkpoints` / `checkpoint_blobs` / `checkpoint_writes` /
  `checkpoint_migrations` tables are gone. Graph runs were already compiling
  without a checkpointer; conversation continuity stays on `chat_messages`.
- **BREAKING: writing a signal no longer starts a search.** HyDE and lens
  inference are gone with the `@indexnetwork/discovery` package, along with the
  background `IntentDiscovery` runner, the `protocol_hyde_documents` table and
  its maintenance cron, and the orphaned-indexing reconcile command. Signals
  still carry embeddings, so they are still findable; nothing is generated ahead
  of a query, and nothing is cached. An owner who wants matches searches for
  them.
- **BREAKING: the API no longer hosts an in-process personal agent.**
  `PersonalAgentService` and its always-on `NegotiationAgent` sessions are gone.
  In their place, `HostedNegotiator` is the default A2A seat: it wakes on
  `negotiation.turn` and `negotiation.opened`, takes one turn, and stops. It
  never chats. Owner H2A send and `POST /conversations/agent/h2a` work only with
  a selected external negotiator, and agent conversation state is `external` or
  `hosted` (was `unavailable`). The local `agent:tui` lab is unchanged.

### Added
- Railway dev intent replay: `db:dev:resume --confirm` shuffles eligible intents
  and resumes them 10–30 seconds apart.
  `db:dev:reset --confirm` stops the dev API, clears matching and agent state,
  pauses intents, then restores the same deployment. Both commands pin the dev
  database and preserve accounts, credentials, and the intent/network dataset.

### Changed
- Replace the local `db:playground:resume` and `db:clear-negotiations` commands
  with the Railway dev replay commands above.
- **BREAKING: `/api/tools` is deleted; every capability is a named REST
  resource.** `GET /api/tools` and `POST /api/tools/:toolName` are 404, and
  `ToolController`, `ToolService` and `EnricherAdapter` are gone. What only the
  tool layer could do is now routed: `PATCH /intents/:id` rewrites a signal
  through the same intent graph, `GET/POST /intents/:id/networks` and
  `DELETE /intents/:id/networks/:networkId` manage signal↔community links,
  `POST /intents/list` accepts an optional `q` for own-signal text search,
  `GET /networks/:id/intents` browses a community's signals,
  `POST /scrape` reads a web page, and `GET /docs?topic=` serves canonical
  protocol guidance. `GET /networks/:id/members` is open to any current member
  instead of owners only, so it now answers with the member-scoped roster: no
  `intro`, and `email` only on the caller's own row. The member writes stay
  owner-only.
- **BREAKING: `GET /api/conversations/stream` is `GET /api/events`.** No alias.
  Frames are unchanged; the channel was never a conversation resource, so it
  moved to its own `EventsController` and conversation CRUD stayed on
  `/api/conversations`.
- **`POST /intents` with no `networkIds` shares the signal in every network the
  owner belongs to.** Naming networks still shares it in exactly those, and a
  non-membership is still rejected; only the unspecified case changed. It used
  to create an unlinked signal that discovery then skipped fail-closed, so
  `/i/new` — which sends no ids and says "going out to everywhere" — produced
  signals that reached nobody. A transitional default: the picker comes back
  once choosing networks is something people expect to do.
- **BREAKING: one SSE stream per user.** Notifications and conversation messages
  share the Redis channel `events:user:<userId>` and the single endpoint
  `GET /events`; `GET /notifications/stream` is deleted. Frames are
  unchanged — notification frames stay pointer-shaped, messages keep their text
  inline — so consumers discriminate on `type` and ignore the rest.
  The surviving stream also waits for Redis to acknowledge the subscription and
  buffers frames published before the consumer attaches, which the conversation
  stream previously dropped. `lib/notification-stream-events.ts` and
  `lib/conversation-events.ts` merged into `lib/user-events.ts`, and
  `NotificationService` is gone.
- **The realtime frame vocabulary is "user event", not "notification".**
  `NotificationStreamEvent`, `NotificationStreamPublisher` and
  `publishNotificationStreamEvent` are `UserEvent`, `UserEventPublisher` and
  `publishUserEvent`; `notification-delivery.service.ts` and
  `notification-projection.ts` are one `services/opportunity-event.service.ts`
  exporting `OpportunityEventService`. Internal only — every frame's JSON is
  byte-identical, and the words "notification" and "notify" stay where they mean
  an OS toast or a delivery preference (`user_notification_settings`,
  `notifyOnOpportunity`, staff emails, the desktop composers).
- **BREAKING: `GET /notifications/snapshot` is deleted.** Notifications are
  realtime-only: a client that is not connected when an opportunity becomes
  actionable will not be told about it, and reads the opportunity from
  `GET /opportunities` instead. `NotificationController`,
  `NotificationDeliveryService.snapshot` and the adapter's
  `getNotificationSnapshotOpportunities` query are gone, so the
  `/notifications` prefix no longer exists.

### Added
- **An external executor can fence its own turns.** `POST /negotiations/:id/turns`
  accepts an optional `executorId` query parameter, and the write transaction
  refuses the turn unless that agent is still the caller's selected negotiator.
  `GET /agents/me` reports `negotiationExecutorFence: true` so a runtime can tell
  whether the API it is talking to enforces this before it starts submitting.
- **Native clients sign in as devices, not as API keys.** Better Auth's
  `deviceAuthorization` plugin is registered and `/api/auth/device*` is proxied,
  so the Mac app, CLI and Hermes each hold their own session. `/cli-auth` runs
  the whole grant from the owner's browser session — mint, claim, approve — and
  hands the device only a five-minute code, which it redeems at
  `/device/token`. There is no approval prompt: the page approves a code it just
  minted, so no externally supplied code can enter the grant, and the loopback
  callback still binds the handoff to the machine that started it. New
  `device_code` table (migration `0178`).

### Changed
- **`AuthGuard` and the MCP resolver accept a session token as `Bearer`.** A
  three-segment credential is verified as a JWT and anything else as a Better
  Auth session, so device sessions reach product routes and MCP as their owning
  user. MCP still accepts `x-api-key`, but an invalid Bearer never falls back to
  it and query parameters are never MCP credentials. Both session forms record
  `kind: 'session'`, so a device is the owner acting and may use session-only
  routes such as agent management; API keys still cannot.
- **Sessions last 30 days instead of the 7-day default.** Devices cache the
  issued expiry to decide whether to send a request at all, so a short window
  would sign the Mac app out weekly. Revocation is the counterweight: a device
  can sign itself out, and the owner can revoke any device from settings.
- **BREAKING: keys are keys, agents are agents, and Better Auth owns them.** An
  API key authenticates a user and carries no `metadata.agentId`. The
  hand-rolled key stack is deleted — `apikey.adapter.ts`, `apikey.service.ts`,
  `lib/apikey/*` and the `POST/GET/DELETE /auth/keys*` routes — and replaced by
  the `@better-auth/api-key` plugin at `/api/auth/api-key/*`, used by both the
  `/cli-auth` browser handshake and settings. `enableSessionForAPIKeys` is off,
  so create/list/delete need the owner's own session and a leaked key still
  cannot mint a successor. `AuthGuard` and the MCP auth resolver authenticate
  through `auth.api.verifyApiKey`.
- **BREAKING: there is no remote self-revocation.** `POST /auth/keys/revoke-self`
  is gone; the plugin has no equivalent that works without a session. Logging
  out of the CLI, Mac app or Hermes clears the local credential only, and the
  key stays live until it is deleted in web settings.
- **BREAKING: `apikey.reference_id` is the owner column.** Migration `0177`
  backfills it from `user_id`, makes it `NOT NULL` with the cascading foreign
  key to `users`, and drops `user_id`, which the plugin never writes.
- **BREAKING: MCP has no capability policy.** Every authenticated caller reaches
  every tool; `mcpAuthorizationObserver` and the policy arguments to
  `createMcpServer` are gone. `@indexnetwork/protocol` 52.0.0 is required.
- **BREAKING: `GET /agents/me` returns the owner's selected negotiator.** It no
  longer resolves an agent from the calling key, so a user with no negotiator
  selected gets a 404 instead of whichever agent the key happened to name.
  Agent writes (`POST /agents`, `PATCH /agents/:id`, `DELETE /agents/:id`,
  including setting `handleNegotiations`) are session-only.

- **BREAKING: network images are stored under `network-images`, not
  `index-images`.** `POST /api/storage/index-images` and
  `GET /api/storage/index-images/:userId/:filename` are now
  `/api/storage/network-images`, and uploads are keyed
  `network-images/{userId}/{uuid}.{ext}`. This repairs network image upload from
  the web app, which already posted to the new path and was getting a 404.
  Images uploaded before this release keep their `index-images/` keys and no
  longer resolve; there is no migration.
- **BREAKING: opportunity payloads name the community `network`, not `index`.**
  `GET /opportunities` and friends return `network: { id, title }` where they
  returned `index`, and `POST /networks/invitation/:code/accept` returns
  `network` instead of `index`. The debug snapshot key `indexes` is `networks`.
- The host implements the renamed protocol ports (`getOwnedNetworks`,
  `isNetworkOwner`, `updateNetworkSettings`, …) and the renamed intent↔network
  MCP tools; `@indexnetwork/protocol` 49.0.0 is required.
- `networks.key`'s unique index is renamed `indexes_key_unique` →
  `networks_key_unique` (migration `0175`).

### Removed
- **BREAKING: per-agent tokens.** `GET/POST/DELETE /agents/:id/tokens` and the
  `AgentTokenAdapter` are deleted, as is the distinct CLI credential shape
  (`POST /auth/cli-credential`, `POST /auth/cli-credential/revoke`,
  `clicredential.adapter.ts`, `clicredential.service.ts`). Clients holding an
  agent-bound token must log in again for a user key.
- **BREAKING: the `agent_permissions` table.** Migration
  `0176_drop_agent_permissions` drops the table and the `permission_scope`
  enum. `POST /agents/:id/permissions` and
  `DELETE /agents/:id/permissions/:permissionId` are gone, agent creation
  inserts no permission row, and `agent-scope.guard.ts` — which caged API-key
  callers inside one network — is deleted along with the `networkScopeId`
  filtering it fed in the network, intent, opportunity, conversation and
  notification paths.
- **BREAKING: invitation-provisioned agents.** `POST /networks/:id/invite`
  finds or creates the user, joins them as a member, and emails "you've been
  added, sign in." It provisions no agent, mints no key, and returns no
  `agentProvisioned`. `POST /networks/:id/resend-invite`, the key-bearing
  email template, the OpenClaw connect command and the provisioned-cohort
  cascade in `deleteNetwork` are deleted. Join-by-code and member/owner roles
  are unchanged.

### Added
- **`POST /intents/clarify`** — one stateless clarification round. Send
  `{ payload, answers? }`, get back `{ payload, questions }`. Nothing is stored;
  the client decides whether to ask again or create.
- **`POST /intents`** — the one way to create a signal. Takes
  `{ description, networkIds }`, runs the intent graph, and links the signal to
  exactly the networks named, each of which must be a current membership. An
  empty list is allowed: the signal is saved and reaches nobody until it is
  linked.

### Changed
- Signal clarification and creation are rate-limited as `intent_llm` (20/min),
  the class previously named `intake_synthesis`. Both run a model call per
  request, so the generic write budget was far too loose for them.

### Removed
- **BREAKING — drop opportunity owner-approval proofs.** Remove
  `POST /api/opportunities/:id/owner-approvals`, the Redis challenge store, HMAC
  signing, and `OPPORTUNITY_OWNER_APPROVAL_SECRET`. `update_opportunity` is an
  ordinary MCP/tool call. Requires protocol 50.0.0.
- **BREAKING: `/intents/intake/*`, `POST /intents/confirm`, `POST /intents/reject`
  and `POST /intents/proposals/status`.** The guided intake funnel and the
  propose-then-confirm handshake are replaced by clarify-then-create.
  `signal-intake.service.ts`, the pack and run adapters, the proposal adapter and
  the `FAST_SIGNAL_INTAKE` feature flag are deleted with them. Migration `0173`
  drops `signal_intake_packs`, `signal_intake_runs` and `intent_proposals`.
- **BREAKING: automatic network assignment.** A signal no longer gets scored
  against every network the owner belongs to. `assignIntentToNetworks`,
  `reconcileIntentNetworks`, `addNetworkReconcileForUser`, the join-time
  re-evaluation hook and the `maintenance:backfill-intent-networks` script are
  gone. Links come from `networkIds` on create, or `create_intent_index` later.
- **`conversations.persona` and the dead H2A chat-session API.** The column
  labelled which in-process agent loop owned a conversation; every one of those
  loops is gone and the surviving writers (H2H DMs, agent DMs, negotiation
  conversations) all left it at `'none'`. `createChatSession`, `getChatSession`,
  `getUserChatSessions`, `listChatSessionSummaries`, `getChatSessionDetail`,
  `getChatSessionByShareToken`, `createChatMessage`, `getChatSessionMessages`,
  `getChatSessionMetadata` and the rest of that block are deleted, along with
  `ChatPersonaId`, `ChatSession`, `ChatMessage`, `ChatConversationMeta`,
  `ChatMessageMeta`, `CreateSessionInput`, `CreateMessageInput` and the
  `X-Chat-Persona` CORS header. Conversation listings key off participant
  topology. Migration `0171` drops the column.
- **`agents.type = 'personal'`.** The auto-provisioned `{First}'s Negotiator` row
  is gone with `ensureNegotiatorAgent`, `getNegotiatorAgent`, the Better Auth
  sign-in/registration hooks, the invite-path call and
  `uniq_agents_personal_per_owner`. Migration `0172` deletes the rows and
  recreates `agent_type` as `('external','system')`. User-registered agents were
  already `external`.
- **The seed-persona fixtures.** `sandbox-personas.ts`, `db-seed-sandbox.ts`,
  `test-data.ts`, `opportunity-three-user-test.ts`, the `db:seed:sandbox` and
  `test:opportunity-three-user` scripts. `db:seed` now creates only the networks,
  the three admin accounts (the first owns every network) and the system
  negotiator — no tester users, intents, agent API keys or `.seed-api-keys.json`.
  `notify:simulate` without `--counterpart` falls back to any other user.
  **Break:** local `protocol_sandbox` no longer comes with a curated market.
- **The experiment service and master-key signup.** `POST /networks/:id/signup`,
  `/signup/lookup`, `/master-key`, `/rotate-master-key`, `/members/import` and
  `/members/import/parse` are gone, along with `ExperimentService`,
  `MasterKeyGuard`, `lib/experiment/master-key.ts`, the
  `experiment-import-credentials` and `network-master-key-rotated` email
  templates, and the `maintenance:audit-experiment-emails` script. Networks no
  longer project `hasMasterKey`.
- **The Telegram bot.** The gateway, `lib/telegram/bot-api.ts`, the webhooks
  controller (Telegram was its only route), the boot wiring in `main.ts`, the
  `TELEGRAM_BOT_*` and `TELEGRAM_WEBHOOK_*` variables, the Telegram
  notification preference adapters and the notification event are removed. MCP
  authentication no longer reads `x-telegram-handle` / `x-telegram-username` or
  binds a handle to an account. Telegram on a user profile stays as a social
  link.
- **Composio Slack and Gmail.** `integration.controller.ts`,
  `integration.service.ts`, `integration.adapter.ts`, `lib/composio/`, the
  `@composio/core` and `@composio/langchain` dependencies and `COMPOSIO_API_KEY`
  are gone. Google *login* is unaffected: it runs through Better Auth.
- Migration `0162` drops `networks.master_key_hash` and the
  `network_integrations` table.

### Removed
- **Daily frame-drift monitoring.** The 00:15 UTC cron, its service, both
  adapters and `lib/frame-drift.config.ts` are gone, along with the
  `FrameDriftCron` wiring in `main.ts`. The job measured per-network embedding
  centroids and a cross-network opportunity-yield proxy and then only logged
  them; nothing read the rows, and its premise corpus disappeared with
  `premises` in `0160`. Migration `0161` drops
  `frame_drift_observation_runs`, `frame_centroid_snapshots`,
  `cross_network_yield_snapshots` and `frame_drift_execution_attempts`,
  historical snapshots included.
- **Premises, the opportunity delivery ledger, and the activity summary.** The
  premise cascade, events, adapters, and seeds are gone; profile saves no longer
  decompose into premises. `OpportunityDeliveryService` and the
  `/agents/:id/opportunities/{pickup,pending,accepted,delivery-stats}` and
  `/:opportunityId/delivered` routes are removed, as is
  `getAgentActivitySummary`. Migration `0160` drops `premises`,
  `premise_networks`, `opportunity_deliveries`, the `premise_status` type,
  `signal_intake_packs.premise_hash`, and `manage:premises` from live
  `agent_permissions.actions`. `ProjectedScreenDecision` drops
  `counterpartyPremiseFit`; the historical `tasks.metadata.screenDecision` rows
  still project their reasoning, `intentAlignment` and `screenedAt`.
- **The Index Chat Orchestrator system agent and the `orchestrator` chat
  persona.** `SYSTEM_AGENT_IDS` is only the negotiator; onboarding no longer
  grants chat-orchestrator permissions; seed no longer inserts that row.
  Migration `0159` relabels leftover `conversations.persona = 'orchestrator'`
  to `'none'` and deletes agent `00000000-0000-0000-0000-000000000001`.
- **The in-process personal agent and every host path that fed it.**
  `personal-agent.service.ts`, the PersonalAgent reply stream, the intent
  dossier/ledger adapters, `lib/negotiation/negotiation-graph.ts`, the chat
  H2A endpoints (`/chat/stream`, `/chat/web/stream`,
  `/chat/onboarding/stream`), the `ChatGraphFactory` composition, the
  negotiation watchdog, the `matchesReady` wakes, the intent-cycle/timeline
  debug endpoints, the negotiator-memory and negotiation-insights endpoints,
  the connected-agents and agent-runtime controllers/services/adapters, the
  Hermes credential/capability/telemetry helpers, the floor lab, and
  `PERSONAL_AGENT_KICKOFF_CONCURRENCY`. Discovery still records candidates and
  the Radar owner verdict still works; nothing advances a negotiation until an
  external agent is built against the API.

### Changed
- **Delete `src/queues/`.** Nothing in it had been a queue since BullMQ was
  removed; the folder, filenames and class names were the only thing left
  saying otherwise. Each module moved to the layer it actually belongs to:
  - `intent.queue.ts` → `lib/intent/indexing.ts` (`IntentIndexing`, the host
    implementation of the protocol's `IntentFollowUp`).
  - `opportunity/discovery.queue.ts` and its three helpers → `lib/opportunity/`
    (`IntentDiscovery`; `addJob` is now `start`).
  - `premise.queue.ts` → `lib/premise/cascade.ts` (`PremiseCascade`).
  - `negotiations/reflect.queue.ts` → `lib/negotiation/reflect.ts`
    (`NegotiationReflect`).
  - `personal-agent.queue.ts` → `services/personal-agent.service.ts`
    (`PersonalAgentService`).
  - `outcome/outcome.mining.shared.ts` → `lib/opportunity/outcome.mining.ts`;
    `pool/negotiation-evidence.shadow.ts` → `lib/negotiation/`.
  - The five pure `node-cron` sweeps → a new `src/crons/*.cron.ts`:
    `hyde-maintenance`, `frame-drift`, `negotiation-watchdog`,
    `checkpoint-retention`, `opportunity-expiration`.
  `eslint-plugin-boundaries` gains a `crons` element and loses `queues`.

### Removed
- **`notification.queue.ts` and `queueOpportunityNotification`.** No production
  caller: `OpportunityEvents.onActionable` delivers through
  `NotificationDeliveryService.publishOpportunityActionable`. Its removal left
  `background()`'s `retries` option without a call site, so that option and its
  backoff loop are gone too — `background()` now runs `fn` exactly once.
- **The `bull:*` Redis purge in `db:clear-negotiations`.** `clearQueues()` had
  scanned and deleted BullMQ keys that have not existed since the queue system
  was removed.
- **The `log.queue` namespace.** Its callers moved to the existing `log.job`.
  Thin `addCascadeJob`/`addDecomposeProfileJob`/`addReconcileJob`/
  `addOrphanReconciliationJob` wrappers are gone; callers invoke
  `background('<name>', () => handler(data))` directly.

### Renamed log fields
- `FRAME_DRIFT_QUEUE_NAME` → `FRAME_DRIFT_SCHEDULE_NAME` (value unchanged).
- Frame-drift log metadata `queueName` → `scheduleName`. The
  `frame_drift_*` event names are unchanged, and the
  `frame_drift_execution_attempts.queue_name` **column** is unchanged.

### Removed
- Delete the test suite and its harness: all specs under `src/**/tests/` and
  `tests/`, plus `src/preload.test.ts`, `src/lib/testing/`, `bunfig.toml`,
  `scripts/test-safe.sh`, `scripts/test-isolated.sh`, `.test-isolated`,
  `tsconfig.spec.json` and the `test:*`/`typecheck:specs` scripts. The
  now-unreachable `test-database-readiness` exports go with them
  (`readOriginalProcessArgv`, `shouldRequireTestDatabase`,
  `resolveTestDatabasePreloadPolicy` and the isolated-import-harness constant);
  `ensureTestDatabaseReady` and `hasParentTestDatabaseReadiness` still back
  `drizzle.ts`. Runtime behaviour is unchanged.

### Fixed
- Isolate discovery and negotiation by exact intent pair: active negotiations
  between the same users no longer suppress another intent's opportunity or
  task, while exact intent-pair opportunity delivery and per-opportunity task
  creation remain serialized. Each negotiation keeps its own conversation,
  seats, rounds, pause, verdict, and lifecycle state. Final persistence locks
  and revalidates every participant intent as active, non-archived, owned by
  that actor, and assigned to the actor's exact network.
- Give PersonalAgent user-message jobs an enqueue-relative 70-second execution
  deadline inside the controller's 90-second wait, with the same fresh budget
  for background turns. A user-message deadline failure before durable work
  lands is unrecoverable, so BullMQ cannot hide post-timeout work behind a
  retry; a background deadline failure remains retryable so a persisted wake
  cannot be stranded. Once durable work has started, the graph finishes
  through its existing honest terminal response or kickoff compensation path.

### Removed
- **Breaking:** remove the retired `negotiation-run-existing` queue and
  `POST /api/opportunities/:id/reopen`. The old endpoint only enqueued that
  queue's no-op `negotiate_existing` job; reopening requires a future
  PersonalAgent re-kick design rather than a false-success compatibility path.
- **Breaking (API 0.95.0):** remove the Agent reporter feature. `POST
  /api/chat/reporter/session` and the `POST /api/agent/actions/confirm` /
  `GET /api/agent/actions/proposals/:id` endpoints are gone, together with
  `AgentActionController`, `AgentActionService`,
  `AgentActionProposalDatabaseAdapter`, `resolveReporterChatSession`, and the
  `reporter` branch of `resolveStreamPersonaPolicy`. `reporter` is no longer a
  known persona, so any surviving row fails closed with
  `CHAT_PERSONA_UNSUPPORTED` (409) rather than driving a turn. The
  `WEB_AGENT_SURFACE_DISABLED` and `WEB_AGENT_PERSONA_FORBIDDEN` policy codes are
  removed with it.
- **Breaking (API 0.95.0):** drop the `WEB_AGENT_SURFACE_ENABLED`,
  `WEB_AGENT_ACTIONS_ENABLED` and `REPORTER_BRIEFING_TTL_MS` environment
  variables and the `features.agentSurface` / `features.agentActions` fields on
  `GET /api/auth/me`. Remove these three variables from Railway after deploying.
- Migration `0131_remove_agent_reporter` deletes every `persona = 'reporter'`
  conversation (4 rows / 2 messages in production, cascading to messages,
  participants, metadata, timeline sessions, scopes and summaries) and drops the
  empty `agent_action_proposals` table and its
  `agent_action_proposal_status` enum. The actions flag was never enabled
  anywhere, so the table had never held a row.
- **Breaking (API 0.89.0):** MCP no longer gates tools on incomplete
  onboarding. `complete_onboarding` is omitted from the MCP surface; web
  onboarding chat and `POST /api/tools/complete_onboarding` are unchanged.
- Remove the `discovery` / `discovery-env-matrix` / `discovery-quality` eval CLI
  (`src/cli/discovery*.ts` and its specs), the committed env-matrix baselines,
  the 12 `eval:*` scripts and `typecheck:cli-specs`. These
  statically imported `packages/protocol/eval/**`, which was removed in the same
  change. The `eval_matrix_metadata` table, migrations `0115`/`0125` and the
  `evalMatrixMetadata` schema entry are deliberately retained — dropping the
  table is a destructive production migration and is not part of this change.
  Restore by scoping to the eval paths (`src/cli/discovery*`,
  `src/cli/tests/discovery*`, the two discovery fixtures under
  `src/cli/tests/fixtures/`, and `services/api/eval`) — `src/cli/` still holds
  19 live operational tools, so a whole-directory restore would overwrite them.
- Drop the `.env.example` § 15d discovery eval gate (`DISCOVERY_TARGETS`,
  `DISCOVERY_CONFIRM`, `NEON_API_KEY`, and the quality base/replica targets) and
  the matching `NON_API_PATTERNS` exemptions, now that nothing reads them.
- Drop the orphaned `HISTORICAL_QUALITY_APPROVED_EMBEDDING_IDENTITY` constant
  from `src/lib/embedding/embedding.identity.ts`; its only consumer was the
  removed quality CLI. `embeddingConfigurationFingerprint` in the same file is
  still used by `embedder.adapter.ts` and is retained.

### Changed
- Retain `tsconfig.spec.json` as `typecheck:specs`, rescoped from the deleted
  discovery specs to `src/queues/tests/discovery-trigger.builders.spec.ts`. That
  spec is production, not eval: its three `@ts-expect-error` directives are the
  compile-time proof that discovery-trigger callers pass a concrete `networkId`,
  and `tsconfig.json` excludes `src/**/*.spec.ts`, so deleting the config
  outright would have dropped the guard silently.
- Keep `bun test src/cli/tests/` in CI as a dedicated `test`-job step. The
  removed `eval-cli-tests` job also covered three retained non-eval specs
  guarding destructive operational CLIs (33 tests).
- Move the raw-SQL maintenance-write guidance for `src/cli/` into a nested `AGENTS.md`, so it loads whenever those files are open instead of depending on a skill description matching the prompt. No runtime change.

### Fixed
- Stop the IntentAgent reply stage from claiming acts it never executed. Seen
  in dev: a client message that read as an answer was judged `wait` (it did
  not resolve any waiting negotiation), and the reply stage then told the
  client "I've reached out to [counterparty] to get more specific details" —
  nothing was sent. Both `INTENT_AGENT_REPLY_INSTRUCTION` and the rendered
  turn context now say explicitly, when the only executed act on a client
  message was `wait`, that nothing was sent, no one was contacted, and
  whatever the message might have answered still stands unresolved.
- Allow owners to confirm a manually edited Signal proposal by re-verifying the
  edited description and atomically replacing the pending proposal's
  authoritative payload and analysis before confirmation. Network mismatches,
  expired proposals, and concurrent proposal changes still fail closed.
- Budget refinement questions per intent to 2 per rolling 24 hours (`QUESTIONER_INTENT_DAILY_CAP`), counted across the recovery and pool-discovery families combined. Both families re-arm whenever the intent text changes, and answering a refinement question is what changes it — so without a budget each answer bought another question and the loop only ended when the user stopped replying. Chat intake is not counted, and `0` disables background refinement without touching `QUESTIONER_ENABLED`.

### Changed
- Drop the retired `non_web` surface and `WEB_SIGNAL_AGENT_ENABLED` literals from `chat.service.isolated.ts`. The tests passed either way — `"non_web"` fell through to the same branch as `"agent"` — but the strings named a surface that no longer exists, and `tsconfig.json` excludes `src/**/*.isolated.ts`, so nothing would ever have caught the drift.

### Removed
- **Breaking (API 0.88.0):** retire the pre-personafication `orchestrator` chat persona. There is no default chat persona: every H2A turn names one, and unknown values fail closed. `POST /api/chat/message` is deleted (it was orchestrator-only), `ChatSessionService.processMessage()` and `getGraphFactory()` are gone, and the `non_web` stream surface is replaced by `agent`, which requires an explicit persona (`CHAT_PERSONA_REQUIRED` when omitted). `signal` and `reporter` remain web-only, so `negotiator` is the persona an API-key client can start.
- **Breaking:** delete `WEB_SIGNAL_AGENT_ENABLED`. Signal is the permanent web chat persona — with the orchestrator gone, flag-off had no persona to fall back to and left web chat with nothing startable. `features.signalAgent` is removed from `GET /auth/me`; startup warns while the variable is still set.
- Remove Telegram inbound chat. It called the orchestrator graph directly, bypassing the persona policy entirely; inbound messages now reply with a pointer to the app. Outbound notification delivery is unchanged.
- **Breaking (API 0.86.0):** retire the pre-personafication `orchestrator` chat persona. There is no default chat persona: every H2A turn names one, and unknown values fail closed. `POST /api/chat/message` is deleted (it was orchestrator-only), `ChatSessionService.processMessage()` and `getGraphFactory()` are gone, and the `non_web` stream surface is replaced by `agent`, which requires an explicit persona (`CHAT_PERSONA_REQUIRED` when omitted). `signal` and `reporter` remain web-only, so `negotiator` is the persona an API-key client can start.
- **Breaking:** delete `WEB_SIGNAL_AGENT_ENABLED`. Signal is the permanent web chat persona — with the orchestrator gone, flag-off had no persona to fall back to and left web chat with nothing startable. `features.signalAgent` is removed from `GET /auth/me`.
- Remove Telegram inbound chat. It called the orchestrator graph directly, bypassing the persona policy entirely; inbound messages now reply with a pointer to the app. Outbound notification delivery is unchanged.
- Remove the inline discovery-question generator, which had no caller: `QuestionGeneratorService`, the `QuestionGeneratorReader` port, `DiscoveryQuestionInput`, the `discovery` questioner preset, and the `QUESTIONER_DISCOVERY_*` accessors. The `discovery` question *mode* and every read path for existing rows are retained; startup warns when the retired variables are still set.
- **Breaking (API 0.85.0):** remove the Aug-10 dedicated credential layer. The `hermes-authorization` and `index-app-owner-authorization` controllers, services, adapters, PKCE flows, and the `hermes_agent_credentials`, `hermes_authorizations`, `hermes_emergency_receipts`, `index_app_owner_authorizations`, and `index_app_owner_credentials` tables are deleted via forward migration. `idxh_`/`idxo_` credentials stop authenticating; Hermes and the Mac app use ordinary Better Auth API keys.
- **Breaking:** remove the CLI v1 Bearer bridge (`isLegacyCliV1Metadata`) and the v1 `protocolVersion` on `/auth/cli-credential`. `AuthGuard` is now JWT (Bearer/query token) or `x-api-key`, nothing else; released v1 CLI binaries must upgrade.
- Remove the Hermes production-assurance workflow, migration-preflight and emergency-control CLIs, and their isolated database fixtures, which existed solely for the removed credential layer.

### Changed
- Change the `conversations.persona` column default from `'orchestrator'` to the neutral `'none'` (migration `0128`). The column is meaningless for H2H DMs and A2A negotiation conversations, which insert without one; every H2A writer now names its persona explicitly. Existing rows are untouched — orchestrator conversations stay readable and listable, but a new turn returns 409 `WEB_SIGNAL_SESSION_REQUIRED`. The same migration relabels reporter intent-scope rows to `reporter-intent` so they are not orphaned by the now-uniform `<persona>-intent` registry key.
- Point the MCP elicitation message writer and the generic protocol-facing session reader at the Signal persona; both previously read the orchestrator's sessions, which are now read-only history.
- Change the `conversations.persona` column default from `'orchestrator'` to the neutral `'none'` (migration `0128`). The column is meaningless for H2H DMs and A2A negotiation conversations, which insert without one; every H2A writer now names its persona explicitly. Existing rows are untouched — orchestrator conversations stay readable and listable, but a new turn returns 409 `WEB_SIGNAL_SESSION_REQUIRED`. The same migration relabels reporter intent-scope rows to `reporter-intent` so they are not orphaned by the now-uniform `<persona>-intent` registry key.
- Retire the deprecated REST/chat profile and profile-run tool aliases with protocol 12.0.0; direct Tool API callers must use canonical user-context and enrichment-run names.
- Record production evidence for the separately gated `opportunity_discovery_runs` Release 2 cleanup; no destructive migration is included.

### Fixed
- Require TLS for legacy discovery children only after exact Neon target attestation and handoff equality, without changing strict query-free manifests or generic Drizzle behavior (API 0.84.2).
- Refuse legacy discovery runs before target attestation or reset when provider/Redis runtime prerequisites are missing or ambiguous, and report child failures by sanitized code-owned execution stage.

### Added
- Add guarded historical-quality runtime reconciliation (API 0.83.1), including the compatible quality-attestation migration after the dev-owned Hermes migration history.
- Add Hermes backend production assurance (API 0.83.0): a provider-free PostgreSQL 16 release gate now migrates the dedicated disposable `hermes_assurance` database and runs real authority, lifecycle/fault, 100,000-row migration-preflight, aggregate expiry-telemetry, stale/expired Index-coverage, and emergency concurrency/rollback evidence. Release dispatch requires explicit approved lock/total thresholds and the immutable currently deployed API digest; CI exercises emergency control in dry-run mode only and publishes fixed-schema credential-free evidence.
- Add operator rollout and emergency rollback runbooks for server-before-client deployment, dashboard/expiry checks, forward-fix-first response, and the strict pause → bulk revoke → zero-authority verification → older-binary order.
- Secure standalone Hermes and native Index-owner authorization (API 0.82.0): canonical PKCE loopback consent, one-time codes, hash-only `idxh_`/`idxo_` credential persistence, 30-day expiry without refresh, Keychain-confirmed activation, exact revocation receipts, and legacy plaintext-era revocation/fresh-login migration.
- Dedicated full Hermes audience admission for the six canonical actions, explicit REST/MCP allowlists, and the separate four-handler negotiator boundary. Session-only connected-agent list/pause/revoke controls return nonsecret health, fallback, heartbeat, and expiry views; reconnect requires fresh authorization.

### Security
- Admit the Mac app's dedicated native owner credential only to the exact notification stream and snapshot GET routes (API 0.83.2), so credential-free native notification transport works without widening the owner audience's deny-by-default route matrix.
- Add count-only, duration-only migration preflight evidence, privacy-bounded Hermes lifecycle telemetry, immutable previous-image denial, and dry-run-first idempotent emergency control with exact count/plan confirmation. Production reports exclude credentials, credential hashes, database URLs, identity dimensions, private prose, and raw logs.
- Dedicated audiences default-deny account security, credential/permission/agent administration, billing, and unknown routes. Authorization, activation, runtime reconciliation, disconnect, and negotiation mutation use owner locks, exact row/generation identity, idempotent receipts, and compare-and-set behavior.

### Removed
- Repoint MCP contract-test agent ports from the removed internal protocol compatibility interface to the canonical participant-agents port.
- Remove the onboarding privacy-consent layer (protocol 10.0.0, API 0.77.0).
  The `record_onboarding_privacy_consent` MCP/persona tool, the
  `publicProfileLookup` and `edgeosImport` consent decisions, and the
  `OnboardingPrivacyState` / `PrivacyConsentDecision` / `PrivacyConsentSource`
  types are gone from the API schema/types and the Hermes plugin manifest.
  `preview_user_context` and profile provenance seeds no longer require recorded
  consent; leftover `privacy` values in stored onboarding JSON are ignored.
  Like the network-level flow below, opt-in/opt-out moves to a separate
  enrichment service defined per implementation/application. Public profile
  lookup is also removed from the onboarding preview: the `allowPublicLookup`
  and `edgeosProfileText` enrichment-run input fields are dropped (protocol
  10.0.0 removes the tool parameters and `publicLookup` response block).
- Remove the network-level enrichment consent flow and the `profileEnrichment`
  network permission entirely (API 0.76.0). The `consent_required` policy, the
  `forceHeadlessProvisioningPermissions` consent-safe forcing on invites, CSV
  imports, and master-key enablement, and the `auto`/`disabled` setting itself
  are gone; enabling a master key now forces only `joinPolicy: 'invite_only'`.
  Scoped enrichment jobs require current active membership after user/network
  existence checks and before the active-premise short-circuit. Leftover
  `profileEnrichment` values in stored permissions JSON are ignored. Enrichment
  opt-in/opt-out is planned to
  move to a separate service, defined per implementation/application rather
  than per network.

### Added
- Add the Personal Agent Hermes runtime binding (API 0.81.0): owner-control routes prepare, select, roll back, inspect, and disconnect one generation-fenced local Hermes installation without changing the owner's server-owned Personal Agent identity, memory, policy, consultations, or history. The macOS selector can now durably choose Index or Hermes; a selected Hermes executor receives only negotiation authority plus privacy-minimal structural/closed directives (never raw owner context, memory, or private prose), reports health through a negotiation-specific pickup heartbeat, and falls back to Index through the existing bounded park/claim path when stale or stopped.
- Let an exact selected external negotiator consult its owner through the existing `input_required` Questioner lifecycle. The server independently checks the exact owner, principal, claim, attempt, material binding, deadline, and one-consultation policy, accepts exactly the closed `{reason}` request, derives all disclosure and question copy from server-owned templates, and resumes only the settlement-bound successor after answer, dismissal, or expiry.
- Register `OPPORTUNITY_OWNER_APPROVAL_SECRET` as an optional env var so the documented owner-approval secret is schema-validated.
- Wire the MCP authorization-observability seam at the host boundary (IND-581;
  protocol 7.8.0, API 0.64.0). The composition root now injects a concrete
  `McpAuthorizationObserver` into `createMcpServer` that records each capability
  denial as a structured, secret-free authorization audit log (`info` level, not
  debug instrumentation) via the `mcp` server logger — caller profile, tool,
  reason/reach, required permissions, and opaque principal ids only, never
  credentials or payloads. New DB-free `tests/mcp.permission-refresh.spec.ts`
  drives the real resolver + module metadata cache to prove: permissions and
  agent active/inactive state are freshly resolved across reconnects (granted →
  revoked → deactivated), each transition denies the next schema-valid
  list/call before any chat-DB read or scoped-deps creation; two principals
  sharing the module-level metadata cache never leak each other's inventory or
  capability results; emitted denial telemetry contains only safe
  caller-profile/reason fields (no token/secret/argument payload); and a
  throwing observer never changes the fail-closed decision.

- Prove the IND-599 agent-administration split end-to-end at the MCP transport
  (IND-599; protocol 7.7.0, API 0.63.0). New DB-free `tests/mcp.spec.ts`
  evidence: registered agents list/call only `read_own_agent` (empty input
  schema, forged-target argument never queried, own sanitized record only)
  while every human admin tool is capability-denied before any context-DB read
  or scoped-deps creation; session humans retain the full owned-agent admin
  surface but never `read_own_agent`; enrollment-capable keys advertise exactly
  `['register_agent']` across the whole registry and are denied schema-valid
  representative tools of every access class (authenticated/permission/
  informational/delivery_only/human_only) with zero resource work; plain
  unregistered keys fail closed. Owned-versus-foreign handler matrix proves
  each target-bearing mutation (`update`/`delete`/`grant`/`revoke`) persists
  exactly once for an owned target and never for a foreign one (opaque "not
  found"), `list_agents` queries only the caller's own userId, and transport
  `config` secrets never leak from any agent projection. No API runtime source
  change; version moves with the protocol floor (7.7.0).

- Enforce explicit owner-issued approval for agent-driven opportunity `send`/`accept`/
  `reject` transitions and add the session-only issuance route
  `POST /api/opportunities/:id/owner-approvals` (IND-593; protocol 7.6.0, API 0.62.0).
  The host implements the protocol owner-approval port with HMAC-signed, atomically
  single-use proofs whose challenge state lives in a shared injected async store:
  Redis-backed via atomic Lua scripts in production with opaque hashed keys and
  TTL/retention cleanup, fail-closed (`unavailable`, HTTP 503) when Redis is
  unconfigured/unreachable or the signing secret is missing — there is deliberately
  no process-local fallback, preserving the cross-replica single-use guarantee
  (the in-memory adapter is an injected test double only). Issuance is one-shot
  per challenge (409 on repeat), owner-session-only (API-key/agent callers 403),
  bound entirely server-side (caller body binding/provenance fields are ignored),
  and answers unknown, consumed, or route-mismatched interactions opaquely (404,
  no existence oracle) without minting a proof or consuming the one-shot issuance;
  expired challenges return 410. Direct authenticated owner sessions (REST tool
  API and MCP session auth) traverse the same boundary via trusted server-derived
  provenance attestation; chat/CLI/mediated callers fail closed. Optional
  `OPPORTUNITY_OWNER_APPROVAL_SECRET` rotates the proof secret (falls back to
  `BETTER_AUTH_SECRET`). No DB schema, migration, backfill, data action, or
  deployment configuration change ships with this entry.
- Rename the aggregate agent-activity tool to the canonical `read_activity_summary` on every surface and retire `report_agent_activity` with no alias (IND-605; protocol 7.2.0). MCP authorization admits any activity-domain permission and the typed resolved caller context drives one centralized per-domain projection; signal IDs/titles require `manage:intents`; question counts are meta-network yet inherit the permission of each question's affected domain (`getAgentActivitySummary` now groups pending/answered counts by question mode; conversational and unrecognized modes are human-owner-only); and an optional `networkId` narrows a network agent's opportunity/negotiation aggregates to its bound community inside the adapter queries. Counterparty identities, chats, turns, and transcripts are never returned. The Hermes plugin forwards the new tool as `index_read_activity_summary` (plugin 0.12.0).
- Add post-discovery no-opportunity recovery refinement for exact recipient-owned active intents (IND-506). Both authoritative completion paths enqueue a privacy-minimal job on the existing Questioner worker; a focused service suppresses recovery when canonical exact-trigger actionability exists, reduces safely validated rejected negotiations to a bounded aggregate count, validates every user-visible generated string, and persists at most one ordinary intent question per material fingerprint behind a shared recovery/opportunity-create/opportunity-reactivation advisory lock plus migration `0105`'s all-status expression unique index. Exact-trigger reactivation also serializes with task creation on the negotiation-attempt lock, re-reads the opportunity row, and applies the canonical fresh-task predicate immediately before mutation. Answer and material-edit paths use one deadlock-safe lock order, stale recovery answers are rejected again by owner, lifecycle, and fingerprint at the final locked intent write, REST strips every recovery internal, and pool questions retain independent budget/novelty behavior.
- Add exact negotiation-question admission/read/settlement routing (IND-507): API/DB validation proves the authenticated recipient's exact owned ACTIVE fingerprint-equal signal, assignment, live non-personal membership, opportunity actor binding, network, and purpose-compatible task state. Generation/answer/dismiss/timeout share an advisory → complete stable cohort → provenance lock order. A deterministic settlement outbox in exact task metadata plus exact-task run-existing jobs recovers enqueue failure, worker crash, zero generated/persisted rows, and timeout redelivery without latest-task lookup or duplicate continuation. Scoped/unscoped reads and counts reject stale/legacy/unsafe pending rows; exact answered history survives its own continuation transition. MCP/chat/direct answering now reaches the canonical validated boundary with principal/scope clamps. Migration `0106_add_negotiation_question_provenance_index` is the all-status negotiation idempotency constraint after IND-506's recovery migration.
- Add the flag-gated persisted `onboarding` chat persona boundary for `POST /chat/onboarding/stream` (IND-450): incomplete session-authenticated users are authoritatively routed to the restricted factory, follow-ups inherit stored persona, spoof/mismatch/unknown/completed access fails closed, and flag-off preserves legacy orchestrator behavior. Profile approval now stamps a durable phase marker without dropping privacy JSON, and `complete_onboarding({ intentId })` validates that the exact active owned first signal was created no earlier than a valid profile-confirmation timestamp before recording completion.
- Add canonical owner-and-conversation-scoped `GET /api/agent/actions/proposals/:proposalId` hydration for reporter action cards; confirmation uses the same scope, a five-minute execution lease reclaims interrupted attempts, per-action runtime failures are consumed as safe results, and display responses exclude snapshots while including consumed results (IND-493).
- Add dark-gated `POST /api/agent/actions/confirm` owner confirmation for reporter cleanup-action proposals (IND-490 PR1). Proposals are persisted with owner/snapshot state, confirmations are session-only, sequential, replay-safe, and use existing premise/intent lifecycle paths; `WEB_AGENT_ACTIONS_ENABLED` remains off everywhere.
- Add the dark-gated `reporter` persona and owner-scoped `getAgentActivitySummary` adapter read for the PR1 Agent reporting surface (IND-476). The new `read_activity_summary` tool exposes only reproducible counts, never counterparty identity or transcripts; `WEB_AGENT_SURFACE_ENABLED` is registered and surfaced as `features.agentSurface` without changing Railway configuration.
- Add per-viewer conversation read cursors, server-side unread counts, and `POST /conversations/:id/read` (IND-475; migration `0098`).
- Record viewer-safe match provenance on start-chat DMs and expose intent-scoped `via` summaries for chat signal provenance (IND-475).
- Expose a read-side `warming` state for fresh owned intents until a succeeded discovery run is recorded (IND-473). The state uses the 24-hour creation window and discovery-run JSON intent linkage without schema or pipeline changes.

### Security
- Hermes setup is generation-fenced and fail-closed: agent-bound credentials cannot call owner-control routes, stale generations cannot activate or roll back newer setup, only the exact selected principal can pick up/respond/consult, and disconnect revokes installation credentials before local cleanup. **This branch targets dev/private testing only. Production distribution remains blocked until the Mac owner credential is migrated to Keychain and the plaintext file/directory is removed, Developer ID hardened-runtime signing and notarization are complete, and the credential TTL/revocation checklist is verified.**

### Fixed
- Route creation-time and post-discovery intent refinements through one material-fingerprint-deduplicated service, and stop suppressing ordinary intent-page Personal Agent questions merely because discovery already produced an actionable opportunity. Pool and Questioner-generated intent questions now receive symmetric surfacing opportunities while retaining ownership, active-lifecycle, stale-answer, privacy-copy, and one-question-per-material-version gates.
- Add a privacy-minimal batched opportunity lifecycle read for Personal Agent negotiation narration, exposing current status plus whether the authenticated owner is the persisted human acceptor without inferring an H2H conversation (IND-492).
- Removed the pre-assignment create-event discovery race and added transaction-scoped intent-pair advisory dedup, exact-pair atomic rechecks, opportunity-scoped negotiation claims, and explicit evaluator-vs-persistence zero-output telemetry so separate intent matches and negotiations proceed independently without duplicating the same intent pair or opportunity attempt (IND-495; independently corroborated by IND-494).
- Added batched opportunity-actor intent resolution for intent-pinned `list_negotiations` clamping and explicit scope labeling (IND-483).
- Recover negotiation tasks stuck in `submitted` or `working` with the default-off IND-491 watchdog: a five-minute repeatable sweep uses state-aware age thresholds, fresh reads, guarded cancellation/terminal CAS updates, a three-attempt retry budget, and re-enqueues the existing negotiation kickoff without leaving duplicate live tasks.
- Clear `warming` after the first successful from-intent discovery (IND-482) by recording the idempotent `intents.first_discovery_succeeded_at` stamp (migration `0100`, additive). The async MCP discovery-run path continues to use its succeeded-run row.
- Hardened frame-drift scheduler observability (IND-468): startup now reconciles the stable BullMQ job scheduler non-destructively — reading it first, comparing pattern/timezone/name/template-data/attempts/backoff/removal-retention, reusing materially matching schedulers (including overdue `next` values, which previously risked losing the pending iteration to an `upsertJobScheduler` override), upserting only on missing or materially changed definitions, and logging `schedulerAction: created|reused|updated` with the authoritative next timestamp. Every BullMQ attempt is durably tracked in the new privacy-minimized `frame_drift_execution_attempts` table (migration `0097`, unique on `(job_id, attempt)`, no observation-run FK, no vectors/prompts/user-network IDs/raw errors — only an allowlisted failure category), with idempotent start/terminal recording, started-before-flag-before-measurement ordering, redelivery short-circuiting on existing terminal rows, and tracking failures failing the job so measurement never succeeds untracked. Absent attempt rows are unobserved/unknown, not proof BullMQ never enqueued.

### Added
- feat: answered-questions listing (`GET /questions?status=answered`) for the signal workspace Q&A log (IND-472).
- Default-off `WEB_SIGNAL_AGENT_ENABLED` main-web cutover (IND-449): new session-authenticated ordinary web chats explicitly persist `persona=signal`, scoped Signal sessions use persona-distinct registry keys, follow-ups inherit the stored persona, and legacy orchestrator web sessions remain readable but reject new turns with a typed continuation action. Session-authenticated compatibility routes use authenticated provenance and cannot bypass Signal policy; API-key callers retain orchestrator behavior. Compatibility history is orchestrator-only, dedicated web history includes legacy plus Signal sessions, and proposal confirmation returns committed retries before a cheap membership preflight/embedding, then serializes the exact owner/proposal pair in one transaction as the final concurrency authority, returns racing retries to the same intent, and atomically validates current network membership before its single assignment. A project-JWT-authenticated `POST /auth/cli-credential` endpoint now mints only fixed-name, 90-day credentials with immutable `{client:'cli', protocolVersion:1|2}` metadata, a server-only permission marker, and no agent binding, instead of relying on Better Auth's generic create route. Better Auth API-key session promotion is disabled so generic management remains browser-cookie-only, while `POST /auth/cli-credential/revoke` accepts an active CLI `x-api-key` only and deletes an exact same-owner server-issued CLI target after verifying both its row ID and raw-secret hash. Signal's newly allowlisted `create_intent_index` now routes direct, no-prompts, and evaluated writes through one transaction that locks and rechecks the owned unarchived intent, undeleted network, and current accepted membership before preserving the scored assignment metadata. A temporary CLI-v1 Bearer bridge activates only after JWT failure and only for enabled, unexpired keys tagged `{client:'cli', protocolVersion:1}`; it records API-key provenance with no agent binding, never applies to query tokens/default/agent/v2 keys, and leaves ordinary JWTs on the web/Signal surface. Persona spoofing/unknown values fail closed while Telegram, MCP, CLI, and direct-tool orchestrator behavior remains unchanged. Frontend message-metadata writes are session-only; API-key-capable chat, Telegram, MCP, and direct-tool paths are unchanged.
- Lens C evidence segments now carry answeredBy-verified owner answers
  (IND-465 slice 2, wiring the `owner_answer` evidence family the extractor
  already supports). AUTHORITATIVE SOURCE is the questions table only: a new
  `getAnsweredNegotiationQuestionsForOpportunity` questioner-adapter query
  (delegated through `ChatDatabaseAdapter`) returns answers whose
  `answer.answeredBy` equals the segment recipient, restricted to the
  negotiation-family detection modes bound to an opportunityId
  (`negotiation`, `negotiation_inflight`), `detection.sourceType =
  'opportunity'`, `detection.sourceId = opportunityId`, subject-actor
  scoping, and capture-time intent-fingerprint equality when a fingerprint
  is present (absence tolerated — the segment-level task fingerprint guard
  covers intent drift). Every constraint is enforced in SQL AND re-checked
  in the projection; `opportunity.metadata.userAnswers` stays banned as an
  evidence source (no `answeredBy` authority, counterparty-visible, and
  expiry writes synthetic disclosure text). Segments set `ownerAnswers`
  only when non-empty; question text, detection payloads, and other users'
  IDs are never projected, and telemetry stays aggregate-only.
  `shared_message` remains impossible-by-construction (no per-message
  consent primitive; deferred to IND-467).

### Fixed
- Serialized exact-version negotiation-task creation and taskless compensation on shared opportunity advisory/row locks, and added expected-status compare-and-set reactivation, so continuation recovery cannot race a late task insert or overwrite concurrent lifecycle changes (IND-470).
- Normalized blank and null-like opportunity actor intents before uptake lookups and added the idempotent, order-preserving `0096_normalize_opportunity_actor_intents` data migration, which removes malformed `intent` keys while leaving unaffected rows and all other actor data unchanged. The Railway-dev audit scope was 7,690 affected opportunities, requiring explicit release review before rollout (IND-469).
- Restored unscoped asynchronous MCP discovery by wiring discovery-run workers to real network and membership graphs instead of no-op placeholders (IND-466).
- Lens C shadow network binding is now derived from capture-time negotiation
  task metadata instead of `opportunity.context.networkId` (IND-465 slice 1,
  unblocking the IND-433 NO-GO where the context field was empty on all
  evidence-bearing rows). All derivation rules fail closed: only structurally
  valid tasks (capture-time intentSnapshots required) contribute; exactly one
  distinct non-empty task networkId binds an opportunity; zero or disagreeing
  values skip it; a present-but-different context networkId skips it
  (contamination guard — context never overrides tasks). Segment building
  still enforces pass-network equality per task, so sibling tasks recorded
  under another network stay excluded. The Lens-C-local pool selection now
  also includes terminal statuses (`stalled`/`accepted`/`rejected`/`expired`)
  — evidence lives on decided negotiations — via a dedicated
  `exactEvidencePoolWhere` predicate; the shared Lens A live-pool selection
  is untouched. Shadow telemetry gains aggregate-only counters
  (`skippedNoTaskNetwork`, `skippedNetworkDisagreement`,
  `skippedContextMismatch`, `terminalStatusIncluded`) — counts only, never
  IDs or text. No backfill, no creation-flow changes, no new flags;
  `NEGOTIATION_EVIDENCE_QUESTIONS_MODE` semantics unchanged.

### Added
- Aggregate question-funnel telemetry endpoint `GET /debug/questions/funnel` (IND-439 visibility-audit slice): whole-funnel counts grouped by (detection mode, status, expired-past-TTL) with per-group created/expiry date bounds, plus the caller's canonical pending splits. Aggregate-only by construction — the adapter projection carries counts and timestamps only, never question text, payloads, answers, evidence, or other users' IDs. Gated by the existing DebugGuard + AuthGuard wiring.
- Default-off visit-triggered pool mining (`POOL_QUESTIONS_VISIT_TRIGGER`, IND-439 visibility-audit slice): when an intent owner's intent-scoped pending-questions fetch finds no live pending `pool_discovery` question, a debounced BullMQ job (one per caller+intent per 6h via deduplication ids — no new tables) re-mines the intent's pool through the exact shared discovery-completion hook with a new `intent_visit` trigger source. All existing gates apply unchanged (POOL_QUESTIONS_MODE, QUESTIONER_ENABLED, ≥5 pool floor, VoI threshold, ≤1 pool / ≤3 total pending per intent, fingerprint/Jaccard freshness, push budgets); expired rows are never resurrected and the 7-day TTL is untouched. Ships dark — unset/off is a strict no-op.
- Default-off Lens B outcome feedback capture (IND-434): verified explicit human
  owner accept/reject actions are recorded as idempotent, append-only events
  scoped to the recipient's OWN intent, written atomically inside the winning
  owner-action transition (rollback → no event; commit → exactly one). Capture
  is gated on session-authenticated provenance, a presentation-approved cached
  recipient summary, one unique non-introducer counterpart, and an exact or
  unambiguous recipient-owned actor intent. Agent/API-key, ambiguous multiparty,
  and raw-evaluator-only actions never become preferences. The transaction
  share-locks and revalidates the intent revision immediately before insertion;
  shadow mining repeats ownership, lifecycle, fingerprint, and event-integrity
  checks before running and emits redacted, threshold-safe aggregate telemetry
  only. Outcome history is retained across routine intent/opportunity deletion
  (no cascading source foreign keys); only user deletion erases it.
