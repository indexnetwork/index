# Agent enhancement TODO

- Accepted now: H2A wakes only on an accepted user message, including an explicit answer to a displayed question. A2A never wakes H2A.
- Accepted ownership: intent-scoped H2A owns questions and decides whether to ask; negotiations stall independently, with no question linkage or answer waits.
- Accepted A2A context: only the H2A-maintained private brief; no separate task, raw intent, principal profile, H2A history or question context. Keep protocol intent IDs for ownership and pair identity.
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

- [ ] Review and reuse `refactor/remove-hyde-lenses`, including its existing migration. [Baseline](discovery.md#current-behavior-and-baseline)
- [ ] Agree checkpoint JSON conversion while preserving history, questions and search evidence. [Storage](spec.md#database-touches)
- Deletion first: replace the request/question bridge with independent stall and brief behavior, deleting the child queues and answer promises together with their callers.
- Database audit: `agent_sessions` still stores history linkage, checkpoints and execution leases. `protocol_hyde_documents` still has live discovery callers; remove it with the reference discovery replacement and its existing migration.

## Remaining vertical slices

- [ ] Correct personal-agent identity and supply confirmed principal context to H2A. [Instructions](agent-instructions.md#system-prompts)
- [ ] Let H2A search and refine queries with `discover_counterparties`; remove the separate pursuit loop. [Discovery](discovery.md#tool-contracts)
- [ ] Let H2A open a selected candidate, saving its private brief before A2A starts. [Opening](discovery.md#opening-and-brief-ordering)
- [ ] Keep briefs across eligible A2A turns while H2A is idle; remove separate A2A task/intent and direct principal-context inputs, preserving protocol identity, turn and concurrency guards. [Negotiations](negotiations.md#local-execution)
- [ ] Review the whole intent, including inbound/passive work, and save selected briefs before resuming. [Briefs](briefs.md#handoff)
- [ ] Preserve scoped authority and conditions; distinguish agreements from permission and execution. [Authority](agent-instructions.md#authority-boundary)
- [ ] Replace A2A input requests with local pause; let H2A author questions and remove question linkage, child queues and answer waits. [Pause](negotiations.md#local-execution)
- [ ] Present stable, independent H2A question batches with clear wording and suggestions, without negotiation references. [Questions](question-batches.md#ask)
- [ ] Save complete answer batches atomically, update callers, then reconsider the whole intent. [Answers](question-batches.md#answer)
- [ ] Accept direct corrections during a batch; retire obsolete questions and invalidate stale decisions. [Corrections](question-batches.md#answer)
- [ ] During a user-triggered review, send useful replies/outcome updates, combine useful actions, and otherwise stay silent. [H2A review](design.md#h2a-review)
- [ ] Let H2A end a review and wait for the next user message without blocking A2A or holding a model call open. [Waiting](wake-patterns.md#agent-judgment-vs-runtime-guarantees)
- [ ] Restore history, questions, briefs and uncertain openings without duplicates or blanket reruns. [Recovery](discovery.md#opening-and-brief-ordering)

## Deferred wake behavior

- Later: wake H2A when the user comes online; presence detection and its wake policy are not part of this implementation.
- Intent/assignment readiness, recurring wakes, deadline delivery and automatic recovery wakes remain deferred; [wake-pattern proposals](wake-patterns.md#open-decisions) do not authorize additional triggers now.
- Paused work, inbound negotiations and unreported outcomes wait for the next user message when they need H2A attention.
- [ ] Discuss and decide any further activation sources, deadline/overdue behavior and recovery timing before implementing them; preserve original temporal evidence. [Open decisions](wake-patterns.md#open-decisions)

## As slices are completed

- [ ] Update affected APIs, callers and examples together; remove replaced code and keep scope boundaries. [Implementation map](spec.md)
- [ ] Check the linked acceptance cases and record remaining gaps. Run broader checks and prepare a `dev` PR when ready. [Verification](spec.md#verification-for-implementation)
