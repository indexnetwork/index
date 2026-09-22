# Negotiation comparison

Run from the repository root with local credentials:

```sh
bun --env-file=.env.development packages/agent/evals/negotiation.compare.ts
```

This sends the eight fictional cases to OpenRouter and TypeSafe. It compares the
Jev gate committed at `3e6e277aa` against the working tree's single negotiator,
using three repetitions per case and alternating which implementation runs first.
The baseline is extracted to a temporary directory; runtime code has no mode flag.

Both receive equivalent source evidence, canonicalized and checked by SHA-256 for each run,
the same fixed date, and the same requested writer model (`google/gemini-3.7-flash`).
The gate uses `jev-latest`; each response's actual model, confidence, probabilities,
and usage are saved. OpenRouter routing and latency can still vary.

The user approved these expected outcomes on 2026-09-21. Labels never enter prompts:

| Case | Expected action |
|---|---|
| Intent already answers the writing/sound preference | Answer with `propose` |
| Engineering confirmed, required keyboard-first preference missing | `stall` |
| Ask-before unresolved; only an agent claims approval | `stall` |
| Human approval supersedes stale brief | Answer with `propose` |
| Explicit Saturday scheduling contradiction | `decline` |
| Budget unknown; only the brief claims no funding | `stall` |
| Only the counterpart's required location is unknown | Ask counterpart with `counter` |
| Required qualification appears only in an unconfirmed profile | `stall` |

The private result directory contains the contexts, source patch, prompts, model
outputs, Jev results, and timings. `summary.json` counts unsupported advances,
incorrect declines, unnecessary principal question requests, exact action matches,
and errors. Review the generated messages and suggested questions as well: the
automatic score judges actions, not whether every sentence is grounded.

Latency covers the complete `negotiate()` call, including the Jev request for the
baseline and every writer completion in either path. It excludes discovery, H2A
question generation, host persistence, and human response time. A stall requests
a question; it does not guarantee the principal agent will actually ask it.
Three repetitions of eight selected cases are a small regression sample, not a
general accuracy estimate. This compares two workflows, not isolated model skill.

## Results — 2026-09-21

This initial comparison used the single negotiator later committed as `91999e803`,
before the prompt and execution optimizations described below.

The user confirmed all eight expected outcomes before the run. Each case ran three
times per workflow. All evidence hashes matched across workflows and repetitions;
the TypeSafe responses all identified `jev-1.13.0`.

| Metric | Single negotiator | Jev gate + writer |
|---|---:|---:|
| Expected action | 21/24 | 24/24 |
| Unsupported advances | 0 | 0 |
| Incorrect declines | 3 | 0 |
| Unnecessary principal question requests | 0 | 0 |
| Execution errors | 0 | 0 |
| Median complete negotiation | 6.85 s | 5.90 s |
| Mean complete negotiation | 8.88 s | 5.91 s |
| p95 complete negotiation | 24.73 s | 7.07 s |

All three incorrect declines occurred in case 6. The single negotiator repeated
the brief's unsupported claim that Alex had no funding; Jev required a question
about the unknown budget in every repetition. Reviewing the other generated
turns and suggested questions found no additional substantive grounding errors
in this sample. Both paths correctly distinguished principal questions from
counterpart questions and used later human approval over a stale brief.

Both workflows made 48 writer completions. The gate additionally made 24 Jev
requests, averaging 461 ms (median 362 ms), yet the complete gated workflow was
faster in this run. That observation does not establish why: provider routing,
caching, and model latency were uncontrolled. Part of the first repetition
overlapped the TUI smoke test; repetitions 2 and 3 ran after it reached idle and
also had lower median latency with the gate. Costs were not measured.

This initial result was superseded by the grounded follow-up below. The eight
cases did not then resolve the broader context-scoping, question-relevance, or
duplicate-question findings.

A separate `agent-tui` smoke test through `tmux`, with `TYPESAFE_API_KEY` deleted
from the process, completed without Jev calls or execution errors. Confirming
only engineering kept Alice stalled for her missing keyboard preference;
confirming that preference resumed her negotiation. This verifies functionality,
not a quality improvement across the six full scenarios.

