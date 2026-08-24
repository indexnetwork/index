# Changelog

All notable changes to `@indexnetwork/protocol` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).
See [STABILITY.md](./STABILITY.md) for the public-contract and tier definitions.

> History before `2.0.0` was reconstructed from git and is summarized rather than
> itemized. From `2.0.0` onward, keep this file updated as part of every release
> (bump `package.json` and the `[Unreleased]` section before promoting to `main`).

## Release model

Every push to `dev` publishes `<package.json version>-rc.<run>.<attempt>` under
the npm `rc` tag; `latest` moves only when `main` is promoted, and only if that
exact version is not already on npm. **Stable releases are therefore sparse and
skip versions on purpose** — most versions only ever exist as an `rc`. `latest`
went 6.7.1 → 8.0.2 with no 7.x in between because the whole 7.x line shipped as
prereleases between the two promotions. To track every change, read `rc`; to
pin a supported release, use `latest`.

## 32.0.0 - 2026-08-24

### Breaking

- **`NegotiationGraph` refuses to open an opportunity whose introducers have
  not all approved it.** The gate now lives on the write, not only where
  discovery decides which signals to wake, so no caller can reach past it.
- **New negotiation pause reason `open_failed`.** `NEGOTIATION_PAUSE_REASONS`
  gains it, and `{ negotiationId, pause }` now accepts
  `NegotiationSystemPauseReason` (`'counterparty_silent' | 'open_failed'`)
  rather than the single literal. A kickoff whose open failed after `init`
  created the task compensates it into this pause, so the round's active count
  can still reach zero. Unlike `turn_cap` it stays re-kickable.
- **A negotiation binds a signal PER SEAT.** `NegotiationTaskMetadata.intentId`
  and `.round` are replaced by `seats: Record<string, NegotiationSeatBinding>`
  keyed by intent id (`{ userId, round }`), and `setNegotiationRound` becomes
  `bindNegotiationSeat(taskId, intentId, binding)`. Both sides' IS-A can now
  see and terminate a negotiation, which the loop's
  `ready_for_verdict(reject)` rule requires. The resume input gains a required
  `byUserId`, and the negotiator-scope `intentId` is optional (a seat that has
  not kicked off has no binding). New export: `NegotiationSeatBinding`.
- **A negotiation's brief is now PER SEAT.** `NegotiationTaskRow.brief: string`
  becomes `briefs: Record<string, string>` keyed by the seat's userId,
  `createNegotiationTask` takes `briefs`, and `setNegotiationBrief` takes the
  seat's `userId`. A seat with no brief has its own agent author one at its
  first turn (`PersonalAgentJudgment.seatBrief`), and `get_negotiation` returns
  the caller's own brief only. The `brief` on the graph's open/resume inputs is
  the INITIATING seat's, never the counterparty's.
- **`NegotiationGraphDatabase` gains `getPausedNegotiationTasksForIntent`** —
  the signal-scoped read of every paused, unresolved negotiation. Reflect
  reasons over that, not over one round: a negotiation a later kickoff left
  behind keeps its old round, and a round-scoped read hid it from every future
  verdict.
- **`NegotiationGraphDatabase.getIntentNegotiationRound` returns
  `kickoffStartedAt`** alongside `round` and `roundSize`, and
  `bumpIntentNegotiationRound` must stamp it in the same write. A marker set
  with a null size is the one signature of a kickoff that died mid-round;
  inferring that from the null size alone matched every intent that predates
  round stamping.
- **`ToolDeps`/`McpToolDeps` gain `matchesReady`**, which every host must set:
  the OpportunityGraph `tool.factory` builds ends its matches_ready edge at
  `END` without it, so a chat- or MCP-run discovery persists matches nobody is
  woken for.
- **`PersonalAgentDeps` gains `wakeForMatches`** — the agent wakes its own
  signal again for a discovery batch that landed after the turn read its match
  list.

- **AgentGraph: one PersonalAgent, routed on the shape of its input.** New
  `PersonalAgentGraphFactory` — `{ userId }` is global (a graph-level input
  error, deferred), `{ userId, intentId, event: 'user_message' | 'matches_ready'
  | 'all_paused' }` is the intent scope (IS-A), `{ userId, intentId,
  negotiationId }` is one negotiator turn. `matches_ready` and `all_paused`
  are ONE node — look at the state, maybe ask, else act — differing only in
  what ACT does. IS-A's verbs are `message_user`, `ask`, `kickoff`, `promote`,
  `reject`, `note_dossier`, `retire_dossier`, `accept_opportunity`; there is
  no `wait`. Asking BLOCKS acting: a turn that asks executes no verdicts and
  starts no negotiations. The host implements the ports (signal DM, dossier,
  act ledger, reply transport, the owner's accept path, matches list).
- **The interim `NegotiationAuthor` is deleted.** `NegotiationGraphDeps.author`
  is now a required `NegotiationTurnAuthor` port taking ids only
  (`{ negotiationId, userId, intentId }`); production binds it to the
  PersonalAgent in negotiation scope, which reads the brief and thread itself.
  Removed exports: `NegotiationAuthor`, `NegotiationAuthorInput`.
- **Discovery no longer opens negotiations.** The opportunity graph's
  `negotiate` node is replaced by a `matches_ready` node that emits ONE event
  per signal per persisted batch through the new `MatchesReadyFn` host
  callback; the signal's PersonalAgent decides whether to reach out at all.
  `OpportunityGraphFactory`'s sixth constructor argument changes from
  `negotiationGraph` to `matchesReady`, and `ToolFactory`/`ToolDeps` gain
  `matchesReady`. The tool factory no longer builds a second, reflect-less
  negotiation graph: without the host's own composition there is no
  negotiation graph in that context at all.
- **The all-paused → reflect trigger is gated on a round-size stamp.**
  `NegotiationRoundReflectJobData` gains `userId` (the signal's owner, so the
  consumer can invoke the PersonalAgent). `NegotiationGraphDatabase` gains
  `getNegotiationTasksForIntentRound`, `getIntentNegotiationRound` and
  `stampIntentNegotiationRoundSize`, and `bumpIntentNegotiationRound` must now
  CLEAR the size stamp. Until kickoff stamps the size — after every parallel
  open has settled — the check is a no-op, so an early first pause can no
  longer dedupe away the round's genuine reflect. New export:
  `maybeEnqueueRoundReflect`.

### Added

- `isSafeAgentMessageProse`, the identifier-leak gate every piece of
  agent-authored prose passes before it is persisted or streamed.
- `chunkReplyText` and `PERSONAL_AGENT_REPLY_FALLBACK`, moved from the host
  with the reply stage.

## 31.0.0 - 2026-08-24

### Breaking

- **`buildHermesNegotiationTurn` and `HermesNegotiationResponseSchema` /
  `HermesNegotiationResponse` are removed.** The builder's only consumer was
  the REST respond route #1494 deleted, and nothing has mapped a Hermes action
  to a persisted turn since. `HermesNegotiationActionSchema` /
  `HermesNegotiationAction` stay: they are the vocabulary the hermes-plugin
  mirrors and that the eventual rebuilt external-agent lane has to honour.

### Fixed

- **`NegotiationGraph`'s `resolve` no longer writes over an already-terminal
  opportunity status.** An owner verdict (Radar skip/accept,
  `PATCH /opportunities/:id/status`, the DM's accept/reject tools) writes
  `accepted` / `rejected` itself — a user action outside the negotiation loop
  by design — and then calls `resolve` to CLOSE the negotiation, because a
  terminal opportunity whose task stays `working` holds its round open forever
  and the round's reflect job never fires. Rewriting the status inside
  `resolve` would have downgraded that `accepted` back to `pending` and
  re-fired the actionable notification for a match the owner had already
  accepted.

## 30.0.0 - 2026-08-24

### Changed

- **One PersonalAgent persona.** The signal, onboarding, and negotiator chat
  personas collapse into a single `createPersonalAgentPersona(identity)`
  factory with `PERSONAL_AGENT_PERSONA_ID = 'personal'`. What a turn may do is
  derived from the session's resolved scope context, never from a persona id;
  the onboarding prompt/toolset is a fragment selected by incomplete-onboarding
  session state on truly unscoped sessions only. Removed exports:
  `SIGNAL_PERSONA_ID`, `createSignalPersona`, `ONBOARDING_PERSONA_ID`,
  `createOnboardingPersona`, `NEGOTIATOR_PERSONA_ID`, `PersonalAgentChat`,
  `PersonalAgentChatDeps`. The negotiator persona (prompt, chat toolset, and
  its `remember`/`forget` chat tools plus the `negotiatorMemoryTools` host
  port) is deleted outright: every intent-scoped DM turn is IntentAgent-owned
  host-side, so no chat persona exists for that scope. Tool allowlists and
  narrowing are unchanged in content.

## 29.0.0 - 2026-08-23

### Breaking

- **NegotiationGraph rewritten as a single write path.** Every write to a
  negotiation now goes through one graph, routed on the shape of its invoke
  input — no `operationMode`: `{ opportunityId, brief, intentId }` opens,
  `{ negotiationId, brief }` resumes, `{ negotiationId, turn }` applies a
  submitted turn (internal, external agent, or timeout, all through the same
  `apply` sink), `{ negotiationId, pause: 'counterparty_silent' }` is a
  timeout, `{ negotiationId, verdict: 'pending' | 'reject' }` is the only
  terminal write, `{ negotiationId }` reads.
- **The negotiator no longer terminates a negotiation.** `IndexNegotiator`
  and its stances, deadlock shift, checklist gate, conclusion floor, decline
  law, copy-loop guard, turn cap and park window as *outcomes* are deleted.
  A turn is now one of `outreach | counter | question` (continue) or
  `pause(counterparty_silent | needs_principal | ready_for_verdict, payload)`.
  There is no `accept`, `decline`, or `withdraw` on the turn surface — a side
  that wants out pauses `ready_for_verdict(reject)`. `resolve` (writing
  `pending`/`reject` to the opportunity) is the only way a negotiation ends,
  and nothing calls it yet in this release; negotiations pause and wait until
  the caller that will do so (IS-A / AgentGraph) lands.
- **The interim internal turn author is `NegotiationAuthor`**, a single
  structured-output call constrained to the verb schema in
  `negotiation.turn.ts`, prompted from the brief and the thread so far. It
  replaces `IndexNegotiator` for this release only; AgentGraph replaces it in
  turn.
- **The A2A conversation is per negotiation, not per pair.** A negotiation is
  its own conversation and its own task. There is no seeded prior-pair
  dialogue, no `priorAttribution`, no conversation lock.
- **`respond_to_negotiation` takes a turn, not an accept/decline/withdraw
  action.** External agents (Hermes, MCP) submit the same verbs as the
  internal author, validated the same way. `consult` and the second
  `ask_user` park are removed; an external agent needing its principal
  submits `pause(needs_principal, …)` like everyone else.
- **Removed exports**: `IndexNegotiator`, `negotiateCandidates`,
  `NegotiationGraphFactory`'s old constructor shape (now a single
  `NegotiationGraphDeps` object), `UserNegotiationContext`,
  `NegotiationAction`, `NegotiationSeat`, `NegotiationConsultationReason(Schema)`,
  `resumeParkedNegotiation`, `NegotiationAnswerConsumptionPorts`,
  `createNegotiationAnswerTools`, `NegotiationCounterpartyBinding`,
  `expectedNegotiationSpeaker`, `negotiationScopeKey`,
  `NegotiationContinuationTimeoutIdentity`, `AMBIENT_PARK_WINDOW_MS`,
  `ASK_USER_WINDOW_MS`, `ASK_USER_LOCK_SLACK_MS`,
  `NEGOTIATION_MAX_TURNS_CHAT`, `countOpenPreContactConsults`,
  `PreContactConsultTaskRow`, `InChatNegotiationQuestionDelivery`, and the
  negotiation checklist/deadlock/stance/consultation-policy modules.
- **New exports**: `NegotiationTurnSchema` and its verb/pause-reason/verdict
  types, `NegotiationAuthor`, `negotiationRoundReflectJobId` and
  `NegotiationRoundReflectEnqueueFn` (the all-paused → reflect trigger — the
  reflect consumer itself is a stub until AgentGraph lands), the rewritten
  `NegotiationGraphDatabase` port (`brief` is now a dedicated field;
  `metadata` carries `intentId`/`round`/`pause`).
- **`OpportunityGraph`'s `negotiateNode`** now invokes
  `{ opportunityId, intentId, brief }` for every persisted opportunity — no
  selection, no cap. This release's brief is a minimal deterministic string
  built from the trigger intent; IS-A authors real briefs in the next
  release. `negotiateCandidates`, `compensateTasklessNegotiatingOpportunity`,
  the three hand-built `UserNegotiationContext` builders, and the
  `negotiate_existing` operation mode are all deleted.
- **In-flight negotiations from before this release are not migrated.** The
  negotiation task's shape changed (per-negotiation conversation, dedicated
  `brief` column, new `metadata` shape); old rows are orphaned, not read by
  the new graph.

## 28.1.0 - 2026-08-23

### Changed

- **A pre-contact consult that comes back `ok` now decides the opening
  instead of merely offering the agent another draft.** Previously, once the
  client answered the one question the initiator paused to ask, the resumed
  turn-0 decision was entirely re-drafted: an agent that still held a
  withdraw-worthy concern it never asked the client about (e.g. a location
  preference read from the profile rather than the signal) could withdraw
  anyway, seconds after the client answered the thing it did ask, with the
  counterparty never contacted. Now, if the resumed turn drafts `withdraw`
  and the dimension actually asked about reconciled to `ok`, the graph
  RE-ISSUES the turn once — a fresh model call, explicitly told the answer
  settled the thing it asked and that withdrawing on an unasked concern is
  not available now — and runs the result through every gate the first draft
  faced, rather than rebinding the withdraw's own action: a rebind would have
  shipped that draft's message and reasoning (written to argue against the
  match) verbatim as the opening, both to the counterparty's agent and in the
  web transcript. An unasked concern belongs in the exchange with the
  counterparty's agent, not in a quiet screen-out the client was never asked
  to weigh in on. A `conflict` or still-`unknown` answer leaves the withdraw
  standing, unchanged; a re-issue that withdraws again lands on the same
  quiet `screened_out` outcome.

## 28.0.0 - 2026-08-22

### Removed

- **BREAKING: background enrichment and `user_contexts` are gone; profile
  saves decompose straight into premises.** `EnrichmentRunInput`,
  `EnrichmentRunRecord`, and `UserContextGenerator` are off the barrel — the
  enrichment MCP tools are prefill-only (`research_profile`) now, and
  identity mutation happens through profile saves and REST onboarding
  endpoints, not agent-driven `create_user_context`/`confirm_user_context`.
- **BREAKING: `EnrichmentGraphFactory` is query-only.** `write`/`generate`
  operation modes, `decompose_premises`, scraping, and Chat-API
  auto-enrichment are gone from the graph — it now only answers "does this
  user have an enriched profile" (`operationMode: 'query'`). The constructor
  narrows to `(database)`; `scraper`, `enricher`, and `premiseGraph` are no
  longer accepted. `EnrichmentGraphDatabase` narrows to
  `getProfile | getProfileByUserId | getPremisesForUser`.

### Added

- **`PremiseGraphFactory` gains a `decompose` operation mode**: given
  `{ userId, input }` (free text — chat, bio, or profile fields), it
  extracts individual premises via `PremiseDecomposer`, applies any
  retractions and bio revision the decomposer detects, and creates each
  premise through the normal create pipeline (analyze → embed → dedupe →
  persist → index). This replaces the removed enrichment-graph write path as
  the one way host code turns free text into premises.
  `PremiseGraphDatabase` gains `getUser` and `updateUser`.

## 27.0.0 - 2026-08-22

### Changed

- **Discovery evaluates its whole candidate pool and surfaces at least 10
  matches when the pool allows it.** Retrieval limits were raised
  (`LIMIT_PER_STRATEGY` 30→80, `PER_INDEX_LIMIT` 80→160) and the intent path
  re-runs its search with no similarity floor once when the deduped pool has
  fewer than `DISCOVERY_MIN_MATCHES` (10) distinct users. Evaluation now
  scores the entire pool (capped at 80 by rank) in one parallel round instead
  of batching 25 at a time with an early stop on the first passing batch —
  pass rate does not track similarity rank, so batching was stranding real
  matches behind an over-scored head cluster. Every passing candidate is
  returned uncapped; when fewer than 10 pass, the run fills the rest with the
  best-scored rejected candidates (tiebroken by similarity), persisted with
  their real score. `rankingNode` no longer defaults to a 20-item limit —
  only a caller-supplied `options.limit` cuts the list now.
- `not_accepted` evaluator verdicts now carry the model's actors under
  `returnAll` (previously always `[]`) so a rejected candidate can be used as
  a fill; guard drops (`incomplete_actors`, `unsupported_claim`) still carry
  none and are never fills.

### Removed

- **BREAKING: the `continue_discovery` operation mode is gone**, along with
  the batched-evaluation continuation it existed for: `remainingCandidates`
  (state field and graph output), the `evaluation_bound` trace entry, and
  `'evaluation_bound_reached'` / `unevaluatedCandidates` on
  `OpportunityDiscoverySummary`. Evaluation no longer batches or stops early,
  so there is nothing left to page into.

## 26.0.0 - 2026-08-22

### Changed

- **BREAKING: the intent graph routes on the shape of its input, not an
  `operationMode` flag.** `operationMode` is gone from the graph's invoke
  input. Callers now signal intent by which fields they set:
  `inputContent` alone creates; `inputContent` + `targetIntentIds` is an
  explicit update; `targetIntentIds` + `archive: true` expires; `targetIntentIds`
  + `status` pauses/resumes; `proposalId` (+ `description`, `networkId`)
  confirms a stored proposal; none of the above reads. `dryRun: true` replaces
  the old `propose` mode. `targetIntentIds` alone, or more than one of
  {content, archive, status, proposalId} set at once, is now a graph-level
  input error rather than a silent no-op or an implicit default.
- **BREAKING: `IntentGraphDatabase` gained required members.** Archive now
  performs its full cleanup (network-association removal, referencing
  opportunity expiry) itself, and the graph owns pause/resume and
  proposal-confirmation persistence. Hosts implementing this interface must
  add `deleteIntentIndexAssociations`, `expireOpportunitiesByIntentActor`,
  `transitionIntentLifecycle`, `compensateFailedResume`, `getProposalForOwner`,
  `revisePendingProposal`, and `confirmProposalIntent`.
- **BREAKING: `IntentGraphQueue` gained `addResumeDiscoveryJob`.** The graph
  enqueues resume discovery directly (and compensates back to `PAUSED` on a
  failed enqueue) instead of leaving that to a host-side event hook.

### Added

- `IntentLifecycleStatus`, `TransitionLifecycleResult`, `IntentProposalRecord`,
  `ReviseIntentProposalInput`, and `ConfirmProposalResult` are now exported
  from the package barrel.

### Removed

- The inferrer's profile-fallback path (`allowProfileFallback`, content-less
  inference) had no live caller and is gone along with the `delete` operation
  mode it was keyed on.

## 25.0.0 - 2026-08-21

### Removed

- **BREAKING: principal reachability no longer gates consultation.** A seat's
  agent may always `ask_user` its own client; whether anyone is behind the
  account is not the author's concern. Gone: `UserNegotiationContext.principalUnreachable`,
  the optional `isPrincipalUnreachable` host port on `NegotiationGraphDatabase`,
  the `principal_unreachable` ask-inadmissibility reason, the
  `PRINCIPAL_UNREACHABLE_*` prompt rules, the init-node stamp and the
  detail-reader / `get_negotiation` live re-stamp. Seed personas (`.test`
  mailboxes) negotiate exactly like real users now — in the sandbox four of
  five personas had been silenced by construction, and the question flow
  could not be observed for them.

