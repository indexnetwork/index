# Agent enhancement TODO

- One small slice at a time: inspect the code, discuss findings, and revise the plan as needed.
- Each slice ends with working behavior and a focused check. Detailed contracts stay in the linked specs.
- Scope: the full [agent enhancement design](design.md).

## Preparation

- [ ] Review and reuse `refactor/remove-hyde-lenses`, including its existing migration. [Baseline](discovery.md#current-behavior-and-baseline)
- [ ] Agree checkpoint JSON conversion while preserving history, questions and search evidence. [Storage](spec.md#database-touches)

## Vertical slices

- [ ] Correct personal-agent identity and supply confirmed principal context. [Instructions](agent-instructions.md#system-prompts)
- [ ] Let H2A search and refine queries with `discover_counterparties`; remove the separate pursuit loop. [Discovery](discovery.md#tool-contracts)
- [ ] Let H2A open a selected candidate, saving its private brief before A2A starts. [Opening](discovery.md#opening-and-brief-ordering)
- [ ] Keep briefs across eligible A2A turns while H2A is idle; preserve turn and concurrency guards. [Negotiations](negotiations.md#local-execution)
- [ ] Review the whole intent, including inbound/passive work, and save selected briefs before resuming. [Briefs](briefs.md#handoff)
- [ ] Preserve scoped authority and conditions; distinguish agreements from permission and execution. [Authority](agent-instructions.md#authority-boundary)
- [ ] Replace A2A input requests with local pause; let H2A author questions and remove child queues/wakeups. [Pause](negotiations.md#local-execution)
- [ ] Present stable, independent question batches with correct scopes and suggestions. [Questions](question-batches.md#ask)
- [ ] Save complete answer batches atomically, update callers, then reconsider the whole intent. [Answers](question-batches.md#answer)
- [ ] Accept direct corrections during a batch; retire obsolete questions and invalidate stale decisions. [Corrections](question-batches.md#answer)
- [ ] Send useful replies/outcome updates, combine useful actions, and otherwise stay silent. [H2A review](design.md#h2a-review)
- [ ] Discuss and decide context waiting, recurring wakes, deadlines and recovery before implementing them. [Open decisions](wake-patterns.md#open-decisions)
- [ ] Let H2A wait without blocking A2A or holding a model call open. [Waiting](wake-patterns.md#agent-judgment-vs-runtime-guarantees)
- [ ] Activate H2A independently for intent readiness, paused work and inbound negotiations. [Wakes](wake-patterns.md#control-flow)
- [ ] Handle real deadlines and overdue work using original temporal evidence. [Deadlines](wake-patterns.md#open-decisions)
- [ ] Restore history, questions, briefs and uncertain openings without duplicates or blanket reruns. [Recovery](discovery.md#opening-and-brief-ordering)

## As slices are completed

- [ ] Update affected APIs, callers and examples together; remove replaced code and keep scope boundaries. [Implementation map](spec.md)
- [ ] Check the linked acceptance cases and record remaining gaps. Run broader checks and prepare a `dev` PR when ready. [Verification](spec.md#verification-for-implementation)
