# Agent enhancement TODO

- Accepted now: H2A wakes only on an accepted user message, including an explicit answer to a displayed question. A2A never wakes H2A.
- Accepted ownership: intent-scoped H2A owns questions and decides whether to ask; negotiations stall independently, with no question linkage or answer waits.
- Accepted A2A context: only the H2A-maintained private brief; no separate task, raw intent, principal profile, H2A history or question context. Keep protocol intent IDs for ownership and pair identity.
- Accepted runtime: reconstruct context from durable records at each permitted activation; remove `agent_sessions` and mutable `PrincipalState` checkpoints. Persist messages, explicit delegations and domain effects; keep searches and execution machinery in memory. [Reconstruction](design.md#runtime-reconstruction)
- Ownership: user input activates H2A; A2A continues eligible negotiation work and records observations while H2A is idle.
- One small slice at a time: start with the wake boundary below, then inspect and revise the remaining plan as needed.
- Each slice ends with working behavior and a focused check. Detailed contracts stay in the linked specs.
- Scope: the [agent enhancement design](design.md), with its broader automatic-wake proposals deferred by the rule above.

## First slice: prevent A2A from waking H2A

- [x] Make accepted `message()` / `answer()` input the only H2A activation source in [PrincipalInbox](../../packages/agent/src/negotiation/principal.inbox.ts).
- [x] Remove H2A scheduling from A2A requests, outcomes and cancellation, including checkpoint callbacks and queue-driven rescheduling after a review. A2A activity during a user-triggered review must not cause another activation.
- [x] Remove automatic inbox `resume()` scheduling during [agent restoration](../../packages/agent/src/negotiation/negotiation.agent.ts); host startup, scans and negotiation notifications must not indirectly activate H2A.
- [x] Preserve accepted user input arriving during an active review; pending user input may schedule its processing, but queued A2A work alone may not.
- [x] Delete `schedule()`, its timer, queue-based `hasWork()` and the unused request `reviewed` flag; serialize reviews directly from accepted input.
- [x] Delete the unused generic timer-driven `Inbox`, its exports and its README example; no repository callers remain.
- [x] Update the agent-TUI input hint and documentation for user-triggered reviews; retain the current message/answer API for this slice.
- [x] Verify the cases below before starting the remaining enhancements.

- Slice boundary: remove automatic activation and unused wake code, including the `reviewed` checkpoint field; retain current negotiation execution, queues and history. Discovery integration, local pause, queue removal and question batches follow separately.
- No database schema or checkpoint conversion is needed for this slice; the preparation below does not block it.
- Verification: temporary scripted-model checks cover input acceptance, checkpoint timing, active-review races, A2A lifecycle and restoration. A headless TUI check covers opening, sending, answering and layout changes. All 26 existing agent tests, agent and TUI typechecks/builds, API typecheck and root lint pass; lint reports 35 existing warnings. Live-model behavior remains unchecked.
- Review status: first slice approved for commit and push.
- Remaining limit: the current review still allows one decision and only a reply to direct messages; independent questions and brief-only A2A context are subsequent changes.

| Acceptance scenario | Expected behavior |
|---|---|
| User sends an accepted message or answers a displayed question | H2A processes that user input. |
| A2A requests input, advances, ends, fails or cancels work while H2A is idle | No H2A model call. |
| A2A activity arrives during a user-triggered review | No additional H2A activation from that activity or the review's completion callback. |
| Another accepted user message arrives during a review | Its processing is preserved. |
| Session restores queued requests/outcomes, or the host scans updated negotiations | No H2A activation without new user input. |
| User opens the app or comes online without sending a message | H2A stays idle. |

## Preparation for remaining enhancements

- [x] Review `refactor/remove-hyde-lenses` at `7e09f7998`, including its existing migration and automatic pursuit callers. [Reuse review](discovery.md#reference-reuse-review)
- [ ] Reuse its retrieval/opening code and migration with the H2A discovery/opening slices; keep the separate pursuit loop out of this branch. [Baseline](discovery.md#current-behavior-and-baseline)
- [ ] Choose the minimal record layout for private delegations, question retirements and opening reconciliation; define ownership, duplicate-effect and stale-context checks before removing the session lease. [Storage decisions](spec.md#open-storage-and-coordination-decisions)
- [ ] Plan one-time conversion of existing questions, usable delegation evidence and unresolved openings before dropping `agent_sessions`; discard runtime snapshots and search caches, preserving canonical history. [Storage](spec.md#database-touches)
- Deletion first: replace the request/question bridge with independent stall and brief behavior, deleting the child queues and answer promises together with their callers.
- Database audit: `agent_sessions` currently stores history linkage, checkpoints and execution leases; replace its callers and required host guarantees, then delete the table. `protocol_hyde_documents` still has live discovery callers; remove it with the reference discovery replacement and its existing migration.

## Remaining vertical slices

- [x] Correct personal-agent identity and verify the existing confirmed-principal-context input to H2A. [Instructions](agent-instructions.md#system-prompts)
- Identity verification: agent typecheck, all 26 existing tests and build pass; focused lint passes with one existing warning. Live-model behavior remains unchecked. Identity slice approved for commit and push.
- [x] Replace `PrincipalState` / `PrincipalStore` snapshot persistence with record reads and explicit effect writes; reconstruct H2A and A2A context and discard each run's working state. [Reconstruction](design.md#runtime-reconstruction)
- Reconstruction boundary: existing `messages` hold canonical history and typed private delegation/retirement records; no new tables. Migration 0182 converts questions and advisory review notes, then drops only `agent_sessions.state` and `revision`. The existing execution lease remains. [Record layout](spec.md#implemented-reconstruction-boundary)
- Required queue replacement: one independent H2A question, persisted briefs and local A2A pause replace saved child requests and answer promises. Discovery/opening, question batches, corrections and lease replacement remain separate.
- Verification: temporary scripted-model checks cover wake boundaries, exact question restoration, accepted-input races, stale/failed effects, brief isolation/retention, pause, duplicate notifications and uncertain POSTs. Isolated local Postgres checks cover conversion, ownership, atomic rollback and private-record visibility. Headless TUI checks exercise the real renderer and keyboard flows for sending, suggested/custom answers, pause, turns, resize and intent switching. All 26 agent tests, agent/TUI builds and checks, API typecheck, web build, schema drift and lockfile checks pass. Root lint passes with 35 existing warnings. Live default-model checks cover H2A asking for availability, conditional answer → private brief → two-agent agreement, accurate agreement-versus-execution reporting, and A2A pause for missing credentials without H2A activation. Broader model acceptance cases remain pending. Reconstruction slice approved for commit and push.
- [x] Let H2A search and refine queries with `discover_counterparties`; remove the separate pursuit loop and persisted search history. Search IDs and candidates live only within the current activation. [Discovery](discovery.md#tool-contracts)
- Search slice boundary: the API injects authorized explicit-query retrieval into the user-triggered H2A review; hosts without retrieval omit the tool. No separate pursuit loop or persisted search history existed in this baseline, and none was imported. Existing HyDE discovery/automatic opening and its table remain for slice 2; the new search path neither invokes them nor opens negotiations.
- Search verification: all 26 agent tests, agent/discovery builds and typechecks, API and agent-TUI typechecks pass. Root lint passes with 35 existing warnings. Temporary scripted checks cover validation, refinement/empty results, activation-local evidence, accepted-input interruption, retrieval hydration/ranking/deduplication, live membership/scope rejection and cancellation. No live-model or database integration checks were run. Search slice awaits review; no commit was made.
- [ ] Let H2A open a selected candidate, saving its private brief before A2A starts. [Opening](discovery.md#opening-and-brief-ordering)
- [ ] Remove obsolete HyDE pipeline, drop `protocol_hyde_documents` table, and purge dead background discovery code:
  - Database: drop `protocol_hyde_documents` table and its 2000-dimensional HNSW index via migration (`0183_drop_protocol_hyde_documents.sql`); remove `hydeDocuments` and `HydeSourceType` from `database.schema.ts`.
  - API services & adapters: delete `hyde.database.adapter.ts`, old automatic background discovery pipeline (`services/api/src/lib/opportunity/discovery.ts`, `discovery.shared.ts`, `discovery-trigger.builders.ts`, `discovery.intent-lock.ts`), HyDE document indexing/maintenance jobs in `services/api/src/lib/intent/indexing.ts`, and HyDE inspection in `debug.controller.ts`.
  - Discovery package: delete dead lens generation, candidate evaluation, and HyDE preparation modules (`candidate.evaluator.ts`, `candidate.search.ts`, `candidate.retrieval.ts`, `discovery.preparation.ts`, `match.verifier.ts`, `discovery.prompt.ts`), keeping only clean `CandidateDiscovery` and shared retrieval types.
  - Protocol package: clean up obsolete HyDE types, mocks, and specifications in `opportunity.graph.spec.ts` and runtime follow-ups.
- [ ] Implement an agent domain event system tracking all noteworthy agent lifecycle, discovery, and negotiation transitions:
  - Intent lifecycle triggers (`intent.created`, `intent.broadcast`, `intent.updated`, `intent.archived`): automatically trigger initial H2A discovery upon intent creation or network broadcast, and handle intent termination cleanly without requiring a manual user chat prompt.
  - Discovery & candidate tracking (`discovery.searched`, `discovery.candidate_evaluated`, `negotiation.opened`): record query terms, similarity thresholds, candidates retrieved, and candidate selections.
  - H2A interaction & decision tracking (`h2a.review_completed`, `question.asked`, `question.answered`, `question.retired`, `delegation.brief_saved`): track user input acceptance, question/answer lifecycles, retirements, and private brief issuances.
  - A2A negotiation tracking (`negotiation.inbound`, `negotiation.turn_submitted`, `negotiation.paused`, `negotiation.settled`): record counterparty match arrivals, turns taken, local pauses, and terminal settlements.
  - Authority & execution tracking (`authority.requested`, `action.executed`): capture explicit principal consent requests and verified real-world/protocol execution.
- [x] Keep briefs across eligible A2A turns while H2A is idle; remove separate A2A task/intent and direct principal-context inputs, preserving protocol identity, turn and concurrency guards. [Negotiations](negotiations.md#local-execution)
- [ ] Review the whole intent, including inbound/passive work, and save selected briefs before resuming. [Briefs](briefs.md#handoff)
- [ ] Preserve scoped authority and conditions; distinguish agreements from permission and execution. [Authority](agent-instructions.md#authority-boundary)
- [x] Replace A2A input requests with local pause; let H2A author questions and remove question linkage, child queues and answer waits. [Pause](negotiations.md#local-execution)
- [ ] Present stable, independent H2A question batches with clear wording and suggestions; derive pending questions from issued, answered and explicitly retired records, without negotiation references or a saved pending array. [Questions](question-batches.md#ask)
- [ ] Save complete answer batches atomically, update callers, then reconsider the whole intent. [Answers](question-batches.md#answer)
- [ ] Accept direct corrections during a batch; retire obsolete questions and invalidate stale decisions. [Corrections](question-batches.md#answer)
- [ ] During a user-triggered review, send useful replies/outcome updates, combine useful actions, and otherwise stay silent. [H2A review](design.md#h2a-review)
- [ ] Let H2A end a review and wait for the next user message without blocking A2A or holding a model call open. [Waiting](wake-patterns.md#agent-judgment-vs-runtime-guarantees)
- [ ] Reconstruct from committed history, questions, delegations and protocol records after interruption; reconcile uncertain openings and reassess only at the next permitted activation, without restoring an execution snapshot or blanket reruns. [Recovery](discovery.md#opening-and-brief-ordering)
- [ ] Apply the agreed data conversion, remove `agent_sessions`, its revision counter and checkpoint-only APIs/callers; verify effect deduplication, ownership and stale-decision rejection independently of session state. [Storage](spec.md#database-touches)

## Deferred wake behavior

- Later: wake H2A when the user comes online; presence detection and its wake policy are not part of this implementation.
- Recurring wakes, deadline delivery and automatic recovery wakes remain deferred; [wake-pattern proposals](wake-patterns.md#open-decisions) do not authorize additional triggers now. Intent lifecycle events (`intent.created`, `intent.broadcast`) are prioritized above to trigger proactive discovery.
- Paused work, inbound negotiations and unreported outcomes wait for the next user message when they need H2A attention.
- [ ] Discuss and decide any further activation sources, deadline/overdue behavior and recovery timing before implementing them; preserve original temporal evidence. [Open decisions](wake-patterns.md#open-decisions)

## As slices are completed

- [ ] Update affected APIs, callers and examples together; remove replaced code and keep scope boundaries. [Implementation map](spec.md)
- [ ] Check the linked acceptance cases and record remaining gaps. Run broader checks and prepare a `dev` PR when ready. [Verification](spec.md#verification-for-implementation)