## 24.0.0 - 2026-08-21

### Removed

- **BREAKING: every environment feature gate is gone, and what each environment
  was running became the code's behaviour.** No accessor in this package reads
  `process.env` for a behaviour decision any more; configuration narrows to
  credentials, endpoints, and the model/log values the host supplies.

  Off the barrel: `configuredAskUserEnabled`, `askUserAnswerWindowMs`,
  `discoveryEvaluatorMinScore`, `negotiationConsultationPolicyMode`,
  `negotiationEvidenceQuestionsMode`, `poolQuestionsRanking`,
  `poolQuestionsMiningMode`, `poolQuestionsMode`, `poolQuestionsPushMode`,
  `poolQuestionsStampNewborn`, `poolQuestionsVisitTrigger`,
  `POOL_VISIT_MINING_DEBOUNCE_MS`, `isIntroducerDiscoveryEnabled`,
  `runIntroducerDiscovery`, `selectContactsForDiscovery`,
  `shouldRunIntroducerDiscovery`, `IntroducerDiscoveryDatabase`,
  `IntroducerDiscoveryQueue`, `INTRODUCER_DISCOVERY_SOURCE`,
  `ContactWithIntents`, `MAX_CONTACTS_PER_CYCLE`, `MAX_CANDIDATES_PER_CONTACT`.
  The five `poolQuestions*` accessors had no callers at all — they read
  variables retired with the card question generators.

  Behaviour now fixed in code: negotiations stamp protocol `v2`; `ask_user` and
  the deterministic consultation policy are on; deadlock-shift is on; the
  negotiator drafts in the `skeptic` stance (`advocate` and `evaluator`, and the
  `stance*` predicates that distinguished them, are gone); negotiators receive
  only each participant's exact opportunity-bound signal; HyDE generates under
  `frame-v1`; candidate evaluation runs in parallel; retrieval floor is `0.20`
  and the evaluator score floor is `40`; the two question miners are pinned to
  `shadow`.

- **BREAKING: profile matching is removed — discovery is intent-to-intent only.**
  Premise-to-premise, context-to-context and context-to-intent strategies are
  gone, along with the `profileCorpus` hint on the embedder interface. Premises
  remain as an entity; they are no longer a matching corpus.

- **BREAKING: introducer discovery is removed** — the queue, the maintenance-graph
  node, and the on-behalf-of persistence path (`onBehalfOfUserId` is off the
  opportunity graph state; nothing assigned it once the queue was gone). The
  `introducer_discovery` opportunity source value is kept as read-only history:
  nothing stamps it, and rows created before this release still carry it.

- **BREAKING: the negotiation outreach screen gate is gone.** `NegotiationScreener`
  is off the barrel, and the graph is now `init → turn* → finalize` — every
  negotiation that reaches `init` proceeds to its first turn. The gate was one
  structured LLM call before the first turn that could return `pass` and end the
  negotiation as `screened_out` with the counterparty never contacted.

  It was removed because questions come from parked negotiations: a negotiation
  screened out never runs a turn, so it never stalls, never parks, and can never
  produce a user-facing question. The gate silently removed matches from the one
  pipeline that generates them.

  Also gone: `negotiation.graph.screen.ts` and `negotiation.screen.contracts.ts`
  in full (`NEGOTIATION_SCREEN_MODES`, `NegotiationScreenMode`, `SCREEN_MODE`,
  `ScreenDecisionSchema`, `ScreenDecision`, `ScreenDecisionRecord`,
  `blocksNegotiationBeforeFirstTurn`), the `screener` dep on
  `NegotiationGraphDeps`, the `screenDecision` graph-state field, the
  `routeAfterScreen` edge, the optional `setTaskScreenDecision` port method on
  `NegotiationGraphDatabase`, the `negotiationScreener` model-config entry, and
  the `screenedOut` field of `ConsultationEligibilityInput` (always false with
  no gate to set it). `NegotiatorMemoryScope` narrows to `"turn"`, and
  `renderNegotiatorMemorySection` loses its options argument — the
  `memoryHintsInstruction` it carried existed only for the screen prompt.

### Changed

- **`negotiationHasMadeContact` moved to `negotiation.protocol.ts`.** Not a
  screening helper: finalize and the turn node both call it for live turn logic
  (the IND-564 opening-`withdraw` guard, and the `screened_out` label). It lived
  in the screen module by accident of history. Package-internal, so no consumer
  import changes.

- **`screened_out` now has exactly one live writer** — the IND-564 opening-turn
  `withdraw` guard, where the acting agent refuses before anything is sent.
  `outcome.reasoning` for such a run is unconditionally the withdrawing turn's
  reasoning; there is no screen record left to prefer over it.

### Read-only history (deliberately kept)

- The `screened_out` outcome reason, `tasks.metadata.screenDecision`, and the
  owner-only `screenDecision` API projection. Nothing writes the metadata key
  any more, but negotiations that ran before this release still carry one and
  must still render for their initiator. Each survivor is marked as such at its
  definition.

## 23.6.4 - 2026-08-21

### Added

- **`buildAgentSelfIntroduction` is now actually exported.** 23.6.3's entry
  named it as part of the new surface, but it was only reachable from inside
  the package — the three chat personas import it directly. It is now on the
  barrel (`buildAgentSelfIntroduction`, `AgentIdentityOptions`), which is what
  makes that claim true for consumers.

### Changed

- **`buildAgentSelfIntroduction`'s `userName` is optional.** Additive: every
  existing caller passes it and gets the same sentence. Absent, the builder
  emits `You are <name>, <role>.` or, with no name either, `You are <role>.` —
  the form a surface needs when its role phrase already says whose agent this
  is and it never resolves a client display name. The API's IntentAgent loop
  is the first such caller.

## 23.6.3 - 2026-08-21

### Added

- **Persona identity + create_intent scope rule (#1479) — the version stamp
  the change shipped without.** Every chat persona now introduces itself as
  the user's own agent: `buildAgentSelfIntroduction`, plus
  `createSignalPersona` / `createOnboardingPersona` factories taking
  `agentName` the way the negotiator already did. Tool registration gained
  the scope rule (`isToolAllowedInScope`, `filterToolsForScope`). #1479
  merged these exports without bumping, so two different export surfaces
  briefly answered to 23.6.2 on the `rc` tag — this entry gives the new
  surface its own version.

## 23.6.2 - 2026-08-21

### Fixed

- **A premise-matched counterparty is premise-bound — two wrongs stopped
  agreeing.** A premise-matched opportunity actor carries BOTH keys: `premise`
  is its own fact, `intent` names the intent it matched AGAINST — the
  recipient's. Two sites independently preferred `intent` whenever the key
  existed, and their mistakes agreed with each other: the api's ask-user
  capture stamped every premise-matched park's `counterpartyBinding` with the
  recipient's own intent (so the claim's counterparty-liveness check could
  never pass — observed live as `admission:"invalid"` after #1474/#1475 had
  already made settle and claim drift-tolerant), and this package's
  `resolveOpportunityActorBinding` resolved a dual-key actor to that same
  wrong intent binding — so the re-drive's continuation revalidation
  (`opportunityActorMatchesBinding` in `negotiateExistingOpportunity`) would
  have accepted the mis-stamp and refused a corrected premise stamp as
  `stale_continuation`, one gate after the claim.

  Both flips ship together, mirror-identical: a present `premise` is the
  binding, `intent` binds only in its absence. Mirror consequence, intended:
  a dual-key actor no longer matches an intent-kind binding naming its
  matched-against intent — the gate stops accepting mis-stamped settlements,
  which already fail the claim's liveness check earlier, so nothing that
  works today breaks.

## 23.6.1 - 2026-08-20

### Fixed

- **An answer beats staleness — drift is logged, never fatal.** Observed live:
  a client answered her own parked question ("Timing: This week") through the
  new MCP answer lane, routing succeeded, consumption ran — and the settle
  returned `lost`, because the signal had been edited twice since the park and
  the revalidation fence required the world to look exactly as it did at park
  time. The park became a zombie: still `input_required`, still rendered as
  "waiting on YOUR answer" by every surface, structurally unanswerable. The
  design law is explicit: signal edits cascade nothing, and a stale negotiation
  is solved by ANSWERING its question — the user's answer is the freshest
  commitment there is, and the resumed turn rebuilds its context from current
  data anyway.

  The settle's one fence is now two. Coherence stays hard: an answer that does
  not belong to its park (settlement mismatch, wrong recipient, task no longer
  parked, a dismiss/timeout settlement won the race) is still refused. Drift
  stops losing: within a live opportunity and an active signal, the answer
  settles and resumes regardless of what moved since the park.

- **The unresumable tail is an explicit proposal, not a silent drop.** When
  current reality genuinely cannot continue — terminal opportunity or archived
  signal — the answer is still recorded as heard: settlement result and resume
  outcome `recorded_unresumable` (additive), the block-consumption result
  counts it in its own `recorded` array so a `skipped` count can never again
  hide it, and the implementation retires the park and tells the client the
  truth, proposing re-discovery under the updated signal — an offer, never an
  automatic act.

## 23.6.0 - 2026-08-20

### Added