Local artifacts: [raw comparison results](/var/folders/zv/4gh061xd33xf_fkc24y6ddjw0000gn/T/index-negotiation-compare-ATUyeY/results.jsonl),
[comparison summary](/var/folders/zv/4gh061xd33xf_fkc24y6ddjw0000gn/T/index-negotiation-compare-ATUyeY/summary.json),
and [TUI smoke report](/private/tmp/index-agent-grounded-m1WZH8/smoke.report.md).

## Prompt and execution optimization — 2026-09-21

Compared the single negotiator at `91999e803` with the optimized working tree,
using the same eight approved cases once each, alternating execution order.
Both requested `google/gemini-3.7-flash`; all responses reported Google as provider
and no cached tokens. This follow-up did not call Jev.

| Metric | Before | After |
|---|---:|---:|
| Expected action | 7/8 | 8/8 |
| Writer completions | 16 | 8 |
| Median first-request input tokens | 1,977.5 | 1,194.5 |
| Total input tokens, including follow-up completions | 32,189 | 9,696 |
| Median complete negotiation | 6.291 s | 4.663 s |
| Provider-reported total cost for eight cases | $0.0400605 | $0.02442075 |
| Execution errors | 0 | 0 |

Every optimized run recorded its turn or stall on its first completion. The budget
case correctly asked for missing information in this pass. Reviewing the generated
turns and suggested questions found no substantive grounding error in these eight
outputs. One repetition is a functionality and performance smoke check; it does
not settle the earlier grounding finding or replace the Jev comparison.

Offline checks compared the eight fixtures plus 337 captured negotiation contexts
with the committed implementation. Source evidence was identical in all 345 cases.
Removed `terms` text matched the last retained turn; the other negotiation metadata
was preserved. Serialized first-request size, including tool definitions, fell by
38.3% on average. The principal agent retains its facts and pending question text,
with open questions referenced by ID instead of copied into a second list.

Control-flow checks covered successful turn/stall termination, correction after
unknown tools, invalid JSON and rejected actions, the existing step cap,
cancellation, skipping calls after a terminal success, and continued multi-step
principal-agent execution. Agent checks/build, focused lint, and agent-tui checks
passed. No new repository specs were added.

Local artifacts: [live results and provider usage](/private/tmp/index-agent-prompt-VQts7x/live.jsonl),
[live summary](/private/tmp/index-agent-prompt-VQts7x/live-summary.json),
and [request-size comparisons](/private/tmp/index-agent-prompt-VQts7x/prompt-sizes.json).

## Grounding and quality follow-up — 2026-09-22

After grounding the brief, retaining general human facts across opportunities,
and retiring covered questions, the full three-repetition comparison was rerun.
Each workflow received equivalent source evidence, canonicalized and checked by
SHA-256 on every run.

| Metric | Single negotiator | Jev gate + writer |
|---|---:|---:|
| Expected action | 24/24 | 24/24 |
| Unsupported advances | 0 | 0 |
| Incorrect declines | 0 | 0 |
| Unnecessary principal-question requests | 0 | 0 |
| Execution errors | 0 | 0 |
| Median complete negotiation | 4.619 s | 5.931 s |
| Mean complete negotiation | 4.764 s | 6.304 s |
| p95 complete negotiation | 7.375 s | 7.754 s |

The unknown-budget case stalled for real budget information in all three single
negotiator runs. The current single path was 1.312 seconds faster at the median
than the gated workflow in this sample. This is still a small controlled
regression sample, not a general model-quality estimate.

The `agent-tui` regression work exercised all six bundled scenarios. The final
research sweep confirmed that a mapping/visualization answer on one opportunity
resumed both relevant negotiations without carrying over opportunity-specific
approval. The final local-friendship sweep removed an unnecessary question about
sketching and café stops; it retained questions about stated route, day, and
stroller constraints. The community fixture reached idle in current runs without
reproducing the earlier principal-agent timeout. Those runs also kept budget and
location questions tied to explicit requirements.

The single negotiator remains the runtime path. `TypeSafeClient` stays available
for fixed-case comparisons; Jev is not called during a negotiation.
