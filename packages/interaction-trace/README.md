# interaction-trace

A prototype for observing what happens when agents negotiate on behalf of people. It rebuilds, for one opportunity, what each principal wanted, how each agent read it, what was exchanged, whether an agent stayed inside the authority it was given, and whether the result served the original purpose.

It is not infrastructure observability. It reads one negotiation (an opportunity), annotates it in layers, stores the result in a separate `trace` schema, and Grafana draws it.

## Layers

| Layer | Standard it borrows from | What it stores |
| --- | --- | --- |
| Statements and derivation | W3C PROV shape (a statement, and a claim derived from it) | `trace.statement`, `trace.claim` |
| Turn acts | FIPA ACL performatives (propose, accept-proposal, reject-proposal, query-if, inform, refuse) and Searle speech acts | `trace.turn_act` |
| Fidelity | thin custom layer | `trace.fidelity`, `trace.term_delta` |
| Adversarial findings | OWASP Top 10 for LLM Apps 2025 and MITRE ATLAS labels | `trace.finding` |
| Outcome | thin custom layer | `trace.outcome` |

OpenTelemetry GenAI conventions are not implemented. Exporting the trace as OTel spans is a later path, not part of this prototype.

The label mapping is in `src/taxonomy.ts`. Three of the five kinds (`authority_bait`, `pressure`, `selective_misrepresentation`) map only approximately; the flag is stored with the finding and shown on the board.

## How a trace is built

1. `loadTrace` reads one opportunity from the database (read-only) and builds the sources: the two principals' briefs, decisions and stalls, and the negotiation turns. Messages scoped to other opportunities are excluded. Principal names are replaced by `[A]` and `[B]`.
2. A `Completer` annotates the trace. `RecordedCompleter` replays a stored bundle. `OpenRouterCompleter` calls a model live (`OPENROUTER_API_KEY`, `TRACE_ANNOTATOR_MODEL`, default `google/gemini-3.7-flash`).
3. A deterministic verifier drops every annotation whose quote is not found in the source it points at (compared after NFKC, whitespace, case and typographic-quote normalisation, minimum 4 characters). An annotation that cannot show its words is not stored.
4. Deterministic code, not the model, derives the performative defaults, the human outcome and the outcome class.
5. `persist` writes the record to the `trace` schema.

Human outcome: `not_reached` when the agents never agreed; otherwise `both_committed` (two commits), `declined`, `one_committed`, `expired` or `open`.

Outcome class: `confirmed_fit` (agreed and both committed), `assessment_failure` (agreed, then the human declined or it expired), `missed_opportunity` (agents declined or closed, with a verified quote that the opportunity was a fit), otherwise `unresolved`.

## Running it

```bash
bun install
export TRACE_DATABASE_URL=postgres://...   # a dev branch of production, never the primary
bun run src/cli.ts dump <opportunity-id>
bun run src/cli.ts analyze <opportunity-id> --annotations <file>
bun run src/cli.ts analyze --fixture fixtures/fx06-injection-yielded.json --no-persist
bun run src/cli.ts eval
bun run src/cli.ts eval-real [--persist]
bun run src/cli.ts scan --limit 400
bun test
```

The schema is `sql/001_trace_schema.sql`. Apply it to the dev branch with an owner role, then give Grafana a login that is read-only (`default_transaction_read_only`) and has no access to `public` or `analytics`.

Safety rule: `TRACE_DATABASE_URL` must point at a dev branch of the production database, never the primary. The loader only reads and the writer only touches the `trace` schema, but real negotiation text ends up in that branch.

## What was measured, and what was not

- No live LLM annotator was run, so there is no measured annotator accuracy. The stored annotations are `manual-agent` annotations, and the gold labels were written by the same author, so agreement between them is not an independent result.
- The 14 scripted fixtures (10 with seeded conduct, 4 hard negatives) replayed through the verifier reach 100% precision and recall, and 99 of 99 annotations survive the quote check. This is a pipeline check. A control that replaces every quote with invented wording keeps 0 of 99 and stores no findings, which shows the verifier does reject ungrounded annotations.
- The keyword baseline (no model) on the fixtures: precision 67%, recall 80% (8 true positives, 4 false positives, 2 misses). It misses both `selective_misrepresentation` cases and fires on phrases that only mention a topic.
- On real data the baseline is much worse: it was run over 400 random real negotiations and its 9 hits were all false positives on review.
- Real cases: 15 were chosen and hand-labelled. 3 of the 15 were picked by hand, not drawn at random, and only 1 contains a labelled finding (a selective misrepresentation). The real data is dominated by benign negotiations, so there are almost no real adversarial examples to measure against. The number on the real cases (1 of 1) is not a precision or recall estimate.
- Pseudonymization replaces the two principals' names only. Other names, companies, places and contact details in the text are not removed.
- Hand annotations of the real cases are in `annotations/real/` and are gitignored because they quote real text. The gold file `fixtures/real-gold.json` holds ids, kinds, turn indices and short notes only.

## Deviations from the plan

- The live completer is a small OpenRouter client, not an agent framework, and it is unmeasured.
- No OpenTelemetry export.
- The HTML report from the plan was replaced by Grafana boards (see `ops/grafana`).