- **The MCP surface can now ACT on the question flow, not just see it.** Since
  23.5.1 `list_negotiations` says the park — "open question 3, 'Timing'" — to
  an external client that had no tool to answer it: the answer lane was the
  negotiator persona's chat-only appended tool, and the owner's verdict levers
  did not exist on MCP at all. Three tools close the read-and-act gap, all
  registered on the MCP tool registry surface only:

  - `answer_pending_question(negotiationId, question, answer)` routes the
    principal's answer to the open question a parked negotiation is waiting on,
    over the EXISTING `NegotiatorAnswerToolsHost` — the same
    `readOpenQuestionsForIntent` numbering, the same serialized consumption
    queue, the same #1432 resume spine. MCP has no pinned intent, so the tool
    resolves scope from the negotiation the client is looking at: the id the
    park annotation sits on → the caller's own actor intent on that pairing →
    the host. The `question` number passes through untouched; it and the park
    annotation come from one enumeration and cannot drift (the #1470 rule).
  - `reject_opportunity` / `accept_opportunity` (intentId, numbered
    counterparty, optional reason in the owner's own words) reuse the
    negotiator verdict host verbatim — the same Radar Skip/Start-Chat service
    call, outcome hooks and question retirement in its wake, positions never
    ids. Capability access is `human_only`: exactly the session-authenticated
    class the IND-593 owner-provenance binding admits, and the handler
    re-checks the host-bound provenance so an API-key agent is refused even if
    the tool were ever mis-listed. Hermes negotiator credentials fail closed as
    unclassified for all three tools.

- **`get_negotiation` says the park** — the #1472 incident, one level down: it
  is the tool the poller prompt says to call FIRST, and on a parked negotiation
  it narrated a lifecycle built without the park. The detail reader now runs
  the same canonical park predicate the listing runs (`classifyInflightPark` /
  `classifyPostStallPark`) over the task and messages it already holds, names
  the open question through the same shared host record, projects the park
  top-level and into `lifecycle` (superseding the status label), and — for an
  external seat that could not see dimensions or `settles` — projects the
  persisted `askUser` and `checklist` payloads on turns that carry them.
  Non-parked negotiations render byte-for-byte as before.

- **`get_negotiation` re-stamps principal reachability from the live read.**
  The persisted `turnContext` is a park-time snapshot; `ownUser.principalUnreachable`
  is now corrected in both directions through the host's
  `isPrincipalUnreachable` port — the same re-stamp REST pickup applies — so an
  external seat is never told it can consult a principal nobody is behind, or
  the reverse.

- **`list_negotiations` can filter for the parked state.** The `status` filter
  gains `input_required`; `active` and `all` behave exactly as before. A
  post-stall park lives on a `completed` negotiation and is documented as such
  rather than smuggled into the status filter.

### Fixed

- **`read_activity_summary` stops counting questions from the retired card
  table.** Pending question counts now come from the parked negotiations —
  a mid-flight `input_required` consult naming the owner as recipient, or a
  post-stall park trailing the authored gap — keyed by the same
  `negotiation_inflight`/`negotiation` modes the projection already maps to the
  negotiations domain, so permission inheritance is unchanged. Leftover
  pending rows in the retired `questions` table contribute nothing; answered
  history still reads the table, where it legitimately lives.

- **Honest words where external clients read them.** The negotiations guidance
  topic, the workflows topic, and `MCP_INSTRUCTIONS` now carry the park stage —
  what a park is, what the `park` fields mean, and that answering is the only
  thing that resumes a parked negotiation. The three negotiation tool
  descriptions state plainly that turns submitted through external surfaces are
  NOT run through the conclusion floor, decline law, or copy-loop guard: until
  external write parity ships, the docs must not imply otherwise.

## 23.5.1 - 2026-08-20

### Fixed

- **The negotiation listing says the park, from the same record every other
  answerability surface reads.** Observed live: a client asked her agent "do we
  have a question?" while a negotiation had sat parked `input_required` on her
  side for two hours with the open question "Timing: This week". Every 23.5.0
  surface was correct — the precedence gate found the question, and the
  prompt's open-questions section named it at position 1. Then the model called
  `list_negotiations`, which renders lifecycle from OPPORTUNITY STATUS, where
  the pairing legitimately reads `negotiating`, and which said nothing at all
  about the park. Holding a static context line saying one thing and a
  just-executed tool result saying another, it went with the tool: "there are
  currently no open questions… I am still negotiating with the other agent…
  nothing for you to decide." Both clauses false at the task level; both
  faithful to what the tool rendered.

  The listing was the last surface still deriving "what is happening" from a
  source other than the shared resolver, so the tool and the context could
  disagree — and the tool wins the model's trust every time. It now carries a
  `park` on any negotiation that holds one: `waitingOn: "you" | "counterparty"`,
  and for a park on the client's own side the open question's number and label.

- **One call, every surface — the answer-openness rule extended to its last
  holdout.** The question's NUMBER and LABEL come from
  `NegotiationListingParkHost`, whose host implementation resolves them through
  the same call the open-questions prompt section and `answer_pending_question`
  make. The listing does not enumerate anything of its own, so the number the
  client is shown is the number that routes their answer. A question's
  `alsoUnblocks` refs carry that same number, since one answer resumes them all.

- **Whose side a park is on is the canonical predicate, not a second one.**
  `classifyParkedNegotiation` is split into `classifyInflightPark` and
  `classifyPostStallPark`, pure over the task and messages a caller already
  holds; the async function is now the reading half around them and keeps its
  lazy messages read. The listing calls them with material it already loaded, so
  park classification costs no extra query and cannot drift from the predicate
  answer routing uses. Parked-ness is never re-derived from opportunity status.

- **A park on the counterparty is narrated, never quoted.** It renders as
  waiting on their side with no question content: that question is not this
  client's to read.

### Changed

- **`lifecycleLabel` states the park, superseding the status label.** The
  persona is told to take `lifecycleLabel` as its user-facing wording, and "the
  agents are still negotiating" is exactly the sentence that became a false
  "nothing for you to decide". `opportunityStatus` still reports the true
  status; what it may no longer do is supply the sentence.
  `connectionState` gains `parked_awaiting_your_answer` and
  `parked_awaiting_counterparty`, and `buildLifecycleNarration` takes an
  optional third argument. A negotiation with no park renders byte-for-byte as
  it did in 23.5.0, and is pinned by a fixture spec.

- **The tool description and the negotiator prompt both say the two agree.**
  `list_negotiations` documents `input_required` as a status, documents `park`,
  and states that the numbers come from the same record the open-questions
  context section does — so the model has no basis to rank one over the other.
  It also states that `negotiating` alone never means "nothing is waiting on
  you". The persona gains one grounding rule saying the same thing.
  `NegotiationListingParkHost` is optional: without it the listing still says
  whether a pairing is parked and on whose side, it just cannot name the
  question's number.

## 23.5.0 - 2026-08-20

### Added

- **The owner's verdict has a lane in their own DM.** Observed live: in the
  negotiator DM for one signal, a client told their agent to reject the
  counterparty — a pairing parked `input_required`. The agent could not comply.
  The owner makes exactly three kinds of decision in that room. They ANSWER a
  question a parked negotiation asked, which `answer_pending_question` gave a
  lane. They EDIT the signal, which `update_intent` always covered.
  And they pass a VERDICT on a counterparty, which had no lever at all. So on
  "reject them" the persona's whole repertoire was to say something back, or to
  edit the signal instead; the pairing stayed parked and the counterparty
  stayed live.

  `update_opportunity` is in the negotiator toolset and cannot substitute for
  either half of this. `admitOpportunityUpdate` blocks a `negotiating` pairing
  outright, and the IND-593 owner-approval boundary fails closed on the chat
  surface by design — `createChatTools` binds
  `{ surface: 'chat', sessionAuthenticated: false }`, and a mediated surface is
  denied `untrusted_provenance`. The verdict levers that exist are the Radar
  card's Skip and Start-Chat and the REST endpoints behind them, none of which
  the client's own agent can reach.

  So `createNegotiatorVerdictTools` adds `reject_opportunity` and
  `accept_opportunity` to the negotiator persona, on the same pattern
  `answer_pending_question` set. Appended AFTER the allowlist filter and only in
  an intent-pinned session with `negotiatorVerdictTools` injected, so they never
  enter the shared chat-tool registry and the orchestrator and MCP tool listing
  cannot see them. `NegotiatorVerdictToolsHost` is the whole surface the package
  knows; the composition root owns everything behind it.

- **Numbered refs, never ids.** The prompt renders this signal's actionable
  counterparties as `N. {name} — {state}`, and the tool takes the number. The
  schema offers no place to put an id and no result string carries one. The rule
  is `answer_pending_question`'s, for a sharper reason: a ref the model can name
  is a ref it can get wrong, and a wrong ref here declines the wrong person.
  The host owns the mapping, and a successful result names WHO the write landed
  on — so the confirmation the client reads comes from the write rather than
  from the model's belief about which counterparty it picked.

- **An optional `reason`, in the client's own words.** Capped at 500 characters,
  omitted entirely when they gave none. The tool description and the prompt both
  say it is never to be inferred or written for them.

### Changed

- **The pinned-signal prompt gains a verdict section, and only where the tools
  exist.** `NegotiatorPromptOptions.actionableCounterparties` renders
  `## Verdicts {userName} can pass here` plus two tool-reference rows. It says
  the tool call IS the decision — not the sentence about it, and not an edit of
  the signal; that a verdict the client did not pass must never be passed for
  them; that `update_opportunity` is not this lever; and that an accept is one
  side of two and never a connection. Rendered only in an intent-pinned session
  with a non-empty list, since that is the only place the tools are registered.
  Absent or empty leaves the prompt byte-identical to 23.4.0.

- **Result copy is honest at every status.** `executed` names the counterparty
  and forbids also editing the signal; `none_actionable` forbids implying a
  decision was recorded; `unknown_counterparty` states plainly that nothing was
  decided and re-lists the current set; `already_decided` says whose move it is;
  `error` forbids describing the pairing as decided. A host that throws is
  caught and reported as `error` rather than costing the client their turn.

- **Execution is the path the Radar card already takes, and nothing more.** The
  host behind the seam runs the SAME owner status update the Skip page calls
  through `PATCH /opportunities/:id/status`, intent-scoped. No new task-state
  transition is invented, and the retirement of a dismissed pairing's open
  question is not re-invoked: `OpportunityEvents.onTransition` already fires the
  exhaustion evaluator on every committed opportunity status write, owner reject
  included, so a rejected pairing's question dies with it because that arrow was
  already there.

## 23.4.0 - 2026-08-20

### Added

- **A checklist dimension now declares whose fact it is, and the floor reads
  it.** Observed live: turn 2 of a sandbox negotiation, initiator seat, a
  checklist whose two open dimensions were "Query Match: Generative Story
  Games" and "Query Match: Live Operations" — both about the COUNTERPARTY's
  work. The agent drafted `question` to the counterparty's agent, which is the
  protocol's own prescribed move. The conclusion floor (23.3.0) saw a non-ask
  turn with an askable unknown standing, took `askableUnknowns[0]`, and coerced
  the turn into a guaranteed `ask_user` — so the client was asked, in her own
  DM, whether the other person works on generative story games.

  Nothing was wrong with the floor's logic; the logic simply could not see the
  distinction. "Askable" was `unknown ∧ unasked ∧ budget ∧ reachable ∧ wiring`,
  and no term in that conjunction knows WHOSE fact is missing. That judgment
  lived only in the agent — which is exactly the judgment the guarantee exists
  to override. Where the first unknown happens to be the client's own the
  guarantee is right; where it is the counterparty's it converts the agent's
  correct move into a wrong one.

  So the judgment becomes a declared, mechanical property, following the same
  pattern answerhood set: made ONCE, at authoring, by the agent writing the
  checklist, then read mechanically forever. `ChecklistItem` gains
  `settles: 'client' | 'counterparty' | 'either'`, frozen with the dimension —
  `reconcileChecklist` copies it through untouched, because it is a judgment
  about the world rather than about the evidence, and a re-scorable one would
  be a switch an agent could use to turn the floor off for a dimension it would
  rather not be asked about.

### Changed

- **`askableUnknowns` filters on it, so both halves of the floor do.**
  `assessConcludeAdmissibility` now admits a verdict whose only open dimensions
  are the counterparty's to state — those are resolved by dialogue with the
  other agent, or carried, which is what the verdict law has always said about
  unknowns — and the part-2 guarantee picks only from what survives the filter.
  Order within the surviving set is still the checklist's own.
- **The five-part ask rule gains the mechanical half of its rule 3.** An
  agent-drafted ask naming a `settles: 'counterparty'` dimension is refused as
  `counterparty_authoritative`, with the same honest-refusal logging as its
  siblings. Rule 3 was prompt-only until now; the incident proves the
  mechanical half matters in both directions — the same field that stops the
  floor manufacturing the wrong ask stops an agent drafting it.
- **The prompt asks for the field where the model authors, and reads it back on
  every row.** The authoring instruction and the checklist protocol rule both
  require `settles` per dimension in the vocabulary they already use ("a thing
  only your client can answer" / "the counterparty's to state"); the rendered
  checklist labels each row with it, because the agent re-scoring a frozen
  checklist did not necessarily author it. The conclude-floor re-issue states
  that counterparty-settled dimensions are not what it is about.

### Fixed

- **The generation seam states the field and repairs it, rather than refusing.**
  Following 23.3.2's split: `ChecklistDraftGenerationSchema` requires `settles`
  on every dimension — so it renders inside the emitted JSON schema's `required`
  list, and a field the model need not produce is one it skips — while a
  `preprocess` fills a missing or unrecognised value with `either` before the
  enum ever sees it. A `.catch()` on the field would have read as optional to
  zod and dropped out of `required`, which is why the repair wraps the object.
  A refusal here throws inside the structured-output call and takes the whole
  turn with it.
- **Legacy checklists are unchanged.** Persisted turns written before the field
  existed carry no `settles`, and `normalizeSettles` reads them back as
  `either` — which stays ASKABLE. The default direction is the whole safety
  argument: `counterparty` would let one unfilled field silently retire the
  conclusion floor for a negotiation, so no authoring failure, legacy turn, or
  repaired value can switch it off wholesale. An unrecognised value on the
  persisted shape reads back as absent rather than failing the item, because
  that shape also parses the drafts of externally dispatched agents, which
  never see the generation schema — a whole re-scored checklist discarded over
  one misspelled marking is the larger loss.

## 23.3.2 - 2026-08-20

### Fixed

- **A question the model wrote itself must not die at the schema that asked for
  it.** For the first time, the negotiator drafted its own `ask_user` — 23.3.1's
  re-issue prompt worked and no floor coercion was needed — and the draft was
  refused by the very schema it was drafted into, twice over. `guaranteed`, the
  conclusion floor's own mark, was an optional field on the payload handed to
  the model; the model filled it with `false`, and `z.literal(true)` rejects
  `false`. The authored `question.title` carried a silent 12-character cap; the
  model wrote a real 40-character title. Both refusals throw INSIDE the
  structured-output call, so the turn failed with nothing persisted, the retry
  was refused the same way, the ask was coerced to a counter, the dialogue ran
  to the cap and declined. The question was never delivered.

  Two seams were sharing one declaration, and they have opposite jobs. There
  are now two. `AskUserGenerationSchema` is what a model is ALLOWED TO SAY: it
  OMITS `guaranteed` entirely — a field only the graph may write should never
  be offered to the model, rather than offered and defended against afterwards
  — and it discards unrecognised keys instead of failing the turn over them,
  since this parse is what produces the object that gets persisted. The
  persisted `AskUserPayloadSchema` is unchanged: it keeps `guaranteed` and
  stays `.strict()`, because the record is where the floor's mark is read back
  out of and where a stray key would do damage. The turn node still strips an
  agent-claimed mark — externally dispatched personal agents draft against the
  permissive shape, not the generation schema — so the floor remains the only
  writer whichever way a draft arrives.

  Every renderer cap on a question now REPAIRS instead of refusing, which is the
  protocol's own philosophy (`normalizeChecklistItem` repairs toward `unknown`;
  the anti-echo guard repairs toward honesty) applied where it was missing: a
  title, prompt, option label or description that runs long is truncated on a
  word boundary, and a fifth option is dropped. The emitted JSON schema is
  unchanged, so the model is still TOLD each cap — repair is only what happens
  when it ignores one — and the conclusion-floor re-issue now names the title
  cap where it tells the agent to write the question itself. Where nothing can
  be honestly repaired (one option is not a choice), the generation schema
  degrades the authored question to absent and keeps the ask: an ask with no
  wording falls back to the server template, a path the floor's own guaranteed
  ask already walks. Losing the wording is a smaller loss than losing the turn.

## 23.3.1 - 2026-08-20

### Fixed

- **A task's FIRST turn can park.** The first `ask_user` this system ever fired —
  produced by 23.3.0's conclusion floor, on the first turn of a resumed
  session — died at the park with "Ask-user material binding is no longer
  valid", and the negotiation stalled. The binding capture locks the task row
  `state = 'working'` and refuses anything else; the graph announced `working`
  only at the END of a completed turn, so on a task's first turn the row still
  held its creation state (`submitted`) and no first-turn park could bind. The
  turn was already on the record when it threw, which makes the failure
  unretryable — so the whole opportunity ended as `agent_error`.

  The turn node now announces `working` before the capture rather than only
  after the turn, carrying the same continuation-execution fence as every other
  state write. The fence in the adapter is unchanged: `working` is the true
  precondition for a settlement coordinate, and what was wrong was the
  sequencing, not the check. The flip sits at the park rather than at the top of
  the turn deliberately — a task that dies before putting anything on the record
  stays reclaimable under the watchdog's ten-minute `submitted` rule instead of
  disappearing under the twelve-hour `working` one — and the end-of-turn flip
  stays for every path that does not park.

  Latent since the turn-0 pre-contact consult shipped and never once hit,
  because no first-turn ask was ever drafted; the conclusion floor made them
  routine, a run-existing continuation's turn 0 being the common case. The
  twenty-five specs covering this loop all missed it because their database
  stubs accepted any task state at capture time — the new spec's stub asserts
  the state exactly as the adapter does, on the agent-drafted ask, the
  floor-guaranteed one, the pre-contact consult and a later-turn ask alike.

## 23.3.0 - 2026-08-20

### Changed

- **A verdict has a floor under it: an askable unknown outranks a conclusion.**
  Every stage of the flow — signal, discovery, agents talking, match, meet — was
  verified working except one arrow: the agent asking its own client something
  only that client can settle. In a week of live traffic it fired zero times,
  against 23 policy-recognized consultation moments. The reason is structural
  rather than a bug: the model always had a cheaper exit than asking — assume the
  unknown away and accept, put the question to the counterparty who does not hold
  the answer, or simply conclude — and it took one every time. #1463 closed one
  of those exits (a decline with no conflict behind it). This closes the rest.

  `assessConcludeAdmissibility` makes a drafted TERMINAL verdict — `accept`,
  `decline`, `reject`, and the initiator's `withdraw` — inadmissible while the
  checklist holds a dimension scored `unknown` that this principal could still be
  asked about, reported as `unknowns_askable` with the dimension names. "Askable"
  is the conjunction the turn node already computes as `askUserAvailable` (v2,
  wiring up, budget left, ask-rounds cap unreached, principal reachable,
  non-final turn) with the checklist's own part (unknown, and the topic unasked
  in this negotiation). Every one of those conditions failing REOPENS the
  verdict, which is what keeps the floor from being a deadlock: a spent budget,
  an unreachable principal, a settled checklist or the last turn all leave the
  verdict exactly where it was. Fails open on an unauthored checklist;
  `advocate`/v1 untouched; #1463's decline law still applies independently.

  On a premature verdict the turn node logs/traces `negotiation_conclude_premature`
  and re-issues the turn ONCE, naming the open dimensions and leaving two moves:
  score the dimension from something a principal actually STATED, or ask the
  client whose fact it is. Unlike the anti-echo re-issue — which hard-refuses
  `ask_user`, since a repeated message says nothing about whether a consultation
  is warranted — an ask drafted on THIS re-issue is the outcome the floor exists
  to produce, so it is offered in the seat vocabulary and flows through the
  ordinary admission and park path. That required the three ask gates
  (reachability, availability/policy, the five-part rule) to become one function
  the re-issue faces too; policy admission is re-run for a re-issued ask, because
  the eligibility computed for the refused draft was a judgment about an action
  that no longer exists.

- **When the model still refuses, the graph fires the arrow itself.** If the turn
  that would persist still leaves no ask on the table while an askable unknown
  stands, the drafted turn is coerced to `ask_user` carrying the top askable
  DIMENSION, and parks exactly as an agent-drafted ask does — `input_required`,
  expiry timer, questioner enqueue. Bounded at one per negotiation per principal
  via a new graph-only `askUser.guaranteed` mark read back off the persisted
  turn (the turn node strips any agent-claimed mark, so the floor is the field's
  only writer), and it consumes budget and an ask round like any other ask
  because the record it writes is the same one every accounting reads.

  Coercion rather than "persist the turn and park beside it": every accounting
  the protocol has — the per-principal budget, the asked-topics record, the
  negotiation-wide ask-rounds cap — is read off persisted `ask_user` turns, so a
  park riding alongside a `counter` would spend a person's attention while the
  record showed nothing spent and leave the same dimension askable next turn.
  And after the re-issue the drafted action is frequently terminal, where
  persisting it would END the negotiation — there is no "in addition" available.
  What coercion costs is the drafted message, and only where it should be: a
  terminal turn's message is dropped with the action it belonged to (#1463's
  rule, for #1463's reason), while a non-terminal message is kept and persisted
  — a real contribution to the exchange, after which the seat parks instead of
  handing the turn over. Traced as `negotiation_ask_guaranteed` with the
  dimension.

  This is NOT the pre-#1455 inferred consultation. That fired from action enums
  with no content behind them and produced "would you be open to connecting?";
  this fires from a named dimension the agent itself wrote and itself scored
  unknown, and the api's question-message author already reads
  `askUser.dimension` off the parked turn, so what reaches the client is a
  question about that dimension. `NegotiationInflightContext.dimension`
  (additive, optional) carries the same thing on the questioner payload.

  The OPENING turn is deliberately outside all of this. The checklist is authored
  there and the authoring instruction REQUIRES a dimension the record does not
  settle, so an open dimension on turn 0 is the shape the protocol asked for, not
  a dodge — and a floor that bound there would park every negotiation before it
  ever made contact. Turn 0 already has its own designed consult, the pre-contact
  verdict, bounded per signal.

- **The verdict prompt's escape hatch is now conditional.** "What remains unknown
  is the kind of thing two people settle in a first conversation" waved verdicts
  through unconditionally; the reference behaviour opens that hatch only once the
  question budget is spent. `CHECKLIST_VERDICT_RULE` now says so: while budget
  remains and the client is reachable, an unknown that is theirs to settle is
  asked before any verdict. The basis discipline also gains one line — the reason
  a match was suggested is an inference drawn by something that never spoke to
  either principal, so it can no more score a dimension than a profile can.

  Protocol 23.2.0 → 23.3.0. No flags; ships on.

## 23.2.0 - 2026-08-20

### Fixed

- **No turn may repeat a message already on the record.** A counterparty asked what
  a phrase in the client's own signal meant; the answering agent could not consult
  its (unreachable) principal and its record did not settle the phrase, so with no
  legal move left it copied the question back word for word. Both models then
  locked — reproducing text already in context is close to deterministic — and the
  negotiation spent its remaining turns exchanging two byte-identical messages
  before one side declined citing "repeated lack of clarity … despite five
  inquiries". The turn node now compares each drafted message against every
  message already in the negotiation: an exact repeat is never persisted, the turn
  is re-issued ONCE with the repeated text quoted back and an instruction to
  contribute or conclude, and a second repeat ends the run as the new
  `outcome.reason: "repetition"` — never as a decline, because nobody decided
  anything. Terminal turns are exempt (a turn that ends the negotiation cannot
  loop, and refusing one would turn a successful accept into a stall);
  message-less turns have nothing to duplicate. Deadlock detection (IND-428)
  could not cover this: its four-turn threshold arrives one turn before a
  six-turn cap, after the loop has already consumed the negotiation.
- **The unreachable-principal rule gains the move the corner actually needed.**
  `PRINCIPAL_UNREACHABLE_RULE` said never stall and never route the client's
  question to the other side, but named no move for the case that occurred: the
  COUNTERPARTY asks something client-authoritative that the record does not
  settle. The rule now says to state the limit of the record — "X's signal says
  Y; it does not specify further" is a complete answer — and to let the
  counterparty score that dimension unknown, never repeating or mirroring their
  question and never inventing an answer the record does not hold.
- **A decline needs a conflict.** The verdict law ("an unknown is not a reason to
  end anything; pass stays reserved for conflict") was prompt-only, and the prompt
  lost. A drafted `decline`/`reject` over an authored checklist that holds no
  `conflict` dimension is now refused — logged as `negotiation_decline_inadmissible`
  with the unknowns that stood in for one — and coerced to the conservative
  non-terminal fallback, its terminal message dropped with the action it belonged
  to. On the final turn, where the seat's vocabulary is accept-or-decline, the
  decline stands but the violation is recorded rather than manufactured silently.
  Assessing stances only; fails open on an unauthored checklist; `advocate` is
  untouched.

### Added

- `NegotiationOutcome.reason` gains `"repetition"`, and `NegotiationAgentInput`
  gains `antiEcho` (the repeated text, quoted back on a re-issue).
- `assessDeclineAdmissibility` in the checklist contracts: the verdict law as a
  pure function, beside `assessAskAdmissibility`.
- Machine-fault reasons (`agent_error`, `repetition`) are filtered out of the
  discovery vocabulary by an allow-list rather than a deny-list, so a new
  negotiation reason can never silently cross that boundary.

## 23.1.1 - 2026-08-19

### Fixed

- **A negotiation that has already spoken is no longer re-screened.** The outreach
  gate asks whether to make first contact, and `routeAfterInit` ran it on every
  continuation that was not an exact `ask_user` resume. An error-stalled negotiation
  recovered through `negotiation-run-existing` — the documented recovery path — was
  therefore re-screened two hours after its outreach landed; the gate passed, and an
  infrastructure failure plus its own recovery turned into a terminal `rejected`
  the counterparty was never given the chance to answer. Eligibility is now
  pre-contact, scoped to the negotiation (new `negotiationHasMadeContact`): a new
  opportunity reusing an existing `dm_pair` is still screened (IND-563), a
  screen-only or all-`ask_user` history is still pre-contact, and a persisted turn
  addressed to the counterparty ends the question for good.
- **A first-turn `withdraw` on a contacted continuation persists as a real
  retraction.** The IND-564 guard read `outreachOpened`, which is per-task, so a
  continuation of a negotiation whose outreach was sent in an earlier session was
  treated as never-contacted and routed to the quiet `screened_out` outcome. The
  guard now applies only where nothing was ever sent; a withdraw against a message
  the counterparty received is recorded as the move it is.
- **`screened_out` can no longer be stamped on a negotiation whose messages
  contradict it.** `finalizeNode` gates both routes to the label — the screen-node
  block and the opening-turn refusal — on the same pre-contact predicate, so the one
  outcome that claims nothing was ever sent is unfalsifiable at the point of record.

## 23.1.0 - 2026-08-19

### Fixed

- **Retrieval scores no longer clamp at a flat ceiling.** The multi-signal bonus in
  `mergeStrategyCandidates` was added to the raw similarity and then clamped
  (`Math.min(raw + boost, 1)`), so candidates found by enough strategies all landed
  on exactly 1.0. Candidates enter evaluation strictly by rank, so a head cluster of
  identical maxima crowded genuine matches out of the only evaluated batch. The bonus
  now consumes the headroom above the raw score (new internal
  `opportunities/opportunity.similarity.ts`): strictly monotone in the raw score,
  and 1.0 is reachable only by a vector that actually scored 1.0.
- **Evaluation continues past a batch that passes nothing.** `remainingCandidates`
  was written and never read — there was no second batch, so a run whose top-ranked
  candidates all failed reported `evaluator_rejected_all` while the real matches sat
  unevaluated behind them. The evaluation node now walks up to
  `MAX_EVAL_BATCHES_PER_RUN` (3) batches of 25 while no candidate passes, and stops
  as soon as one does.
- **A stranded tail is reported as a bound, not as a rejection.** When the batch bound
  is reached with candidates left, the trace carries an `evaluation_bound` node with
  the never-evaluated count.

### Changed

- **`invokeEntityBundle` under `returnAll: true` now returns dropped verdicts too**,
  tagged with `rejection: { candidateId, reason }` (`not_accepted` |
  `incomplete_actors` | `unsupported_claim`) and carrying no actors. Previously a
  candidate the model explicitly rejected, and one whose accepted verdict a guard
  dropped, were both indistinguishable from silence, and the discovery trace labelled
  every one of them "No evaluation returned for this candidate". Callers that
  persist must filter on `rejection === undefined`; `returnAll: false` is unchanged.

## 23.0.0 - 2026-08-19

### Added

- **The checklist negotiation core** (docs/plans/2026-08-19-checklist-negotiations.md
  §2–§4, §6). A negotiation under the assessing stances now runs on an explicit,
  pre-registered checklist: 3–5 dimensions authored on turn 1 from the two
  intents alone (`mutual_want` always present), frozen after, re-scored each
  turn from the commitment record, with the verdict a function of the scores.
  New domain module `negotiations/negotiation.checklist.contracts.ts` (exported
  from the package root): `NegotiationChecklistSchema`, `authorChecklist`,
  `reconcileChecklist`, `checklistFromTurns`, `checklistVerdictState`,
  `assessAskAdmissibility`, `renderChecklistSection`,
  `QUESTION_BUDGET_PER_PRINCIPAL`, `configuredQuestionBudgetPerPrincipal`,
  plus the DTOs in `shared/schemas/negotiation-checklist.schema.ts`.
- **`ask_user` payload**: optional `dimension` and `answerhood`
  (`{ ok_when, conflict_when }`). An ask names exactly one open dimension and
  declares in advance what answers score it — the pivotality proof. Both are
  optional, so v1 turns, external agents and the enum-only path validate
  unchanged.
- **Turn payload**: optional `checklist`, carried on every turn under the
  protocol. The turn record is the checklist's only store — no new tables, and
  a continuation recovers the frozen dimensions from the messages it already
  reads.
- **Question block**: optional `dimension` on a block question, the checklist
  dimension a park is about, for the step's label. Presentation only; routing
  is still the negotiation ref alone. Blocks without it parse unchanged, so the
  fail-closed parser stays backward-compatible.
- **Per-principal question budget**: at most `QUESTION_BUDGET_PER_PRINCIPAL`
  (3) questions per principal per negotiation, the turn-0 pre-contact consult
  included and post-stall parks counted. `countPrincipalAskUserTurns` exposes
  the count off the message record.

### Changed

- **BREAKING** — `ConsultationEligibilityInput.previouslyConsulted` is now
  `consultationBudgetSpent`: the one-consultation ration became a budget, and
  a ration of one is that budget with `total = 1`. Callers pass "this
  principal's budget for this negotiation is spent" instead of "they have
  consulted before".
- **Negotiator stance contracts restructured** around the checklist protocol.
  The evidence-provenance rule (#1448) is now the `basis` discipline — an
  agent's own conclusions are decisions, not commitments, so they cannot score
  a dimension — and the responder verification rules (#1446) are now the
  responding seat's scoring duty. Neither duty was dropped; both became rules
  about what may score a dimension, and the repair path enforces them (an `ok`
  with no basis is repaired to `unknown`). New predicate `stanceUsesChecklist`.
  `advocate` is untouched, prompt and generation schema alike — the golden
  prompt matrix still passes byte-for-byte.
- `negotiationAskRoundsCap()` takes `{ checklist }` and defaults to
  `CHECKLIST_NEGOTIATION_ASK_ROUNDS_CAP` (both principals' budgets plus one
  post-stall park) under the checklist protocol; the pre-checklist default
  stays 3. An explicit `NEGOTIATION_ASK_ROUNDS_CAP` still wins.
- `AskUserOpts` is now `TurnVocabularyOpts` (`{ askUser, checklist }`); the old
  name remains as a deprecated alias.

## 22.0.0 - 2026-08-18

### Removed

- **The QuestionerAgent generation half** (conversational-questions plan,
  "Retirements"). Questions are conversation: the parked negotiation is the
  durable record and the question-message in the signal's DM is its
  rendering, so the card generators go. Removed: `QuestionerAgent`,
  `question.presets`, the blocking chat `ask_user_question` tool and its
  `ChatQuestionsHost` bridge (with the `user_question` stream event and the
  `interactive` tool-timeout class), the per-mode generation envelope in
  `question.input` (the `QuestionerInput` union now admits only the two park
  families — `PostStallQuestionerInput` and `InflightQuestionerInput`) and
  `isValidQuestionerInputContract`, the pre-accept uptake interlock in
  `update_opportunity`, the intent graph's create-branch question enqueue,
  and the retired env accessors (`isQuestionerEnabled`,
  `isUptakeGuardEnabled`, `uptakeAuthorityThreshold`,
  `intentQuestionDailyCap`, `chatQuestionWaitTimeoutMs`).

### Changed

- The signal and onboarding personas interview in plain conversation: the
  guided New Signal intake drops its blocking question-card rounds, and its
  stage machine reduces to interview → complete (`create_intent` is the only
  remaining stage marker).

## 21.1.0 - 2026-08-18

### Added

- The **question block contract** for conversational questions
  (`docs/plans/2026-08-18-conversational-questions.md`):
  `QuestionBlockSchema`, `QuestionBlockQuestionSchema`,
  `parseQuestionMessage`, `serializeQuestionMessage`,
  `QUESTION_BLOCK_MARKER`, `QUESTION_BLOCK_VERSION` and the
  `QuestionBlock`/`QuestionBlockQuestion`/`ParsedQuestionMessage` types.
  The block is the rendering contract embedded as a terminal
  ` ```index-questions ` fenced section in the negotiator's question-message;
  the parser fails closed (malformed → `null` → render as plain text), and a
  question's identity is its primary `opportunityId` ref (negotiations have
  no table of their own) — there are no question ids and no block-level state.
- First package **subpath exports**, `@indexnetwork/protocol/question-block`
  and `.../question-block/fixture`, so the browser client can import the
  contract (and its canonical fixture) without pulling the node-only package
  root into a bundle. STABILITY.md now documents browser-safe subpaths as part
  of the public contract.

## 21.0.0 - 2026-08-17

### Removed

- **Breaking:** remove the Agent reporter persona. `REPORTER_PERSONA`,
  `REPORTER_PERSONA_ID`, `REPORTER_BRIEFING_KICKOFF`, `REPORTER_TOOL_NAMES`,
  `createReporterTools`, `filterReporterTools` and `narrowReporterTools` are
  gone from the package entry point, along with `reporter.persona.ts`,
  `reporter.prompt.ts` and the `propose_cleanup_actions` tool
  (`reporter.action.tools.ts`, `reporter.action.contracts.ts`). Hosts that named
  the `reporter` persona must pick another; unknown personas already fail closed.
- **Breaking:** drop `actionToolsEnabled` from `ToolContext`/`ToolDeps`/
  `ResolvedToolContext` and `actionProposalStore` from `ToolDeps`. Both existed
  solely to gate the reporter's cleanup-action tool. `resolveChatContext()` no
  longer accepts or returns `actionToolsEnabled`.
- Remove `ChatAgent.hasPriorAgentActionProposal()`, the
  ```agent_action_proposal``` fence parser behind it, and
  `IterationContext.hasPriorAgentActionProposal`. The reporter prompt was the
  only consumer, so all of it became dead with the persona.

`read_activity_summary` and the whole `activity-projection` module are
**unchanged** — they are shared utility tools registered for every persona and
exposed on the MCP server, not reporter-specific.

## 20.0.1 - 2026-08-17

### Changed

- Flatten `src/questions/` from four directories to one, matching the same move
  already made in `intents/` and `networks/`, and the flat layout of `chat/`,
  `discovery/`, and `premises/`. The `domain/`, `ports/`, and `application/`
  directories held two,
  two, and six files behind 206 lines of re-export barrel; the three sub-barrels
  re-exported roughly twenty symbols no consumer outside the capability ever
  imported. Files now sit flat and are named for what they are
  (`question.schema`, `question.input`, `question.agent`, `question.presets`,
  `question.env`, `question.tools`, `question.ask.tool`, and the two ports), with
  a single `index.ts` as the capability barrel.
- Fold the QUD taxonomy constant into `question.presets.ts`, its only consumer,
  retiring the 16-line `question.qud.ts`.
- Share the negotiation candidate/provenance field shape and their identical
  counterparty-eligibility refinement instead of declaring both twice. The two
  `superRefine` blocks stated the same uptake-only rule in different words; they
  now delegate to one helper, so the invariant has a single definition.

The package's exported surface is unchanged — `questions/index.ts` exports the
same 44 names as before. Only paths private to the capability moved.

## 20.0.0 - 2026-08-17

### Changed

- **BREAKING**: The communities capability ships as one class, `Networks`,
  mirroring `Intents`. `NetworkGraphFactory`, `NetworkMembershipGraphFactory`
  and `IntentNetworkGraphFactory` are no longer exported from the package root;
  construct `new Networks({ database, indexer })` and call `createGraph()`,
  `createMembershipGraph()` or `createAssignmentGraph()`. `createNetworkTools`
  is now `Networks.createTools`. Graph behaviour is unchanged.

  ```typescript
  // before
  const indexGraph = new NetworkGraphFactory(database).createGraph();
  const membershipGraph = new NetworkMembershipGraphFactory(database).createGraph();
  const assignmentGraph = new IntentNetworkGraphFactory(database, intents).createGraph();

  // after
  const networks = new Networks({ database, indexer: intents });
  const indexGraph = networks.createGraph();
  const membershipGraph = networks.createMembershipGraph();
  const assignmentGraph = networks.createAssignmentGraph();
  ```

- `networks/` is flat: the `application/`, `domain/` and `ports/` directories are
  gone, and `network.module.ts` is the capability's only public surface.
  `NetworkToolDeps` now comes from that module rather than
  `networks/ports/communities.tools.port.ts`, and the narrowed indexer port is
  exported as `IntentNetworkIndexer`.

## 19.0.0 - 2026-08-17

### Removed

- **BREAKING**: Retire ghost users. `softDeleteGhost`, `mergeGhostUser` and
  `findDuplicateUser` are gone from the database port, along with `isGhost` on
  every entity, contact payload, member row and opportunity card.
- **BREAKING**: Remove `shouldEnrichGhostDisplayNameFromParallel` and
  `isEnrichedNameMeaningful` (and the `enrichment.enricher` module). Both were
  ghost-only: the first returned `false` for every real account.
- **BREAKING**: `buildMinimalOpportunityCard` loses its trailing
  `isCounterpartGhost` parameter and the `isGhost` field on its result. The
  primary action label was never derived from it — it reads `viewerRole` alone —
  so labels are unchanged.

### Changed

- The enrichment graph no longer soft-deletes or merges on the ghost paths. A
  non-human enrichment result still aborts with `"Non-human entity detected"`;
  it previously also called `softDeleteGhost`, which the host implemented as a
  no-op for any non-ghost, so behaviour for real accounts is identical.
- Low-confidence and failed enrichment now always fall through to basic info.
  That was already the real-account path; only the ghost early-return is gone.

## 18.0.0 - 2026-08-17

### Changed

- **BREAKING**: The `intents` capability now ships as a single class. `Intents`
  replaces `IntentGraphFactory`, `SemanticVerifier`, `IntentIndexer`,
  `SignalIntakePackGenerator`, `SignalIntakeOrchestrator`,
  `normalizeIntentDescription`, and `FALLBACK_WHO_QUESTION`, all of which are
  no longer exported. Dependencies move from positional constructor arguments
  to a named `IntentsDeps` bag, and every field is optional — a host that wants
  only the model-backed helpers can call `new Intents()`.

  | Removed | Replacement |
  |---|---|
  | `new IntentGraphFactory(db, embedder, queue, enqueue).createGraph()` | `new Intents({ database, embedder, queue, questionerEnqueue }).createGraph()` |
  | `new SemanticVerifier().invoke(content, context)` | `new Intents().verifyIntent(content, context)` |
  | `new IntentIndexer().invoke(...)` / `.evaluate(...)` | `new Intents().indexIntent(...)` |
  | `new SignalIntakePackGenerator().generate(input)` | `new Intents().generateIntakePack(input)` |
  | `new SignalIntakeOrchestrator().generateFollowUps(input)` | `new Intents().generateIntakeFollowUps(input)` |
  | `new SignalIntakeOrchestrator().synthesize(input)` | `new Intents().synthesizeIntake(input)` |
  | `normalizeIntentDescription(text)` | `Intents.normalizeDescription(text)` |
  | `FALLBACK_WHO_QUESTION` | `Intents.FALLBACK_INTAKE_QUESTION` |

  Collaborators are constructed on first use rather than in the constructor, so
  an unused method costs nothing. `new Intents()` no longer touches the model
  provider at all — code that relied on construction failing without
  `OPENROUTER_API_KEY` now fails on the first call instead.

- **BREAKING**: `IntentNetworkGraphFactory`'s second argument is now an
  `Intents` instance (anything with `indexIntent`) rather than an
  `IntentIndexer`. Pass the same instance used for the intent graph.

- Reorganize `src/intents/` by function rather than by layer, with
  `intent.module.ts` as the capability barrel in place of `index.ts`. Files are
  named for what they do and sit flat (`intent.inferrer`, `intent.verifier`,
  `intent.indexer`, …); only `graph/` and `intake/` — the two multi-file stages
  — keep a directory. The layout is private; only `Intents` crosses the
  boundary.
  `IntentIndexerOutput`, `IntakePack*`, `Intake{Answer,Round}`, `FollowUpPlan*`,
  `Synthesis*`, `IntentToolDeps`, and `IntentsDeps` remain exported as types.

## 17.0.1 - 2026-08-17

### Removed

- Remove `src/architecture/tests/` (`capability-barrels`, `package-entry`,
  `execution-matrix`). These asserted that source files contain particular
  strings — including the wording of `capability-boundaries.ts`'s own violation
  messages — and duplicated the model assertions already in
  `scripts/architecture/tests/capability-model.spec.ts`. Enforcement is
  unchanged: `architecture:host-isolation` and `architecture:capabilities` walk
  the real import graph and are what the CI gate depends on. `test:architecture`
  now runs `scripts/architecture/tests` only.

## 17.0.0 - 2026-08-17

### Removed

- **BREAKING**: Remove the `integrations` capability entirely
  (`src/integrations/`) and its public exports: `IntegrationAdapter`,
  `IntegrationConnection`, `IntegrationSession`, `IntegrationSessionOptions`,
  `ToolActionResponse`. Hosts that typed a Composio adapter against these
  should declare the shape locally — `services/api` already carries a
  structurally identical copy in `adapters/integration.adapter.ts`.
- **BREAKING**: Remove `generateInviteMessage` (and `InviteInput` /
  `InviteOutput`). It generated outreach copy for ghost-user counterparts and
  required `recipient.isGhost`; with ghost users retired it can never fire.
- **BREAKING**: Remove the `import_gmail_contacts`, `import_contacts` and
  `add_contact` tools. These were the only paths that minted ghost users.
  Contacts are now established solely by accepting an opportunity, which writes
  the mutual `contact` memberships. `list_contacts`, `remove_contact` and
  `search_contacts` are unchanged.
- **BREAKING**: Remove `contactsEnabled` from `ToolDeps`, the tool-registry
  composition deps, and `resolveChatContext`. The `CONTACTS_ENABLED` flag gated
  only the removed write paths and no longer exists.
- **BREAKING**: Remove `integration` and `integrationImporter` from `ToolDeps`.
  Nothing in the protocol consumed them once the integration tools were removed.
- Remove `createGhostUser` from the database interface. No protocol code path
  creates users any more.

### Changed

- `ContactServiceAdapter` narrows to `listContacts` / `removeContact` /
  `searchContacts`; `importContacts` and `addContact` are gone, along with the
  `ContactInput`, `ContactResult` and `ContactImportResult` domain types.
- Orchestrator, negotiator, signal and onboarding prompt surfaces no longer
  advertise contact import or Gmail import.

## 16.1.0 - 2026-08-17

### Removed

- Remove the eval harnesses (`eval/`) and the 13 `eval:*` package scripts. No
  public API change: `src/` never imported `eval/`, so the package build,
  architecture gates and source tests are unaffected. The final state is
  preserved in the `archive/eval-2026-08-16` tag; restore with
  `git checkout archive/eval-2026-08-16 -- packages/protocol/eval`.

## 16.0.0 - 2026-08-17

### Removed

- **Breaking:** MCP no longer gates on web/CLI onboarding. Incomplete
  onboarding does not restrict the MCP inventory, `onboarding_human` and
  `onboarding_required` are gone, and `complete_onboarding` is omitted from
  the MCP registry. `read_user_contexts` no longer returns
  `onboardingComplete` on MCP. Web onboarding chat and the REST Tool API
  keep the existing completion flow.

## 15.0.0 - 2026-08-17

Public-surface prune. `src/index.ts` goes from 443 exported symbols across 164
export statements to 312 across 143. No implementation changed: every removed
symbol still exists and still works inside the package — it is simply no longer
re-exported from the barrel.

A symbol was kept whenever a retained export could not be *used* without it —
parameter and member types of exported functions, interfaces, and unions stay
public even with no direct importer, because an exported symbol whose members
cannot be named is not usable.

The removal set was derived by parsing every barrel export and resolving it
against every consumer reference in `services/`, `apps/`, `packages/*`,
`docs/`, `.claude/`, and the protocol's own `eval/` and `skills/` trees —
covering static named imports, `import type` queries, `import('...').Sym` type
positions, `await import()` destructuring, namespace aliases, and `mock.module`
shapes. A symbol was removed only when nothing outside the package imported it
from the package root.

### Removed from the public API (BREAKING)

131 symbols. None were deleted; all remain internal. The largest groups:

- **Capability tool factories** — `createChatTools`, `createAgentTools`,
  `createIntentTools`, `createNetworkTools`, `createOpportunityTools`,
  `createNegotiationTools`, `createQuestionerTools`,
  `createAskUserQuestionTools`, `createContactTools`, `createIntegrationTools`,
  `createPremiseTools`, and their `*ToolDeps` types. These are composed
  internally by `createMcpServer` / `createToolRegistry`, which remain public.
  `createEnrichmentTools` and `EnrichmentToolDeps` stay exported — the API
  service calls them directly from its enrichment-run worker.
- **MCP authorization policy** — 27 symbols from `mcp/mcp.authorization-policy.ts`
  (`MCP_AGENT_ADMIN_TOOLS`, `McpCapabilityPolicy`, `McpToolAccessRuleSchema`,
  `defineMcpToolAccessRules`, the `Mcp*` policy types, …). Four stay public
  because a host cannot type its own `createMcpServer` call without them:
  `CANONICAL_MCP_CAPABILITY_POLICY_OPTIONS`, `McpCapabilityPolicyOptions` (the
  fourth parameter), `McpAuthorizationObserver`, and
  `McpAuthorizationDenialEvent` (the observer callback's only argument).
- **Activity projection** — 15 symbols from `shared/agent/activity-projection.ts`
  (`projectActivitySummary`, `ActivitySummaryResponseSchema`,
  `QUESTION_MODE_TO_DOMAIN`, `READ_ACTIVITY_SUMMARY_TOOL_NAME`, …).
- **Persona helpers** — the `filter*Tools` / `narrow*Tools` helpers, the
  `*_TOOL_NAMES` constants, and the `SIGNAL_NEW_SIGNAL_KICKOFF` /
  `ONBOARDING_PROFILE_KICKOFF` constants. The persona IDs, the prompt
  constants, and `REPORTER_BRIEFING_KICKOFF` stay — `apps/web` imports the
  latter.
- **Discovery env accessors** — `discoveryAllowedTypes`, `discoveryMinSimilarity`,
  `discoveryProfileSource`, `discoveryIntentMatchingEnabled`,
  `discoveryProfileMatchingEnabled`, the `validate*` helpers, and the
  `DISCOVERY_*_DEFAULT` constants. `discoveryEvaluatorMinScore` stays: its one
  importer is `services/api/src/cli/discovery-env-matrix.main.ts`. That CLI is
  slated for removal with the eval harnesses, and this accessor should be
  pruned in the same change. These back live Railway configuration and are
  unchanged in behaviour; only the re-export is gone.
- **Signal-intake types** — `IntakePack`, `IntakePackInput`, `SynthesisInput`,
  `SynthesisResult`, `FollowUpPlan`, `answerLabel`, `normalizeIntakePack`, …

Two of the removed symbols (`createAgentTools` and
`CANONICAL_MCP_TOOL_ACCESS_RULES`) are referenced by `services/api` tests
through deep source paths rather than the package root, so those tests are
unaffected by the barrel change.

### Changed

- `IMPLEMENTATION.md` §1 no longer documents a `modelConfig` override on
  `ToolDeps` — that field does not exist there. `modelConfig` lives on the
  internal `ToolContext` / `ProtocolDeps` composition, which is not exported, so
  the section now documents the environment variables as the supported
  configuration path and states plainly that programmatic override is outside
  the public contract.
- `IMPLEMENTATION.md` §3 now documents `createMcpServer` and
  `createToolRegistry` + `invokeToolRuntime` as the supported tool entry points,
  replacing the `createChatTools` walkthrough.
- `STABILITY.md` — the **Capability tools** tier now covers
  `createEnrichmentTools` only; the **Public API** row names `createToolRegistry`
  and corrects `ToolContext` to the actually-exported `ResolvedToolContext`.

### Migration

Hosts composing tools by capability should call `createMcpServer` (full MCP
server, policy applied) or `createToolRegistry` (raw handler map, invoked via
`invokeToolRuntime`). Both take the same dependency object the individual
factories did.

## 14.3.2 - 2026-08-16

No source change. The public contract in `src/index.ts` is untouched; only
non-shipped tooling was removed.

### Removed

- `architecture/exports.snapshot.json`, the `architecture:exports` and
  `check:exports` scripts, and `scripts/architecture/export-inventory.ts`.
  `check:exports` is gone from `architecture:check` and from the CI lint job.

  The inventory was fully derived from `src/index.ts` as of 14.3.1, so
  `check:exports` could not catch a genuine defect — only a missed regenerate.
  Its remaining value was making stable-export removals visible in a PR diff,
  and that is now a review responsibility: consult [STABILITY.md](./STABILITY.md)
  when changing the barrel, because nothing mechanical will flag a major bump.

  The snapshot was never published (`files` covers `dist`, `IMPLEMENTATION.md`,
  `STABILITY.md`, `CHANGELOG.md`), so no consumer is affected.

- `scripts/architecture/module-graph.ts` and its spec. Its only non-test caller
  was the deleted protocol atlas generator. `capability-model.ts` is unaffected —
  `capability-boundaries.ts` and the `src/architecture` specs still use it.

## 14.3.1 - 2026-08-16

No source change. Tooling and release record only.

### Added

- `bun run architecture:exports` generates `architecture/exports.snapshot.json`
  from `src/index.ts`, and `bun run check:exports` reports drift and exits
  non-zero. `check:exports` is now part of `architecture:check`, which CI runs.

  The inventory is read by `scripts/build-protocol-atlas.ts` as the export
  inventory, but that only validates the subset in `ROOT_EXPORT_COMPONENTS` —
  the other ~380 entries were hand-maintained, which is how 300 of them came to
  point at directories renamed in 14.2.1. The generator derives `name`, `kind`,
  and `source` from the entry point, so that class of drift cannot recur.

  `stability` is the one field that is not mechanical: `src/index.ts` groups its
  re-exports under banner comments, and a section carrying a standalone
  `@experimental` line is experimental until the next banner. Two traps that
  cost a wrong first implementation each are covered by tests — the file header
  explains the tiering in prose ("Sections marked `@experimental` below"), which
  must not match, and the marker scopes to its own section rather than to the
  rest of the file.

  Anything the inventory cannot describe — a bare `export *`, a locally
  declared export, a re-export with no module specifier — raises rather than
  being skipped. Silently dropping one means `check:exports` reports "matches"
  while the public surface has grown unrecorded, which is the failure the
  inventory exists to prevent. `export * as ns from` is representable and is
  recorded as the single name it introduces.

  Drift is compared positionally, not by set membership: the inventory mirrors
  declaration order, so reordering or duplicating an entry is real drift that a
  set comparison reports as an empty diff above a "stale" error.

  Verified by reproducing the committed inventory byte-for-byte, all 443
  entries.

### Fixed

- Backfilled the missing `14.0.0` CHANGELOG section. That release shipped in
  #1402 and bumped `package.json` without a changelog entry, so the record
  jumped 13.2.1 → 14.1.0 with a breaking change unrecorded in between.

## 14.3.0 - 2026-08-16

No public API change: all 443 exported symbols are byte-identical to 14.2.2.

### Changed

- Promoted `shared/hyde/` to a `discovery/` capability — 9 source files and 7
  specs. HyDE owns a graph, a generator, a lens inferrer, and a validator; that
  is discovery machinery, not shared infrastructure. It lived under `shared/`
  because two capabilities needed it, which had made `shared/` the default home
  for anything with more than one consumer.

  `discovery/index.ts` is its sole cross-capability surface, carrying the 41
  symbols that actually cross the boundary. `contexts` and `opportunities` now
  reach it through that barrel; the tool composition root keeps its direct leaf
  imports, as it is exempt by design and as a barrel import there is what caused
  the runtime cycle in 14.2.0.

- `HydeGraphFactory`, `HydeGenerator`, and `LensInferrer` are re-exported from
  the root barrel via `discovery/index.js` rather than `contexts/index.js`, and
  the `contexts` barrel no longer carries them. The exported names are
  unchanged; only the internal path moved.

- Declared the directions this makes explicit: `contexts → discovery`,
  `opportunities → discovery`, and `discovery → agents` (HyDE stamps a
  debug-metadata type onto its graph state). 25 named directions became 29.

### Note

The rest of the `shared/` rehoming was considered and rejected on evidence.
`shared/assignment/` is used by `networks` *and* `premises`, and
`shared/network/metadata.renderer` by `networks` *and* `opportunities` — so
moving either into `networks/` would create `contexts → networks` and
`opportunities → networks`, neither of which is an allowed direction. They are
in `shared/` precisely because two capabilities need them and neither owns them;
moving them would add edges to the capability graph rather than remove them.

`shared/agent/` mixes the composition root with model primitives and is a
genuine split candidate, but it has 140 importers across 15 capabilities and
`tool.factory` is the module that produced the 14.2.0 cycle. Left alone
deliberately. What remains under `shared/` — `interfaces/`, `observability/`,
`schemas/`, `utils/`, and `agent/` — spans 5 to 15 capabilities each and is
correctly neutral.

## 14.2.2 - 2026-08-16

No public API change: all 443 exported symbols are byte-identical to 14.2.1.
Test layout only; no test changed meaning.

### Changed

- One `tests/` directory per capability. Six directories nested a level deeper
  (`intents/application/tests`, `opportunities/{discriminator,outcome,negotiation-evidence}/tests`,
  `questions/{domain,ports}/tests`) merged into their capability's own, taking
  the nested count from 13 to 7 and the total from 27 to 21.

  The seven that remain are all under `shared/`, which has no capability root —
  merging them would produce a single 40-file directory mixing model config,
  HyDE, schemas, and observability. One `tests/` per shared module is the
  consistent reading of the same rule there.

- Moved the two specs that sat outside any `tests/` directory
  (`opportunities/delivery-card.cache.spec.ts`, `shared/agent/model-signal.spec.ts`)
  into their module's `tests/`.

- Renamed the four `.test.ts` files to `.spec.ts`, against 211 already using
  that suffix. The runner still discovers both, so this is convention only.

### Removed

- All 12 test `tsconfig.json` files. They were **not** load-bearing: 9 of the 21
  `tests/` directories never had one, and the build, the isolated test runner,
  and `tsc` all pass without them — the build excludes tests by both
  `**/tests/**` and `**/*.spec.ts`, and Bun does not read them.

  `networks/tests/tsconfig.json` had been extending `../../tsconfig.json`, which
  resolves to `src/tsconfig.json` and does not exist — `tsc` reports TS5083 and
  silently falls back to defaults, dropping `esModuleInterop`. It had been
  broken with nothing to notice.

### Note

Colocating every spec beside its subject was considered and rejected on
evidence: only 155 of 215 specs (72%) name a single source module. The other 60
are cross-module behaviour tests — `negotiation.continuation.spec.ts`,
`introducer-gating-lifecycle.spec.ts`, `negotiation.seat-rules.spec.ts` — and
filing those next to one arbitrary module they partly exercise would be worse
than leaving them grouped.

## 14.2.1 - 2026-08-16

No public API change: all 443 exported symbols are byte-identical to 14.2.0.
Directory names only.

### Changed

- Renamed capability directories so each one is named for what the code inside
  it actually says. `Intent*` appears 2,624 times in `src/` against 494 for
  `Signal*` — and roughly half of those are `AbortSignal` — while `Network*`
  appears 1,988 times against 23 for `Communit*`. Every load-bearing surface
  already used intent/network: MCP tool names (`create_intent`, `read_networks`),
  database tables (`intents`, `networks`, `intent_networks`), and exported
  symbols (`IntentGraphFactory`, `NetworkGraphDatabase`). The folders were the
  outlier.

  | before | after |
  |---|---|
  | `signals/` | `intents/` |
  | `communities/` | `networks/` |
  | `opportunity/` | `opportunities/` |
  | `negotiation/` | `negotiations/` |
  | `premise/` | `premises/` |
  | `participant-agents/` | `agents/` |
  | `participant-context/` + `context/` | `contexts/` |

  Capability directories are now uniformly plural, and each one's file prefix
  matches its folder (`intents/application/intent.graph.ts`).

- The capability identifiers in `scripts/architecture/capability-model.ts`
  follow: the 25 named directions now read `intents → questions`,
  `opportunities → negotiations`, and so on. Dead alias entries for directories
  that no longer exist were removed.

### Removed

- The six orphaned test directories, which held tests whose subjects had moved
  away in earlier phases: `intent/` (13 files), `questioner/` (6), `network/`
  (6), `contact/` (4), `agent/` (2), `integration/` (1). Each is absorbed into
  its capability's own `tests/`, along with the redundant per-directory
  `tsconfig.json` files that duplicated one already present.

## 14.2.0 - 2026-08-16

No public API change: all 443 exported symbols are byte-identical to 14.1.0.
This is internal structure only.

### Removed

- Removed `src/capabilities/` — 24 files. Twenty-one were `*.facade.ts`
  re-export shims (several two lines long, one with a single caller) and three
  were `*.tools.port.ts` port definitions misfiled into a facade directory. The
  ports moved into their capability's `ports/`.
- Removed the nine per-capability `public/index.ts` barrels. Three of them
  (`signals`, `communities`, `opportunity`) already had zero importers.

### Changed

- **Each capability's `index.ts` is now its sole cross-capability surface.**
  What used to be three hops — `capabilities/X.facade.ts` → `X/public/index.ts`
  → `X/{domain,application,ports}` — is now one. The barrels carry the union of
  the facades they replace, so the contract is unchanged.
- The boundary rule collapses to one sentence: *a capability may reach another
  capability only through that capability's `index.ts`*. `capability-boundaries.ts`
  checks it from the import path alone; `barrelCapabilityForSourcePath` replaces
  `facadeCapabilityForSourcePath`, and `CAPABILITY_BARREL_DIRECTORIES` names the
  one directory that owns each capability's barrel.
- Replaced `architecture/tests/capability-facades.spec.ts` with
  `capability-barrels.spec.ts`, which asserts one barrel per capability, no
  `export *`, and that the facade layer does not return.

### Fixed

- Broke a runtime import cycle the barrels would otherwise have introduced.
  `shared/agent/tool.factory.ts` reached `createAgentTools` through
  `participant-agents/index.ts`, which re-exports the chat personas, which
  import the tool factory back. The composition root is exempt from the barrel
  rule precisely because it must reach everything, so it now imports the leaf
  directly. Verified: zero runtime cycles, matching `dev`.
- Moved two leaf contracts out of the capabilities that happened to host them,
  into the neutral layer both sides already depend on:
  - `opportunity/domain/opportunity.claim-safety.ts` → `shared/utils/claim-safety.ts`
    (three pure text predicates, no imports of its own). `negotiation` and
    `contacts` needed it and were pulling the whole opportunity capability.
  - `UnderspecificationTypeSchema` → `shared/schemas/underspecification.schema.ts`.
    The signals clarifier was importing the entire questions capability — LLM
    agents and tools included — to reach a three-value enum.

- `CAPABILITY_DIRECTORIES` mapped `questioner` but not `questions`, so every
  file under `src/questions/` was skipped by the capability boundary checker
  entirely. Adding the mapping surfaced six real violations that had been
  invisible: five imports reaching `questions/domain/question.schema.js`
  directly, and an undeclared `participant-agents → questions` dependency
  (`chat/` uses the question schemas). The imports now go through
  `questions/index.ts` and the direction is declared — 24 named directions
  became 25.

## 14.1.0 - 2026-08-16

### Added

- `intentQuestionDailyCap()` env accessor plus the `INTENT_QUESTION_DAILY_CAP_DEFAULT`
  (2) and `INTENT_QUESTION_DAILY_WINDOW_HOURS` (24) constants, exported from the
  questions capability. These express a per-intent budget for background
  refinement questions over a rolling 24 hours, spanning the recovery and
  pool-discovery families combined.

  Zero is a meaningful setting — it disables background refinement without
  touching `QUESTIONER_ENABLED` — so the accessor deliberately does not reuse
  `positiveIntEnv`. Configured by `QUESTIONER_INTENT_DAILY_CAP`.

## 14.0.0 - 2026-08-15

Backfilled. This release shipped in #1402 and bumped `package.json` without a
CHANGELOG section, so the record jumped 13.2.1 → 14.1.0. Reconstructed from the
commit (`225425371d`) rather than from memory.

### Removed

- **BREAKING**: retired the pre-personafication `orchestrator` chat persona.
  `ORCHESTRATOR_PERSONA_ID` and `ORCHESTRATOR_PERSONA` are gone from the package
  surface, and `ChatGraphFactory` and `ChatAgent.create()` now require a persona
  — there is no default to fall back on, and unknown values fail closed.

  Production evidence at the time: the orchestrator had written no new session
  since 2026-08-04, and the presence of `onboarding`-persona rows showed the
  Signal cutover flag was already on. The 9,464 historical orchestrator
  conversations remain readable.

## 13.2.1 - 2026-08-16

No public API change: all 441 exported symbols are byte-identical to 13.2.0, and
`src/index.ts` is untouched. This is internal structure only.

### Removed

- Removed the IND-543 outer shells — `src/public/`, `src/platform/`,
  `src/runtime/foreground/`, and `src/runtime/background/`. All four were
  declaration-only placeholders with zero inbound imports; `runtime/background`
  and `public` consisted of nothing but a header comment. The only thing
  referencing them was a spec asserting that they existed.
- Removed eight unused capability barrels (`signals/index.ts`,
  `communities/index.ts`, `contacts/index.ts`, `questions/index.ts`,
  `opportunity/index.ts`, `negotiation/index.ts`, `integrations/index.ts`,
  `participant-agents/index.ts`). Each was `export * from "./public/index.js"`
  with no importers — every real consumer already went to `public/` directly.
- Removed `src/shared/ui/`, which contained no source, only a `tests/tsconfig.json`.
- Removed the `ambient-background`, `neutral-platform`, and
  `public-compatibility` capability classifications, which existed solely to
  describe the deleted shells.

### Changed

- Resolved the tool-composition shim inversion. `tool.registry.ts` and
  `tool.factory.ts` were implemented in `runtime/foreground/composition/` and
  re-exported from `shared/agent/` through modules marked `@deprecated` — but
  all 25 importers used the deprecated path. The implementations now live at
  `shared/agent/tool.registry.ts` and `shared/agent/tool.factory.ts`, and the
  indirection is gone. `mcp.server.ts` was the one direct consumer of the old
  location and now resolves to the same single home.
- `signals/application/intent.tools.ts` is imported directly by the tool
  factory; the `runtime/foreground/signals/intent.tools.ts` pass-through
  re-export that sat between them is removed.
- Replaced `architecture/tests/runtime-shells.spec.ts` with
  `architecture/tests/package-entry.spec.ts`, which asserts the invariants that
  outlived the shells: `src/index.ts` is the sole `package.json` export, and the
  tool composition root has exactly one implementation.

## 13.2.0 - 2026-08-16

### Added

- `retired_mode` to `QuestionVoidedReasonSchema`, marking rows whose generating
  mode was removed. Written only by the one-time
  `0127_dismiss_retired_discovery_questions` migration — no runtime path emits
  it, since a retired mode produces nothing by definition. The marker makes the
  cleanup auditable and exactly reversible.

## 13.0.0 - 2026-08-13

### Removed

- **BREAKING**: removed the `discovery` and `enrichment` question modes from
  `QuestionModeSchema`. Neither had a reachable producer — the inline
  `questionGenerator.generate()` call site did not exist anywhere in the
  repository, and `EnrichmentGraphFactory` accepted a `questionerEnqueue`
  dependency it never invoked. Production confirms both stopped emitting
  (newest `discovery` row 2026-07-09, newest `enrichment` row 2026-06-15).
- **BREAKING**: removed the `QuestionGeneratorReader` port,
  `question.generator.port.ts`, `question.discovery.prompt.ts`, the
  `DiscoveryQuestionInput` composite type, and the `DiscoveryContext` /
  `ProfileContext` questioner contexts.
- **BREAKING**: removed the `questionGenerator` dependency from
  `ToolRegistryCompositionDeps` and `OpportunityToolDeps`.
- Removed the `QUESTIONER_DISCOVERY_ENABLED`, `QUESTIONER_DISCOVERY_INPUT_MODE`,
  and `QUESTIONER_DISCOVERY_TIMEOUT_MS` env accessors.
- Dropped the unused `questionerEnqueue` constructor parameter from
  `EnrichmentGraphFactory` (positional — callers passing it must drop the arg).

### Changed

- `SELF_OWNED_MODES` narrows from `["enrichment", "intent", "discovery"]` to
  `["intent"]`, which also narrows the reporter persona's
  `read_pending_questions` mode filter.
- `QUESTION_MODE_TO_DOMAIN` deliberately **retains** its `enrichment` and
  `discovery` entries. Rows created before this release remain readable and
  answerable, and dropping the mapping would fall back to the `chat` domain and
  change which permission an agent needs to answer a pre-existing row.

## 11.2.1 - 2026-08-11

### Added

- Added the guarded historical-quality runtime for single-configuration,
  dual-trigger shared-pool evaluation.

### Fixed

- Hardened historical-quality readiness with attested database credentials,
  frozen embedding requests, and fail-closed protected-base refresh gating.

## 10.2.0 - 2026-08-10

### Changed

- Refined the canonical V2 historical-quality artifact contract so execution
  completeness is independent of verdict availability: complete filtered
  case/trigger selections are valid descriptive evidence with
  `completeness.complete: true` and
  `measurement.qualityVerdictAvailable: false`; only complete full-corpus,
  full-trigger selections may publish a quality verdict. Legacy and canonical
  parser selection remain unchanged.

## 10.1.0 - 2026-08-07

### Added

- Added the independently reviewed 25-participant historical shared-pool contract, single-configuration dual-trigger pilot planner, descriptive stage-funnel metrics, and strict execution-completeness artifact schema for IND-638A.

## [Unreleased]

### Changed
- Behaviour-neutral internal refactor (16.1.1): split the six largest modules and hoist every graph node to a top-level function. The opportunity graph is now the discovery pipeline only — its eight non-pipeline modes (read, update, delete, send, negotiate_existing, approve_introduction, and the two introduction stages) are plain functions on `OpportunityGraphFactory` instead of `operationMode` conditional-edge routing. `database.interface.ts` becomes a barrel over entity, query-group, and capability-view modules; every `Pick<Database, ...>` resolves as before. The opportunity presentation cluster is one module. `opportunity.graph.ts` 4167 → 250 lines, `database.interface.ts` 2925 → 17, `negotiation.graph.ts` 1619 → 111, `opportunity.tools.ts` 1200 → 354, `enrichment.tools.ts` 1198 → 178, `intent.graph.ts` 1091 → 174. No public export, feature flag, or environment variable changed.
- Move the opportunity-presentation review checklist into `src/opportunity/AGENTS.md` and repoint the `opportunity.safe-presentation.ts` and `discriminator.adjustments.ts` comments at it. Comment-only; no runtime change.

### Removed

- **Breaking (14.0.0):** remove the `orchestrator` chat persona. `ORCHESTRATOR_PERSONA_ID` and `ORCHESTRATOR_PERSONA` are gone from the public API, and the orchestrator system prompt (`buildSystemContent`) and its conditional prompt-module registry are deleted. `ChatPersonaLoopBehaviors.hallucinationRecovery` is retained — it is opted into by the onboarding, signal and negotiator personas, not just the removed one.
- Remove the never-emitted `question_generator_start` / `question_generator_end` stream events and the `DebugMetaDiscoveryQuestions` debug payload, which had no producer.

### Changed

- **Breaking:** `ChatGraphFactory` and `ChatAgent.create()` now require a `ChatPersonaConfig`. There is no default persona; callers name the persona they drive.
- `DebugMetaOrchestratorNegotiations` keeps its name and wire key deliberately. It is read back out of persisted message debug metadata, so renaming it would drop the negotiation pointer for every historical message. It is populated for every persona whose tools can start a negotiation, not only the persona it is named after.

### Changed

- The eval ops sign-in callback accepts only the `api_key` field (protocol
  12.1.0); the legacy `session_token` fallback name was removed together with
  the web cli-auth v1 contract.
- Keep canonical `get_enrichment_run` and `cancel_enrichment_run` in the fast
  runtime timeout class after retiring their profile-run aliases.

### Removed

- Remove the seven deprecated REST/chat `*_user_profile` and `*_profile_run`
  tool aliases. Canonical `*_user_context` and `*_enrichment_run` tools remain;
  the aliases were already absent from MCP, and current first-party clients use
  the canonical names. This is a breaking direct Tool API change and is recorded
  as protocol 12.0.0.

### Added
- Full standalone Hermes capability policy (11.2.0): the `hermes-agent` principal has an explicit six-action MCP/REST policy while the existing `hermes-negotiator` principal remains restricted to its four scheduled negotiation handlers. Both policies default deny and preserve one-shot, generation-fenced negotiation authority.

### Security
- The Hermes policy never exposes owner credentials, account-security, credential/permission/agent administration, billing, or unclassified tools; connector and owner-native callers receive only nonsecret response projections.

### Removed
- Remove six unsupported shared interface/schema forwarding shims after migrating repository consumers to capability-owned domain and port modules; stable package-root exports remain unchanged.
- Remove six unsupported tool-port forwarding shims and the deprecated unused discovery-question mapper; stable package-root exports remain unchanged.
- Remove the onboarding privacy-consent layer (10.0.0). The
  `record_onboarding_privacy_consent` tool is gone from the tool registry, the
  onboarding persona/prompt, the MCP authorization matrix and onboarding
  allowlist, and the MCP onboarding-gate instructions. `preview_user_context`
  no longer gates EdgeOS/event data on recorded consent, and staged profile
  seeds are used without an import-consent check. The
  `OnboardingPrivacyState` / `PrivacyConsentDecision` / `PrivacyConsentSource`
  types and the `onboarding.privacy` field are removed from the database
  interface; leftover `privacy` values in stored onboarding JSON are ignored.
  Major bump: removes a public tool and exported types. Enrichment opt-in/opt-out
  moves to a separate service, defined per implementation/application.
- Remove public profile lookup from `preview_user_context` (10.0.0). The
  `allowPublicLookup` parameter, the `publicLookup` identity-check block, and
  the `edgeosProfileText` pass-through parameter are gone; the preview draft is
  built only from explicit text, server-staged signup/import seeds, and
  user-provided social URLs. Public profile lookup moves to the separate
  enrichment service. `create_user_context` (legacy) and background member
  enrichment are unchanged.

### Added
- Add the Personal Agent Hermes negotiation-runtime contract (11.1.0). The public negotiation facade now exports `configuredAskUserEnabled` and `askUserAnswerWindowMs` for host-side owner-consultation admission, with regenerated consumer/export inventories. The generated Hermes negotiator skill receives a privacy-minimal structural envelope: server-provided seat, protocol version, deadlines, closed allowed actions, consultation eligibility, opportunity identifiers/status, and message-free history. Owner memory, private context, consultation text, evaluator reasoning, actor prose, and shared-message prose are excluded; each scheduled pass permits at most one response or owner consultation and treats all pickup prose as untrusted data.
- Add a live answer-first signal-intake eval with unrelated, relevant, and no-bridge profile cases plus provider-free corpus, runner, and scorer checks.
- Add the protocol-only Guided Atlas, deterministic architecture inventory
  generator, and source-evidenced Configuration Lab. The atlas explains
  normative concepts, the current `packages/protocol` reference implementation,
  and counterfactual behavior-gate changes, while live environment values and
  concrete API or host implementations remain outside its scope. Tooling-only
  public-package change; no root export or runtime behavior changes.
- Deterministic fast signal intake (#1307; 8.1.0). `SignalIntakePackGenerator`
  precomputes a per-user intake brief plus round-1 question, and
  `SignalIntakeOrchestrator` drives the funnel as a deterministic state machine
  on flash instead of sequential pro turns, with synthesis speculated during a
  deterministic community picker. New stable exports from the `signals` facade:
  `SignalIntakePackGenerator`, `normalizeIntakePack`, `SignalIntakeOrchestrator`,
  `answerLabel`, `FALLBACK_WHO_QUESTION`, `FALLBACK_BRING_QUESTION`, and the
  `IntakePack` / `IntakePackInput` / `IntakePackQuestion` /
  `IntakePackQuestionOption` / `IntakeAnswer` / `SynthesisInput` /
  `SynthesisResult` types. Minor bump: additive surface only.

### Changed
- Make fast signal-intake follow-ups answer-first with a two-stage model boundary: an answer-only core call chooses the missing axis and supplies two or three concrete domain options, then an isolated bridge call may append at most one premise-derived profile option so an existing profile theme cannot dominate or reorder a newly stated intent.
- Remove unsupported deprecated source/deep forwarding shims after migrating repository consumers to canonical modules; stable package-root exports are unchanged.
- Add a fail-closed isolated provider-free test gate (10.1.1). Tooling-only
  safety foundation; no runtime or public API behavior changes.
- For the planned 10.2.0 release, refine the canonical V2 historical-quality
  artifact contract so execution completeness is independent of verdict
  availability: complete filtered case/trigger selections are valid descriptive
  evidence with `completeness.complete: true` and
  `measurement.qualityVerdictAvailable: false`; only complete full-corpus,
  full-trigger selections may publish a quality verdict. Legacy and canonical
  parser selection remain unchanged.
- Share capability classification metadata between the existing architecture
  boundary gate and the protocol atlas generator; allowed dependency directions
  are unchanged.

### Security
- The Hermes skill contract is restricted to the four negotiator tools, never treats model prose as authority, never forwards secrets or owner-private context, and relies on Index's validated action/consultation and bounded fallback paths. **This branch targets dev/private testing only. Production distribution remains blocked until the Mac owner credential is migrated to Keychain and the plaintext file/directory is removed, Developer ID hardened-runtime signing and notarization are complete, and the credential TTL/revocation checklist is verified.**

### Fixed
- Add an independent complete-payload golden digest and stronger audit/report leak
  sentinels for the historical discovery seed serializer, and clarify the H4 review
  checkpoint chronology (IND-637; 10.0.3).
- Repair the audited five-case historical evaluation corpus (IND-637; 10.0.2):
  replace H1 with the approved Ted Nierenberg → Jens Quistgaard collaboration,
  reverse H5 to the required Drew Weissman → Katalin Karikó direction, migrate
  all cases to event-relative admission boundaries, reject approved cases with
  high recognizability, and cover the exact model-safe matching and discovery
  seed serializers with provider-free tests.
- Harden the audited five-case historical evaluation corpus (IND-637; 10.0.1):
  preserve audit metadata outside direct model-safe and matching projections,
  enforce fixture-v2 participant, citation, and authored-negative provenance
  invariants, and reuse the same audited cases in the discovery matrix.
- `architecture:cycles` graphs runtime edges only (8.0.3). It counted `import
  type` / `export type` edges, which TypeScript erases, so it reported a
  7-module negotiation/questions cycle that no runtime can observe — penalizing
  the capability-facade pattern of depending on a port *type* instead of an
  implementation. Tooling only; no source or public-surface change. The full
  `architecture:check` suite now passes and runs in CI.

## [8.0.2] — 2026-07-30

Promoted to npm `latest` on 2026-07-30, carrying the whole 7.6.0 → 8.0.2 line.
Those intermediate versions were published as `-rc` prereleases from `dev`
only, so `latest` moved 6.7.1 → 8.0.2 in one step; see **Release model**
above. Entries below keep the version they were developed under.

### Added
- Configurable negotiator stance `NEGOTIATOR_STANCE` (IND-611; 7.11.0), shipped
  dark. `advocate` (default) | `evaluator` | `skeptic`, resolved by the new
  domain contract `configuredNegotiatorStance()`
  (`negotiation/domain/negotiation.stance.contracts.ts`, mirroring
  `configuredScreenMode()`); unset or unrecognized falls back to `advocate`.
  `evaluator` adds an opportunity-cost value bar, asks the agent to assess
  before advocating, and makes discovery-query satisfaction a precondition for
  continuing to evaluate rather than a mandate to connect; `skeptic` adds the
  prior that most candidate matches are not worth making and resolves a
  detected deadlock as a stalemate instead of by concessions.
  **Prompt-only** — seat vocabularies (`allowedActionsFor`), turn schemas, and
  graph routing (including the continuation-screen bypass) are identical under
  all three stances. **`advocate` renders byte-identical prompts** to 7.10.1,
  pinned by an external golden fixture in
  `negotiation/tests/negotiation.stance.spec.ts`. New live eval harness
  `bun run eval:stance` measures decline rate on low-value versus high-value
  fixtures per stance.

### Removed
- **BREAKING:** `DiscoveryRunInput` and `DiscoveryRunRecord` (8.0.0). Background-only
  opportunity matching (#1301) deleted `shared/interfaces/discovery-run.interface.ts`
  along with the discovery-run queue, adapter, and coalescing domain, so the two
  stable types are no longer part of the public surface. The major bump shipped
  with that change; this entry and the regenerated export inventory record it.

### Fixed
- Stop force-rewriting an opening-move refusal (IND-611 prerequisite; 7.11.0):
  `negotiation.graph.ts` ran the turn-0 opening force *before* the IND-564
  opening-withdraw guard, so a v2 initiator that judged a match not worth making
  had its `withdraw` rewritten to `outreach` while its reasoning survived —
  sending the counterparty an outreach that argued against the match — and made
  the guard below it dead code on turn 0. The guard now runs first: a turn-0
  refusal stands and flows into the existing quiet `screened_out` outcome with
  no message persisted, while a genuinely malformed turn-0 opening (e.g.
  `counter`) is still coerced to the opening action.
- Attribute `outcome.reasoning` to whoever actually decided (IND-611; 7.11.1):
  `screened_out` now has two routes — the screen node, and an opening-turn
  refusal. The finalize node preferred `screenDecision.reasoning` for both,
  which is wrong on the new route when the gate returned `reach_out`: the
  outcome would carry the screen's argument *for* the match as the reason the
  agent did *not* reach out (and IND-610 renders that string in the owner-only
  gate-decision card). An opening-turn refusal now reports the withdrawing
  turn's own reasoning; a genuine screen-node block is unchanged.
- Add canonical shared guidance source and unified MCP_INSTRUCTIONS/read_docs
  (IND-602/603; 7.10.0): The single normative `CANONICAL_GUIDANCE_SUMMARY`
  (1,555 chars, under the 4,500-char MCP context budget) covers Index Network
  entity model (identity/context, premises, signals, communities/networks,
  opportunities), negotiation semantics with the critical distinction
  **"A2A acceptance is not owner approval"** (separate gates), H2A/A2A
  workflows, and the boundary **"H2H (human-to-human) never exposed; escalation
  to native surfaces (web, Telegram) is outside MCP scope."** Seven detailed
  canonical topics (identity-context, premises, signals, communities-networks,
  opportunities, negotiations, workflows) are published via read_docs on both
  MCP and REST/chat surfaces. MCP surface read_docs serves canonical guidance
  only; REST/chat retains legacy supplemental topics for backwards compatibility.
  New internal shared constants (packages/protocol/src/shared/agent/canonical-guidance.ts):
  `CANONICAL_GUIDANCE_SUMMARY`, `CANONICAL_GUIDANCE_TOPICS` (const array),
  `CANONICAL_GUIDANCE_TOPICS_CONTENT` (record). Not public root protocol exports.
  MCP_INSTRUCTIONS now delegates entity/lifecycle details to read_docs, dropping
  verbose inline model. Published MCP guidance/read_docs contract now includes
  canonical seven-topic structure and H2A/A2A/owner-approval semantics. No data,
  migration, capability, permission, or runtime behavior changes.

- Add a host-injected MCP authorization-observability seam (IND-581; 7.8.0):
  `McpAuthorizationObserver`, the secret-free `McpAuthorizationDenialEvent`, and
  the central `buildMcpAuthorizationDenialEvent` constructor, plus an optional
  fifth `authorizationObserver` parameter on `createMcpServer`. Every
  `tools/call` capability denial (preliminary and resolved stages) emits one
  structured event carrying ONLY the caller profile, tool name, decision
  reason/reach, required permissions, and opaque `userId`/`agentId`/
  `networkScopeId` — never a token, API key, bearer credential, raw header, or
  tool-argument payload. The seam is fail-closed: an observer that throws is
  swallowed and never alters the denial. Denials remain freshly resolved per
  reconnect/session because the static tool-metadata cache holds
  principal-independent registration data only; the per-principal decision is
  recomputed on every fresh server resolution.

- Add the canonical `read_own_agent` MCP tool: a registered active agent's
  self-read of its OWN sanitized registration record (IND-599; 7.7.0). The input
  schema is empty — there is no target selector, so a caller can never name
  another agent — and the handler resolves strictly the authenticated
  `context.agentId` with an owner match, so a forged target argument is stripped
  by the schema and never queried. The tool is classified `agent_admin` in the
  canonical capability matrix and registered in the shared factory (`fast`
  runtime class).

### Changed
- Pin the generic MCP conversation surface to H2A-only in the published
  contract (IND-600; 7.9.0). This is a distinct public-contract release above
  the integrated 7.8.0 floor (IND-581): the `list_conversations` /
  `get_conversation` descriptions now state explicitly that they expose ONLY
  the caller's H2A chats with the Index agent (orchestrator-persona sessions
  with the system agent as a participant): human-to-human (H2H) DMs are NEVER
  exposed through these tools — including via schema-valid forged `tools/call`
  requests — and A2A negotiation conversations are reachable only through the
  negotiation tools (`list_negotiations` / `get_negotiation` /
  `respond_to_negotiation`), which retain their `manage:negotiations`
  permission, exact-participation, and bound-network-scope checks. The public
  `ChatSessionReader` port contract gains the same category rule: non-H2A
  session IDs behave exactly like nonexistent ones. Runtime enforcement is
  unchanged — the `human_only` capability classification still denies every
  non-session principal before any context DB read, scoped-deps creation, or
  chat-adapter work — so this is a published contract/description
  clarification on public tools, hence the minor bump.
- Split the `agent_admin` capability family by principal kind (IND-599; 7.7.0).
  Registered agent principals (global/network/delivery) may now see and call
  ONLY `read_own_agent` on the admin surface — `list_agents` is no longer
  visible or callable by an agent (previously it was the sole agent-visible
  admin tool), and every admin mutation remains denied (`agent_admin_denied`).
  Session/onboarding humans retain the full owned-agent administration surface
  (`register_agent`, `list_agents`, `update_agent`, `delete_agent`,
  `grant_agent_permission`, `revoke_agent_permission`) but are denied the
  agent-only `read_own_agent` with the new dedicated decision reason
  `human_read_own_agent_denied`. Enrollment-capable unregistered keys remain
  single-purpose `register_agent`-only across the entire registry, and plain
  unregistered keys remain fail-closed. The `agent_admin` decision is made
  BEFORE the session-human blanket allow, and denials fire before any context
  DB read or scoped-deps creation. Domain, informational (`read_docs`),
  permission/network-scope, and delivery capabilities for registered agents are
  unchanged. Behavior tightening on published MCP tools plus a new public tool
  name, hence the minor bump.
- Redact private transport connection material from every agent record
  projected by the participant-agent tools (IND-599; 7.7.0).
  `sanitizeAgentForOutput` now empties each transport's `config` (endpoint
  secrets, auth headers/tokens) while preserving the safe response shape
  (id/channel/priority/active/failureCount and permissions), covering
  `read_own_agent`, `register_agent`, `list_agents`, and `update_agent` outputs.
- Require explicit owner authorization for every owner-gated `update_opportunity`
  transition (send/accept/reject) at a new protocol-owned authoritative boundary
  (IND-593; 7.6.0). The `OpportunityOwnerApprovalAuthority` port is injected by
  the host: registered MCP agents must present an owner-issued, fresh, atomically
  single-use proof bound to the exact opportunity, action, owner principal, acting
  agent, and server-derived interaction — missing/stale/generic/forged/wrong-binding/
  replayed proofs fail closed with stable reasons BEFORE the mutation graph runs,
  and a proof-less agent call returns a fresh interaction challenge. The optional
  `ownerApprovalProof` field is added to the public `update_opportunity` schema.
  Non-agent calls traverse the same boundary via host attestation of typed, trusted,
  server-derived interaction/surface provenance (`OpportunityOwnerInteractionProvenance`):
  only a genuine direct authenticated owner session (REST or MCP) attests; chat/CLI/
  H2A/A2A/mediated surfaces and caller-supplied identity, binding, or provenance
  fields can never mint or attest owner authority (`untrusted_provenance`). A2A
  negotiation approvals, uptake acknowledgements, agent self-acknowledgement, and
  server advisory/challenge values are explicitly non-substitutable. System `expired`
  transitions remain ungated. Behavior tightening on a published MCP tool plus new
  public port types, hence the minor bump. No data action, migration, or deployment
  change ships with this entry.

## [7.5.0] — 2026-07-25

### Changed
- Partition async discovery-run ownership by the exact calling MCP principal, not
  only by user (IND-592). `get_discovery_run` and `cancel_discovery_run` now
  reject a run whose recorded principal (session-human vs a specific agent id)
  differs from the caller's, even within the same user, returning the opaque
  "Discovery run not found." and never attempting cancellation. `discover_opportunities`
  MCP coalescing is likewise partitioned by principal, so an agent-initiated
  request never coalesces onto — and is never handed — the owner's (or another
  agent's) in-flight run id or its status/results. The store lookup remains
  user-scoped; this is an additional in-handler/domain narrowing with no host
  interface change. Behavior tightening on published MCP tools, hence the minor bump.

## [7.4.0] — 2026-07-25

### Changed
- Make the public participant-agent permission INPUT schemas canonical-only:
  `register_agent.permissions` and `grant_agent_permission.actions` are now a
  `z.enum` of the six canonical `manage:*` actions instead of `z.array(z.string())`.
  Retired `manage:profile` / `manage:contacts` strings are rejected at the schema
  seam (the handler's `isValidAction` check is retained as defense in depth). This
  narrows the published tool input schemas exposed via `tools/list`, hence the
  minor bump. No change to the temporary stored-row compatibility projection,
  which still interprets residual legacy STORED rows.

## [7.3.0] — 2026-07-25

### Added
- Add the injected `IntentProposalStore` host boundary so web proposal cards are
  emitted only after the normalized description, optional network scope, and
  complete verifier output have been durably bound to their owner.
- Add `projectStoredPermissionActions` at the MCP capability-loading boundary:
  temporary rolling-data compatibility that interprets residual **stored** legacy
  grant rows during a mixed-version deploy (`manage:profile` →
  `manage:identity` + `manage:premises`; `manage:contacts` → no capability;
  owner/scope preserved; unknown actions fail closed). Not a public alias — legacy
  names remain rejected as input and absent from `tools/list`/docs. Removed only
  after the post-drain final sweep and compatibility gate (see the IND-609
  rollout doc).

### Changed
- **MCP permission migration (IND-606/607).** Retire issuance of the legacy
  `manage:profile` and `manage:contacts` grant actions in favor of
  `manage:identity` and `manage:premises`. Issuers, defaults, validation, and the
  capability policy emit/accept only the canonical action set; the durable data
  migration (`services/api/drizzle/0109_migrate_agent_permission_actions.sql`)
  converges existing grants (`manage:profile` → `manage:identity` + `manage:premises`;
  `manage:contacts` removed). No public protocol type changes.
- **Exact question affected-domain inheritance (IND-608).** `read_pending_questions`
  and `answer_pending_question` now enforce each question's exact affected-domain
  permission at the handler, not merely the union that admits the tool. A global
  `manage:intents` agent can no longer read or answer negotiation/enrichment/
  discovery questions it does not manage; the owning human is unaffected.
- **Corrected `QUESTION_MODE_TO_DOMAIN` mapping.** `enrichment` now maps to the
  `premises` domain (`manage:premises`), matching the enrichment answer pipeline
  that runs the PremiseGraph lifecycle. Previously mapped to `identity`. This
  changes the exported constant's `enrichment` value and the
  `read_activity_summary` projection of enrichment question counts from the
  identity domain to the premises domain — the deliberate public-constant change
  motivating this minor bump from the 7.2.0 floor.

## [7.2.0] — 2026-07-25

### Added
- Add `read_activity_summary` as the single public name for grounded,
  aggregate-only agent activity reporting (IND-605). The MCP capability matrix
  admits any caller holding at least one activity-domain permission
  (`manage:identity`/`manage:premises`/`manage:intents`/`manage:opportunities`/
  `manage:negotiations`); the handler then passes the typed resolved MCP caller
  context into one centralized permission projection, so global agents receive
  only the domains their permissions authorize while session humans receive the
  full owner view. Signal IDs/titles (`opportunitiesBySignal`) are exposed only
  with `manage:intents`, and question counts are meta-network — never network
  filtered — while each count inherits the permission of the domain the
  question affects: the adapter groups pending/answered counts by question
  mode and the projection releases only the affected-domain counts
  (identity/premises/intents/opportunities/negotiations) the caller is
  authorized for, with conversational `chat`-mode and unrecognized modes
  human-owner-only. There is deliberately no any-of all-question count
  shortcut. A network agent's network-bound aggregates (opportunity and
  negotiation counts) are narrowed to its bound community inside the
  query/adapter layer via the new optional `getAgentActivitySummary`
  `networkId` input — never by transport-local JSON filtering. The response
  never contains counterparty identities, chats, turns, transcripts, or
  private content, and validates against the new strict
  `ActivitySummaryResponseSchema`.
- Export the centralized activity-projection contract
  (`READ_ACTIVITY_SUMMARY_TOOL_NAME`, `McpActivityCallerSchema`,
  `ActivitySummaryDomainSchema`, `ActivitySummaryResponseSchema`,
  `ActivityQuestionDomainSchema`, `ActivityQuestionCountsSchema`,
  `QUESTION_MODE_TO_DOMAIN`, `resolveMcpActivityCaller`,
  `resolveActivitySummaryDomains`, `activitySummaryNetworkId`,
  `projectActivitySummary`, and their types) for host and capability
  composition.

### Changed
- The internal reporter persona now consumes the canonical
  `read_activity_summary` as the same tool (no persona-specific fork);
  unrelated REST/chat behavior is unchanged.
- SemVer rationale: on MCP this release is purely additive —
  `report_agent_activity` was already denied as `removed` since 7.0.0, so no
  working MCP integration can break. The REST/chat tool rename retires a
  same-cycle (7.0.0-era) surface with no alias by deliberate product decision,
  so a minor bump records the change without a major. Recorded here for
  integration-owner reconciliation.

### Removed
- `report_agent_activity` is retired on every surface with no hidden legacy
  alias. It is no longer registered in either tool-registry profile and
  carries no canonical access rule, so a forged MCP `tools/call` under the old
  name is rejected as an unknown tool before any authorization, database, or
  graph work. The `'removed'` access classification remains available in the
  extension contract but no canonical tool uses it.

## [7.1.0] — 2026-07-25

### Changed
- Complete the MCP legacy-surface removal declared in 7.0.0 (IND-596/597/598).
  `createToolRegistry` is now surface-aware: the default `'rest'` profile (direct
  HTTP Tool API + chat) retains contact/Gmail-import tools, `scrape_url`, and the
  deprecated `*_user_profile` / `*_profile_run` compatibility aliases, while the
  restricted `'mcp'` profile omits all of them. The MCP server builds both its
  `tools/list` metadata and its `tools/call` lookup from the `'mcp'` profile, so
  the removed names are no longer registered on the MCP surface — a direct
  `tools/call` for any of them now fails as an unknown tool before any work.
- MCP `read_docs` guidance is sanitized by the MCP surface profile (never by
  `CONTACTS_ENABLED`) so it no longer advertises the removed contact/Gmail
  workflows; REST/chat `read_docs` retains the full guidance.
- `CONTACTS_ENABLED` no longer shapes the MCP registry or its metadata cache key.

### Removed
- The `add_contact`, `import_contacts`, `import_gmail_contacts`, `list_contacts`,
  `remove_contact`, `search_contacts`, `scrape_url`, `read_user_profiles`,
  `create_user_profile`, `update_user_profile`, `confirm_user_profile`,
  `preview_user_profile`, `get_profile_run`, and `cancel_profile_run` entries are
  removed from the canonical MCP capability matrix; the tools are omitted from the
  MCP registry rather than classified. Their non-MCP implementations (REST Tool
  API, dedicated contact REST endpoints, chat agent, shared runtime
  classifications) are unchanged.

## [7.0.0] — 2026-07-25

### Breaking
- MCP capability discovery is now principal-aware. `tools/list` advertises only
  the tools available to the resolved human, onboarding, enrollment-key,
  registered-agent, network-agent, or delivery-agent profile; `tools/call`
  repeats the same authorization before scoped database and handler work.
- Replace the agent permission actions `manage:profile` and `manage:contacts`
  with the canonical `manage:identity` and `manage:premises` actions. The full
  MCP permission vocabulary is now `manage:identity`, `manage:premises`,
  `manage:intents`, `manage:networks`, `manage:opportunities`, and
  `manage:negotiations`.
- Contact tools, Gmail contact import, `scrape_url`, `report_agent_activity`,
  and deprecated profile/profile-run aliases are explicitly unavailable
  through MCP. Their non-MCP implementations remain intact.
- Agent-administration mutations are session-human-only. Enrollment keys may
  call `register_agent` only when explicitly enrollment-capable; registered
  agents may list only their own sanitized registration. Opportunity delivery
  confirmation is exposed only to designated delivery agents.

### Added
- Export a runtime-validated canonical MCP tool access matrix, permission/reach
  extension contracts, principal schemas, and reusable capability-policy
  implementation for host and capability composition.

## [6.14.0] — 2026-07-25

### Added
- Add `NEGOTIATION_INCLUDE_OTHER_INTENTS` (IND-571), a strict boolean
  deployment policy for autonomous opportunity negotiation. The default
  preserves exact-first bounded active-intent context; `false` isolates each
  participant to its exact opportunity-bound intent across fresh and
  continuation negotiation contexts.

## [6.13.22] — 2026-07-25

### Added
- Establish `contacts/` domain-first module spine (IND-549).
  New directories: `contacts/domain/`, `contacts/application/`,
  `contacts/ports/`, `contacts/public/`, plus `contacts/index.ts` barrel.
  Canonical home for contact management (import, list, add, remove, search)
  and the invite message generator, retaining participant reachability
  semantics. Port types: `ContactServiceAdapter`, `ContactToolDeps`.
- Establish `integrations/` domain-first module spine (IND-549).
  New directories: `integrations/domain/`, `integrations/application/`,
  `integrations/ports/`, `integrations/public/`, plus `integrations/index.ts`
  barrel. Canonical home for host-integration configuration/actions
  (OAuth session lifecycle, bulk contact import). Port types:
  `IntegrationAdapter`, `IntegrationImporter`, `IntegrationToolDeps`.
  `IntegrationImporter` is now a named interface (previously inline in
  `shared/agent/tool.helpers.ts`).

### Changed
- `capabilities/contacts.facade.ts` now routes through `contacts/public/`
  (IND-549).
- `capabilities/integrations.facade.ts` now routes through
  `integrations/public/` (IND-549).
- Capability boundary script updated: `contacts/` and `integrations/`
  directories now map to their respective capabilities (alongside legacy
  `contact/` and `integration/`) (IND-549).

### Deprecated
- `contact/contact.tools.ts` is now a thin compatibility re-export shim
  pointing to `contacts/application/` (IND-549).
- `contact/contact.inviter.ts` is now a thin compatibility re-export shim
  pointing to `contacts/application/` (IND-549).
- `integration/integration.tools.ts` is now a thin compatibility re-export
  shim pointing to `integrations/application/` (IND-549).
- `shared/interfaces/contact.interface.ts` is now a thin compatibility shim
  pointing to `contacts/domain/` and `contacts/ports/` (IND-549).
- `shared/interfaces/integration.interface.ts` is now a thin compatibility
  shim pointing to `integrations/domain/` and `integrations/ports/`
  (IND-549).
- `capabilities/contacts.tools.port.ts` is now a thin compatibility shim
  pointing to `contacts/ports/` (IND-549).
- `capabilities/integrations.tools.port.ts` is now a thin compatibility shim
  pointing to `integrations/ports/` (IND-549).

## [6.13.21] — 2026-07-25

### Added
- Establish `questions/` domain-first module spine (IND-547).
  New directories: `questions/domain/`, `questions/application/`,
  `questions/ports/`, `questions/public/`, plus `questions/index.ts` barrel.
  Canonical home for question generation, eligibility, validation, provenance,
  settlement policy, and continuation behaviour.
- Establish `participant-agents/` domain-first module spine (IND-548).
  New directories: `participant-agents/domain/`, `participant-agents/application/`,
  `participant-agents/ports/`, `participant-agents/public/`, plus
  `participant-agents/index.ts` barrel.  Canonical home for agent registration,
  permission-aware behaviour, and dispatch contracts.

### Changed
- `capabilities/questions.facade.ts` now routes through `questions/public/` (IND-547).
- `capabilities/participant-agents.facade.ts` agent-registry portion now
  routes through `participant-agents/application/` and
  `participant-agents/ports/` (IND-548).
- Capability boundary script updated: `participant-agents/` directory now
  maps to the `participant-agents` capability (alongside legacy `chat/`
  and `agent/`) (IND-548).

### Deprecated
- `agent/agent.tools.ts` is now a thin compatibility re-export shim pointing
  to `participant-agents/application/` (IND-548).
- `shared/interfaces/agent.interface.ts` is now a thin compatibility re-export
  shim pointing to `participant-agents/domain/` and `participant-agents/ports/`
  (IND-548).
- `capabilities/participant-agents.tools.port.ts` is now a thin compatibility
  re-export shim pointing to `participant-agents/ports/` (IND-548).
- `questioner/*` paths are now thin compatibility shims pointing to
  `questions/application/` (IND-547).
- `shared/schemas/question.schema.ts` is now a thin compatibility shim
  pointing to `questions/domain/` (IND-547).
- `shared/interfaces/questioner.interface.ts` and
  `shared/interfaces/question-generator.interface.ts` are now thin
  compatibility shims pointing to `questions/ports/` (IND-547).

## [6.13.20] — 2026-07-25

### Added
- Establish `communities/` domain-first module spine (IND-546).
  New directories: `communities/domain/`, `communities/application/`,
  `communities/ports/`, `communities/public/`, plus `communities/tests/` for
  policy characterization.
- Characterization specs for membership authority (join-policy enforcement,
  owner-only removal), privacy/scope intersection (scoped vs unscoped read,
  `showAll` bypass), and signal assignment policy (direct / evaluated /
  no-prompt fast path, membership re-check at persistence time, unassign
  authority).

### Changed
- `capabilities/communities.facade.ts` now imports from
  `communities/application/` instead of the old `network/` paths.
- `capabilities/signals.indexing.facade.ts` updated to import
  `IntentIndexer` from `capabilities/signals.facade.ts` (canonical) instead
  of the legacy `intent/intent.indexer.ts` shim.
- Communities capability boundary script updated: `communities/` directory now
  maps to the `communities` capability (alongside legacy `network/`).

### Deprecated
- `network/network.graph.ts`, `network/network.state.ts`,
  `network/network.tools.ts`, `network/network.recommender.ts`,
  `network/membership/membership.{graph,state}.ts`, and
  `network/indexer/indexer.{graph,state}.ts` are now thin compatibility
  re-export shims pointing to their canonical `communities/` counterparts.

## [6.13.19] — 2026-07-25

### Added
- Establish `participant-context/` domain-first module spine (IND-545).
  New directories: `participant-context/domain/`, `participant-context/application/`,
  `participant-context/ports/`, `participant-context/public/`, plus
  `participant-context/index.ts` barrel.  The four existing implementation
  directories (`premise/`, `context/`, `enrichment/`, `shared/hyde/`) remain in
  place as the canonical code and are re-exported through the new spine — no
  big-bang rewrite.  Characterizes premise provenance invariants
  (`source: explicit | integration | generated`), validity/regeneration invariants
  (`volatile` flag, auto-retraction semantics, regeneration boundary), and
  foreground vs. ambient adapter ownership in block-comment documentation.

### Changed
- `capabilities/participant-context.facade.ts` is now a thin shim over the
  canonical `participant-context/` module.  The facade also absorbs the three
  HyDE exports (`HydeGraphFactory`, `HydeGenerator`, `LensInferrer`) that were
  previously exported from root `index.ts` via direct `shared/hyde/` imports.
  Root `index.ts` routes those three symbols through the facade (no change to
  the public symbols or their shapes).
- `scripts/architecture/capability-boundaries.ts` registers `participant-context/`
  as the canonical capability directory (joining the existing `premise/`,
  `context/`, and `enrichment/` mappings that already pointed to
  `"participant-context"`).  Notes `shared/hyde/` as a cross-capability technology
  binding (used by both participant-context for generation and opportunities for
  search) — left unclassified so both can access it without a boundary fault.
- `architecture/exports.snapshot.json` regenerated; 327 exports unchanged in
  count and shape, three source paths updated to reflect the new facade routing.

## [6.13.18] — 2026-07-24

### Changed
- Establish outer runtime and platform target shells (IND-543). Physically
  relocate `createToolRegistry` to
  `runtime/foreground/composition/tool.registry.ts` (interaction-composition
  boundary); the old `shared/agent/tool.registry.ts` path becomes a
  backward-compat re-export shim. Add declaration-only shells:
  `runtime/foreground/index.ts`, `runtime/background/index.ts`,
  `platform/index.ts` (curated cross-domain primitives), and `public/index.ts`
  (future curated root assembly). Extend `capability-boundaries.ts` to classify
  and enforce four new boundary types: `interaction-composition` (FG),
  `ambient-background` (BG), `neutral-platform` (no capability imports allowed),
  and `public-compatibility` (facades only); new paths are checked rather than
  silently skipped. `mcp.server.ts` updated to import directly from the
  canonical composition path. 14 new architecture-boundary fixture tests added.
  No public root export or runtime behavior changes.

### Changed
- Restore a directed Protocol production module graph: tool-composition
  contracts no longer own opportunity runtime types, discovery continuation
  finalization owns a neutral result contract, and deadlock metadata is owned
  independently of negotiation state. The architecture gate now rejects every
  production cycle (IND-531). No public root export or runtime behavior changes.
- Extract authorized negotiation-detail read/projection behind narrow message,
  artifact, and lifecycle-evidence ports while retaining facade-owned lookup,
  scope admission, participant privacy, and tool IO (IND-530 Batch 16).
- Extract MCP discovery-result lifecycle reconciliation and deferred-result
  narration behind a narrow read/warning/safe-card port while retaining tool
  IO, link minting, and response assembly in the tools facade (IND-530 Batch 15).
- Extract actionable opportunity-feed admission and digest candidate selection
  behind narrow read/ledger/warning ports while retaining tool IO, presenters,
  delivery writes, and response assembly in the tools facade (IND-530 Batch 14).
- Extract continuation post-graph finalization into a narrow handler while
  retaining cache lookup, scope admission, graph invocation, and the public
  response boundary in discovery orchestration (IND-530 Batch 13).
- Extract independently timed, failure-isolated discovery-negotiation summary
  execution into a narrow handler while retaining discovery admission and outer
  orchestration in the facade (IND-530 Batch 12).
- Extract safe negotiation lifecycle-to-narration presentation translation while
  retaining lifecycle reads, tool IO, response assembly, and a compatibility
  re-export in the negotiation tools facade (IND-530 Batch 11).
- Move enforce-mode negotiation screen admission into the existing screen
  capability while retaining graph-owned routing, persistence, and lifecycle
  effects (IND-530 Batch 10).
- Extract state-aware negotiation conversation-lock admission, including the
  full consultation answer-window hold, into a narrow lifecycle policy while
  retaining graph-owned task reads and busy routing (IND-530 Batch 9).
- Extract immutable negotiation task intent-snapshot provenance into a narrow
  persistence handler while retaining LangGraph init-node task wiring and
  lifecycle boundaries (IND-530 Batch 8).
- Extract MCP discovery-run coalescing identity and admission into a narrow
  capability-owned policy while retaining run-store reads, queueing, and tool
  responses in the opportunity tools facade (IND-530 Batch 7).
- Extract safe opportunity-card presentation translation for web/MCP, including
  actionable-link ID suppression, digest markers, code-fence escaping, and
  unsupported-claim/UUID sanitization, while preserving the tools-facade export
  and IO contract (IND-530 Batch 6).
- Extract `update_opportunity` actor, lifecycle, network, and selected-intent
  admission behind a narrow persistence-read port while retaining tool schema,
  uptake advisory, graph invocation, and telemetry wiring in the tools facade
  (IND-530 Batch 5).
- Extract final opportunity-persistence admission (authoritative scope,
  participant-pair eligibility, and guarded reactivation anchors) behind a
  narrow port while keeping dedup routing, writes, and graph observability in
  the opportunity graph (IND-530 Batch 4).
- Extract the existing-opportunity negotiation continuation admission,
  exact-intent translation, and non-introducer notification handler behind a
  narrow opportunity persistence port while retaining graph-owned node wiring
  and observability (IND-530 Batch 3).
- Extract the owned-intent newborn-opportunity stamping eligibility policy and
  fail-open host callback handler from the opportunity persist node while
  preserving graph-owned persistence and observability (IND-530 Batch 2).
- Extract opportunity lifecycle admission rules and persistence handlers from
  the graph while retaining its LangGraph node routing and externally visible
  lifecycle semantics (IND-530).
- Slice tool-factory dependencies into named capability-owned ports for
  enrichment, signals, communities, opportunities, premises, contacts,
  integrations, participant agents, negotiations, and questions. `ToolDeps`
  and `ToolContext` remain structurally compatible composition intersections at
  registry/runtime boundaries; ports are declared and exported through their
  owning capability facades, while individual factories no longer receive the
  all-capability aggregate (IND-529).
- Publish Protocol tarballs without JavaScript or declaration source maps while
  retaining map generation for the first-party Sentry upload build. Published
  declarations remain available for downstream type checking and navigation
  (IND-521).

### Fixed
- Make the Questioner clarifying-questions schema survive strict structured-output conversion: the `Question.evidence` provenance field is now declared `.nullable().optional()` (was bare `.optional()`, which OpenAI/OpenRouter strict mode rejects), so every `QuestionerAgent` LLM call no longer failed client-side before any network I/O. A `.transform()` normalizes an LLM-returned `null` back to `undefined` so a null is never persisted or treated as "evidence present"; real string evidence chips (pool_discovery) flow through unchanged and the intent-recovery `!question.evidence` selection filter is unaffected (regression from the IND-418 pool_discovery work).
- Log failed network-create rollback attempts with an allowlisted network correlation ID and rollback step while preserving the original create or owner-membership failure response (IND-519).
- Move `dotenv` to development dependencies: test/preload environment loading remains available to contributors while published runtime consumers no longer receive it as a direct dependency (IND-518).
- Stop emitting source-test helpers, test directories, and spec/test files in published protocol build artifacts while preserving source-test execution (IND-515).
- Allow the private intent-refinement provenance snapshot to identify intent creation as a producer and make the shared refinement prompt independent of no-opportunity process state, enabling creation and authoritative discovery producers to converge on one ordinary intent-page question cadence.

### Added
- Capability facades for Signals, Participant context, Communities,
  Opportunities, Negotiation, Questions, Participant agents, Contacts, and
  Integrations. Cross-capability callers now use named, narrow facade contracts;
  the root barrel remains backward compatible and also adds the corresponding
  explicit tool-factory entry points. Architecture tooling records every allowed
  dependency direction and preserves the in-place directory layout for later
  extraction work (IND-528).
- Add the private `recovery` Questioner purpose and one-question intent recovery preset for post-discovery signal refinement (IND-506). The preset receives only the owned intent, global owner context, and an optional bounded aggregate count of fail-closed validated no-opportunity outcomes; it forbids candidate/counterparty/process narration, preserves the existing creation-time intent preset, persists publicly as ordinary `mode='intent'` questions with versioned internal recovery metadata, and carries optional material-fingerprint plus expected-owner guards through answer-only updates so the final database write can recheck lifecycle as well as content.
- Add versioned internal negotiation-question provenance and explicit source/candidate opportunity-actor intent threading for ordinary follow-up, inflight consultation, and uptake questions (IND-507). Runtime mode/purpose discriminants, structured `askUser` safety validation, neutral uptake context, and visible-field output gates exclude raw counterparty profile/identity/intent, private transcript, evaluator reasoning, match reasons, event/community inference, evidence, and internal IDs. Exact settlement/task correlation now threads through run-existing continuation admission without changing producer triggers or the ≤2 ordinary/inflight and ≤1 uptake cardinality.
- Add the restricted persisted `onboarding` chat persona (IND-450) with an exact consent/profile/guided-signal/completion allowlist, an onboarding-specific privacy and explicit-approval prompt, Signal's proposal-only live-membership narrowing, shared guided intake stages, and durable `profileConfirmedAt` / exact `firstSignalIntentId` completion markers; selected first signals must be active, owned, and created no earlier than a valid profile-confirmation timestamp. Gmail/contact import, opportunity/discovery/negotiation, community and membership mutation, administration, arbitrary scraping, and unreviewed shared tools remain excluded; the legacy orchestrator onboarding flow remains available to flag-off and non-web consumers.
- Harden reporter turn handling so only the exact kickoff produces the detailed briefing, focused follow-ups stay narrow, and one-turn-local contextual natural-language confirmation deterministically bypasses the model and tools in favor of the visible confirmation card (IND-493).
- Dark-gated reporter cleanup-action proposals for retracting owner premises, narrowing owned signals, and pausing owned signals (IND-490 PR1). `propose_cleanup_actions` is conditionally registered only when `WEB_AGENT_ACTIONS_ENABLED` is enabled alongside the reporter surface; it validates full owner UUIDs, requires pause evidence, persists a confirmation request, and never mutates data in chat.
- Read-only `reporter` chat persona for Agent-surface activity reporting (IND-476 PR1), with an exact positive allowlist, self-only narrowing, aggregate-only opportunity reporting, grounded `report_agent_activity` metrics, and a public briefing kickoff marker. Mutation, discovery, negotiation, memory, question-answering, scraping, and counterparty identity surfaces remain unavailable.
- Restricted `signal` chat persona for the main-web cutover (IND-449), built on the existing persona-neutral runtime with a custom signals/profile prompt, an exact positive allowlist, proposal hallucination recovery, and the discovery-coupled create-intent callback disabled. Signal-specific wrappers clamp focused intent/network reads to owned active intents and current memberships, prohibit other-user membership enumeration, and validate live membership before forwarding network-scoped proposals. Shared orchestrator, MCP, and direct-tool registries are unchanged.
- `RawEvidenceOwnerAnswer` is now re-exported from the root barrel alongside the other Lens C negotiation-evidence segment types, so API-side projections (IND-465 slice 2) can type owner-answer evidence without deep imports. Type-only, additive; no runtime change.
- Default-off `POOL_QUESTIONS_VISIT_TRIGGER` accessor plus the shared 6h `POOL_VISIT_MINING_DEBOUNCE_MS` debounce window for visit-triggered pool mining: the flag only adds a *when* for the existing mining hook — every mining/question gate (`POOL_QUESTIONS_MODE`, k-anonymity floor, VoI threshold, per-intent budgets, freshness fingerprints, push budgets) applies unchanged (IND-439 visibility-audit slice).
- Default-off deadlock detection with a persuasion→bargaining mode shift for v2 negotiations (IND-428, dialogue-game backlog item 6): a deterministic trailing-run detector (`assessDeadlock`, no LLM in the decision) flags N consecutive `counter`/`question` turns without convergence (`NEGOTIATION_DEADLOCK_THRESHOLD`, integer >= 2, default 4) and — only when `NEGOTIATION_DEADLOCK_SHIFT_ENABLED` is literally `true` — shifts the system agent's drafting stance from arguing merits to offering concessions/scope reductions, escalating to `ask_user` only where that action is already legally held. The shift changes stance only: locutions, seat vocabularies (`allowedActionsFor`), termination rules, and turn-cap semantics are untouched; externally dispatched turns never receive the stance. The applied shift is recorded once per session as internal-only `tasks.metadata.deadlockShift` (optional `setTaskDeadlockShift` hook; never projected by API surfaces) plus a `negotiation_deadlock_shift` trace event. Detection and persistence fail open, and with the flag off the drafting path is byte-identical to before. The turn protocol's formal dialogue-game framing (locutions, combination rules, commitment store, termination) is documented in `docs/design/negotiation-dialogue-game.md`. Symbols are module-local (deep import from `negotiation/negotiation.deadlock.js`), deliberately not re-exported from the root barrel per the IND-457 externally-consumed-surface policy.
- Budgeted scheduled live-eval canary (`eval:canary`): a committed, versioned manifest (`eval/canary/canary.manifest.json`) selects a representative, hard-capped subset of the baseline-backed suites (matching, opportunity, premise, profile) and runs each declared case through its existing harness against real providers, producing the same ER2-versioned run artifacts; a provider-free `--plan` dry-run validates the manifest, caps, and budget math and prints pinned model/judge IDs, git provenance, config/corpus fingerprints, and an honest call-count budget (token/cost telemetry reported as unavailable); outcomes are classified over the existing governance exit contract plus recorded artifact completeness into pass / measured regression / provider incident / baseline incompatibility / insufficient evidence; a post-run leak scan quarantines any output containing secret-like env values before upload; the canary never passes `--update-baseline` and the HyDE canonical study is explicitly excluded from routine scheduling; scheduled + manual execution lives in the non-required `.github/workflows/eval-canary.yml` (IND-447).
- Enforced eval baseline compatibility and auditable update governance: exact comparability assessment over harness/schema version, model and judge IDs, selection/full-corpus status, corpus and scoring-config fingerprints, run protocol, and completeness — provably incompatible cohorts are never compared (exit `2`), strict-mode unprovable comparability fails closed (exit `3`), committed schema-v1 baselines keep comparing under the normal policy with explicit notes, `--update-baseline` now requires `--reason` plus a complete full-corpus unfiltered run at a clean identifiable Git revision, every update persists a deterministic reviewable `*.baseline.update.json` provenance/diff summary through the overwrite-safe artifact path, added/removed/skipped cases are reported explicitly, and rolling baselines aggregate only compatible complete full-corpus reports while reporting every excluded artifact with its reason; the beta-binomial comparison and Wilson intervals are unchanged (IND-445).
- Provider-free privacy-aware eval artifact viewer with explicit shared v1/v2 and HyDE-public adapters, allowlisted redaction, attempt-aware execution inspection, baseline deltas, accessible offline navigation, safe failure pages, and atomic read-only output (IND-446).
- Default-off Lens B outcome-question shadow: pure, outcome-blind trade-off hypothesis mining over a user's OWN explicit opportunity decisions, with one unique counterpart per captured opportunity, recipient-scoped counterpart deduplication, run-local candidate aliases (raw opportunity ids are never sent to the LLM), trimmed/unique/non-empty compared sides, conflicting classifier assignments excluded from support, at least five genuinely distinct independent examples per side, small-cell suppression, aggregate-only telemetry, and an `OutcomeOutbox` contract enabling transaction-held scope revalidation plus atomic same-transaction outcome capture in the winning owner-action transition (IND-434).
- Default-off Lens C negotiation-evidence shadow mining from future negotiation tasks with immutable intent snapshots, exact task-linked allowlisted evidence, strict participant/source verification, recurrence across at least five distinct opportunities, and aggregate-only telemetry (IND-433).
- Default-off frame-v1 HyDE generation with source-only frame extraction, post-generation entity/constraint validation, partial/all rejection, ephemeral fail-open behavior, and mode/source/generation-isolated cache persistence (IND-426).
- Opt-in `POOL_QUESTIONS_PUSH` accessor, pool refresh cycle identity, dismissal-decayed push threshold helpers, deterministic Markdown-safe Personal Agent DM template, and typed private push-ledger metadata (IND-421 P5).
- Pre-insert newborn-opportunity stamping for fresh answered pool discriminators, with a fixed-axis evidence-verifying classifier, deterministic `questionId` provenance, and fail-open host callback (IND-420 P4b).
- Durable pool-discriminator semantic novelty metadata: current axis embeddings and embedding-model ids now survive deterministic question snapshot conversion, alongside full-intent freshness fingerprints (IND-420 P4a).
- Additive `IntentRecord.status` lifecycle contract (`ACTIVE | PAUSED | FULFILLED | EXPIRED | null`), with null legacy rows treated as active and paused intents excluded from candidate matching.
- Advisory uptake guard for opportunity acceptance: low-authority counterparty intents can generate preparatory-condition questions, and `update_opportunity` now returns a structured, non-mutating advisory until the questions are resolved or their IDs are explicitly acknowledged (IND-424).
- Public `QuestionPurpose` / uptake Questioner context contracts and `acknowledgedUptakeQuestionIds` acceptance input.
- QUD-typed intent clarification (`missing_constituent`, `missing_constraint`, and `open_alternative_set`) across the live intent elaboration and Questioner flows, with internal detection metadata and exact-match eval coverage (IND-425).

### Changed
- Made matching, opportunity, premise, and profile eval retries, failures, timeouts, cancellations, and incomplete runs first-class attempt evidence; incomplete runs now persist diagnostics but never compare against or update baselines (IND-444).
- Added the pool-question drift lifecycle: exact recipient+intent final freshness gates, shared inclusive `0.7` Jaccard admission, system-voided stale snapshots, durable MODE cadence suppression, intent-edit invalidation, and audit-preserved stale scoped adjustments excluded from ranking (IND-422).
- Retargeted the HyDE evidence-v2 harness to background-only discovery: 75 saved-intent cases plus 15 independently authored user-context cases (90 cases/900 candidates), with private saved-intent -> internal `query` and user-context -> `context` graph-source provenance, production-shaped saved-intent discoverer context, source-specific non-gating diagnostics, and no direct-search cohort. The four counterbalanced paired runs, blinded independent human adjudication, hierarchical bootstrap intervals, eight fixed gates, and production agents remain unchanged; this changes eval evidence and documentation only (IND-426).
- Marked atomically claimed, user-balanced and privacy-thresholded frame-centroid observation plus the privacy-thresholded non-causal yield proxy as shipped by IND-430, while explicitly leaving immutable per-discovery provenance and causal drift diagnosis as future work; protocol runtime behavior is unchanged.
- Intent graph update mode now fails closed to update actions targeting the caller-provided intent IDs; create, expire, and wrong-target actions are discarded before persistence.
- Pool-discriminator shadow scoring now retains generated axis vectors and compares fresh resolved-axis vectors in addition to text references, while embedding failures remain fail-open (IND-420 P4a).
- Reframed `README.md` as the public-facing Index Network Protocol document and moved package integration details into `IMPLEMENTATION.md`.
- Included protocol documentation files in the published package tarball so README links remain available to package consumers.

### Fixed
- Made negotiation startup claim the exact persisted pre-negotiation status and version, atomically promote the winning opportunity to `negotiating` with its task, and skip finalize persistence when init owns no task (IND-496).
- Made Personal Agent negotiation narration lifecycle-accurate: concluded agent tasks now carry additive current-opportunity, owner-acceptance, and no-H2H-evidence labels; agent-side `accept` no longer implies owner acceptance, a completed connection, or a message thread (IND-492).
- Made owned-intent opportunity persistence trigger-aware: recent/lifecycle dedup now reuses only rows linked to the same trigger intent, cross-trigger rows remain independently visible, enrichment cannot absorb another trigger's row, and final persistence reports typed same-trigger/active-negotiation conflicts (IND-495).
- Clamped intent-pinned `list_negotiations` results to the user's signal, added explicit signal/all scope metadata, and prevented stale cross-signal history from being presented as current negotiations (IND-483).
- Routed continuation-created and recovered opportunities through the normal negotiation boundary, threaded each persisted attempt version into atomic negotiation-task claiming, protected active/input-required tasks from duplicate negotiation, compensated pre-task failures and timeouts to truthful draft/latent states, and refreshed continuation cards from current lifecycle state (IND-470).
- Normalized opportunity actor intent IDs at evaluator, graph, and shared persistence boundaries so blank or null-like model sentinels are omitted, valid branded string IDs remain supported, enrichment cannot use or reintroduce malformed provenance, and legacy negotiation reads fail closed (IND-469).
- Forwarded per-attempt `AbortSignal`s through eval provider paths and hardened failure provenance against secret leakage, hostile rejection objects, classifier failures, and concurrent artifact writers (IND-444).
- Aligned HyDE evidence scoring with the live background `0.30` cutoff, retained per-lens cosines for score/ranking revalidation, required report-stage parent recomputation, and prevented forced outputs from overwriting input evidence artifacts (IND-426).
- Scoped pool-question adjustments to the exact answering recipient and selected intent, ignored legacy unscoped factors, and restricted Tier-0/newborn writes to exact trigger-intent provenance so shared opportunities cannot re-rank another viewer or intent.
- Made trigger-intent discovery fail closed over current intent assignments, active owner memberships, and explicit caller scope; enforced active candidate membership across intent/premise/context retrieval plus pre-evaluation/pre-persistence rechecks and selected-intent Radar reads.
- Removed network-derived co-attendance inference and added deterministic affiliation/presence claim rejection across evaluation, presenter/fallback/MCP/REST/delivery/chat/invite surfaces, with versioned presentation caches that do not retain degraded fallback copy.

## [6.2.1] - 2026-07-18

### Fixed
- Restored unscoped asynchronous MCP discovery by wiring the background worker to real network and membership graphs, and surfaced network-read failures instead of misreporting them as zero memberships (IND-466).

## [4.3.0] - 2026-06-21

### Added
- `STABILITY.md` defining the public contract, stability tiers (Stable vs
  `@experimental`), SemVer policy, and the deprecation path.
- Port-contract doc-comments on the `ChatSessionReader`, `DiscoveryRunStore`/
  `DiscoveryRunQueue`, `EnrichmentRunStore`/`EnrichmentRunQueue`, and `Embedder`
  interfaces (ownership scoping, null-vs-empty-array, lifecycle idempotency).
- Tier annotations and an entry-point header in `src/index.ts`.

### Changed
- Replaced all `export type *` wildcard re-exports in `src/index.ts` with explicit
  named exports so the public surface is fully enumerated and reviewable. No
  symbols added or removed — the exported surface is unchanged.
- Expanded `README.md` to document the full public surface (graph factories,
  agents, MCP, tools) and link the stability policy.

## [4.2.0] - 2026-06-19

### Added
- Opportunity legibility: cards explain *why* an opportunity surfaced.
- Negotiation trace links on surfaced opportunities.

## [4.1.0] - 2026-06

### Added
- Canonical user-context / enrichment MCP tools; `discoverySource` rename
  (IND-372, IND-371, IND-374).
- Context-derived `read_user_profiles` payload (IND-364).

### Changed
- Category A prompt consumers repointed at the global `user_context` (IND-361).
- Premise pipeline ownership: dedup, LLM validity, richer provenance (IND-359).

## [4.0.0] - 2026-06-18

### Changed
- **BREAKING:** Eliminated the "profile" concept — the pipeline, files, service,
  controller, adapter, and exported types were renamed to `enrichment`
  (`ProfileDocument` → `UserIdentity`, `read_user_profiles` returns a flat
  identity+context payload, questioner `profile` mode → `enrichment`). Update any
  imports of the removed `Profile*` exports. (IND-368)

### Removed
- **BREAKING:** `user_profiles` table and the profile generate/aggregate/save path
  retired (IND-365).

## [3.6.0] - 2026-06-12

### Added
- `read_pending_questions` MCP tool, registered in the tool registry.

## [2.0.1] - 2026-06

### Fixed
- Post-`2.0.0` fixes and stabilization.

## [2.0.0] - 2026-06-08

### Changed
- **BREAKING:** Removed `configureProtocol` startup call — model configuration is
  read from the environment and `ModelConfig` is injected per-request via
  `ToolContext`. See README for migration.

## [1.0.0 - 1.23.3] - 2026-04 to 2026-06

Pre-2.0 line: established the adapter-injected LangGraph architecture (chat,
intent, opportunity, negotiation, premise, enrichment domains), the MCP server,
the matching/opportunity/premise eval harnesses, premise source tracking and
cascade retraction, network-scoped agents, and the agent registry. Reconstructed
from git history; not itemized.

<!--
Release tags stopped being created when publishing moved to the automated
subtree workflow: only v0.2.1 and v0.3.0 still exist in indexnetwork/protocol,
so every `compare/vX.Y.Z` link below 404s. They are kept for historical intent.
New entries link to the npm release instead, and [Unreleased] compares the
branches that actually define it.
-->

[Unreleased]: https://github.com/indexnetwork/protocol/compare/main...dev
[8.0.2]: https://www.npmjs.com/package/@indexnetwork/protocol/v/8.0.2
[4.3.0]: https://github.com/indexnetwork/protocol/compare/v4.2.0...v4.3.0
[4.2.0]: https://github.com/indexnetwork/protocol/compare/v4.1.0...v4.2.0
[4.1.0]: https://github.com/indexnetwork/protocol/compare/v4.0.0...v4.1.0
[4.0.0]: https://github.com/indexnetwork/protocol/compare/v3.6.0...v4.0.0
[3.6.0]: https://github.com/indexnetwork/protocol/compare/v2.0.1...v3.6.0
[2.0.1]: https://github.com/indexnetwork/protocol/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/indexnetwork/protocol/releases/tag/v2.0.0
