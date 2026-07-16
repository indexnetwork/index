# Academic Grounding Enhancement Backlog

Engineering backlog derived from [Theoretical Foundations of the Index Network Protocol](./Theoretical%20Foundations%20of%20the%20Index%20Network%20Protocol.md) (the NotebookLM v2 grounding report). Each item maps a theory-derived enhancement onto the concrete modules that would implement it, with sizing and an honest note on how much is genuinely new versus formalizing what already exists.

Ordering below is **our** priority order (implementation leverage ÷ risk), which differs from the report's ranking — the report's rank is noted per item. Sizes: **S** ≤ 1 day, **M** ≤ 1 week, **L** = multi-week / needs design doc.

> **Verified against the codebase (July 2026).** Every factual claim below was checked against source by an adversarial claim-verification pass (20 claims: 15 verified, 2 weakened, 3 falsified — corrections applied in place). Notable corrections: a premise-retract cascade **does** exist but is blanket rather than dependency-targeted (item 1); shipped HyDE uses free-text LLM-inferred *lenses*, not the hardcoded Mirror/Reciprocal/Neighborhood strategies described in the docs (item 4); contacts carry no source/interaction metadata usable for tie strength (item 7); and the opportunity lifecycle already includes intermediate `negotiating`/`stalled` states (item 2).

---

## 1. Premise dependency graph with revocation cascade — **M/L**

> **Status: shipped (IND-423).** `handlePremiseCascade` now expires only opportunities whose provenance cites the lapsed premise (`metadata.evidence` `sourcePremiseId`/`candidatePremiseId` or actor-level grounding `premise`), and re-verifies the user's intents grounded on it (embedding-proximity heuristic, capped) via `SemanticVerifier`, refreshing their felicity scores. No new schema was needed — the evidence recorded by `buildCandidateEvidence` was already persisted on the opportunity row. An explicit premise→intent provenance edge remains future work.

**Theory:** Schlangen & Skantze (2009), Incremental Unit model — grounded-in (`G`) links with confidence-propagation revocation. *(Report rank #1, Ch. 7.)*

**The real gap it fixes (corrected after code verification):** a retract cascade already exists, but it is **blanket, not dependency-targeted**. `retract_premise` (`premise/premise.tools.ts`) fires `PremiseEvents.onRetracted` (`services/api/src/adapters/chat.database.adapter.ts`), which `handlePremiseCascade` (`services/api/src/queues/premise.queue.ts`) resolves by expiring **all** of the user's `draft`/`latent`/`pending`/`negotiating` opportunities — “regardless of how far along they were” — even those grounded entirely in *other* premises. Context regeneration is likewise wholesale (`userContextQueue.addRegenJob`). Intents are never re-verified at all. So the problem is twofold: **over-invalidation** of unrelated in-flight opportunities and **under-invalidation** of intents whose felicity rested on the retracted premise.

**Work items:**
- Add a provenance edge set (premise → context paragraph, premise → intent, premise/context → opportunity evidence). The natural seam is `opportunity/opportunity.evidence.ts` — `buildCandidateEvidence` already records `sourcePremiseId`/`candidatePremiseId`/`candidateIntentId`/`sourceContextId` per candidate — plus the `premise_networks` / `user_contexts` tables (schema change owned by `services/api`).
- Rework `handlePremiseCascade` to walk the transitive closure instead of expiring everything: expire only opportunities whose evidence cites the retracted premise, and flag intents grounded on it for re-verification by `intent/intent.verifier.ts`.
- Keep it asynchronous where it already is: the queue/cron infrastructure lives in `services/api/src/queues/premise.queue.ts` (`startCrons` runs the hourly expiry sweep) — **not** the maintenance graph, which is feed-view-triggered and does not expire opportunities.

**Note:** do **not** import the full IU formalism (`⟨I, L, G, T, C, S, P⟩`); the useful core is the dependency edge + targeted revocation walk. This is closer to a truth-maintenance system than to incremental dialogue processing — the report's framing is a loan, not a law.

## 2. Uptake transition guard (pre-accept clarification) — **S/M** — **SHIPPED (IND-424)**

Implemented low-authority preparatory-condition questions when opportunities enter `pending`, an internal `uptake` detection purpose, and a flag-gated soft acceptance interlock across MCP, REST, web, connect links, CLI, and Hermes. The first accept attempt remains non-mutating until the user answers/dismisses the questions or explicitly acknowledges the current question IDs to continue anyway. No new lifecycle state was added.

**Theory:** Schlöder & Fernández (2014), clarification requests at the level of uptake; Clark (1996) joint-action ladder — verify *understanding* before *commitment*. *(Report rank #4, Ch. 10.)*

**Mostly formalizes what exists:** the Questioner agent already has `negotiation` and `negotiation_inflight` modes (`questioner/questioner.presets.ts`, mode enum in `shared/schemas/question.schema.ts`), and the lifecycle already includes intermediate `negotiating`/`stalled` statuses (`shared/interfaces/database.interface.ts` — the interfaces declare eight statuses, not five). Preparatory-condition scores are persisted per intent as `felicityAuthority` (`intent/intent.verifier.ts` → `intent/intent.graph.ts`). The verified gap: the accept path (`update_opportunity` in `opportunity/opportunity.tools.ts`) transitions `pending → accepted` without consulting pending questions — `mergePendingQuestions` is only invoked in the discover flow.

**Work items:**
- Extend the existing `negotiation` Questioner preset to target **preparatory conditions** of the counterparty ("can they actually do this?") when an opportunity reaches `pending` and the counterparty intent's `felicityAuthority` is low.
- In `update_opportunity`'s accept path, check for unresolved uptake questions and have the agent present them before offering the accept action. Keep it advisory — a hard new `pre-uptake` state is **not** needed; the existing `negotiating` status is the natural host for unresolved-uptake dwell time.

## 3. QUD-typed clarification in the elaboration loop — **S** — **SHIPPED (IND-425)**

Implemented a canonical three-value QUD taxonomy across IntentClarifier and the live intent/discovery Questioner presets, persisted it as internal question detection metadata, and added exact-match clarification evaluations.

**Theory:** Ginzburg (2012) QUD; Purver's clarification-request typology. *(Ch. 2; not in the report's top-6 but highest value-per-effort.)*

**Work items:**
- The entropy verdict is produced by `intent/intent.verifier.ts` and gated by `isVague(...)` in `intent/intent.graph.ts`; the clarifier's output schema (`intent/intent.clarifier.ts`) is untyped `{needsClarification, reason, suggestedDescription, clarificationMessage}`. Add a typed underspecification category — missing constituent (who/what), missing constraint (where/when/how much), or open alternative set — and emit the clarification question accordingly. (`intent.specificity.ts` is a one-line warning constant, not a check — ignore it.)
- Reuse the typology in the Questioner agent's discovery mode — **not** `opportunity/question.generator.ts`, which is `@deprecated` in favor of `QuestionerAgent`.
- Eval hook: extend `eval/premise` / `eval/matching` fixtures (case files + runners exist on both sides) with under-specified inputs and assert question type.

## 4. Frame-constrained HyDE generation — **M**

**Theory:** Fillmore frame semantics; report's "Frame-Constrained Generation Filter" against embedding drift. *(Ch. 4.)*

**Correction from code verification:** the hardcoded Mirror/Reciprocal/Neighborhood strategies described in the report (and in `src/README.md`) were **retired** — `shared/hyde/hyde.strategies.ts` states the system now uses free-text, LLM-inferred *lenses*. The report's Ch. 4 analysis applies to the M/R/N taxonomy as a conceptual layer only. The no-validation half of the claim held: `hyde.graph.ts` feeds generated text straight into embedding with no entity/constraint check.

**Work items:**
- Constrain **lens-based** generation (`shared/hyde/hyde.generator.ts` + `lens.inferrer.ts`) to frame elements extracted from the source intent (roles, constraints, domain vocabulary) — prompt-side slot discipline instead of free hallucination.
- Add a post-generation check in `hyde.graph.ts` (between generate and embed nodes) that rejects docs introducing entities/constraints absent from the source frame (cheap LLM check or lexical overlap heuristic).
- Measure on `eval/matching` before/after — this is the one item with an existing regression harness, so do it behind a flag and compare.
- ~~Housekeeping: update `src/README.md`, which still describes the retired M/R/N strategy registry.~~ Done in the same PR that introduced this backlog.

## 5. Dowty proto-role scoring in the evaluator — **M**

**Theory:** Dowty (1991) proto-role entailments. *(Report rank #6 was LANE; we recommend this half only, Ch. 5.)*

**Work items:**
- Extend `opportunity/opportunity.evaluator.ts`'s valency scoring rubric: instead of a categorical Agent/Patient/Peer call, score proto-agent entailments (volition, causation, capability) and proto-patient entailments (undergoes change, is the target) per candidate, then derive the role from the score profile. This makes borderline/symmetric cases (Peer) principled rather than vibes-based.
- **Skip LANE** (Levin alternation normalization): the evaluator consumes LLM judgments over natural-language intents, not parse trees; syntactic alternation normalization solves a problem this pipeline does not have.

## 6. Formal dialogue-game framing for negotiation — **M**

**Theory:** McBurney & Parsons (2001) dialogue games; Wells & Reed (2006) persuasion→negotiation (PP0→NP0) shift. *(Report rank #5, Ch. 8.)*

**Mostly formalizes what exists:** `negotiation/negotiation.protocol.ts` already defines versioned per-seat turn schemas (`outreach/counter/question/withdraw/accept/decline/ask_user`), terminality (`isTerminalAction`), and seat resolution — that *is* a dialogue game, undocumented as such.

**Work items:**
- Document the existing protocol as a formal game (locutions, combination rules via `allowedActionsFor`, commitment via persisted turns, termination via `isTerminalAction`) — a docs-only PR with high explanatory payoff.
- Implement the one genuinely new mechanism: **deadlock detection + mode shift**. After N consecutive `counter`/`question` turns without convergence (detectable in `negotiation.graph.ts` state), let `negotiation.agent.ts` legally shift from arguing merits to offering concessions/scope reductions, or escalate to `ask_user`. The protocol-version plumbing (`readProtocolVersion`) is the natural gate for rolling this out.

## 7. Tie-strength-gated context exposure — **L (design doc first)**

**Theory:** Granovetter tie strength; Mondal & Ur (2018) exposure control; SOCPRI contextual profiles. *(Report ranks #2–3, Ch. 9.)*

**Assessment (downgraded after code verification):** the most speculative cluster, and now known to be **data-blocked**. The structural pieces exist — network-scoped user contexts (`getUserContext(userId, networkId)` over `user_contexts`), personal networks (`personalNetworks`), scope intersection — but contacts carry **no tie-strength signals at all**: `ContactInput` is `{name, email}` only, persisted as bare `networkMembers` rows with `permissions=['contact']`. The only freshness signal in the system is intent-derived (`getContactsWithIntentFreshness`), not contact provenance or interaction history. Tie-strength classification therefore requires new data capture before any gating logic.

**Work items (deferred until a design doc exists):**
- First: capture the signals — contact source (import channel), interaction recency — as schema additions owned by `services/api`; only then classify tie strength (feeds `opportunity/opportunity.introducer.ts` routing too).
- Exposure preview at premise→network assignment time (`shared/assignment/network-assignment.policy.ts`, threshold 0.7): "assigning this premise makes it discoverable by ~N members of X."

## 8. Frame-drift monitoring — **S to start**

**Theory:** the report's own "Index Frame Drift Problem" — its most original contribution. Real even in the centralized implementation: per-network prompts, vocabularies, and embedding-model versions drift independently.

**Work items:**
- Start with measurement, not mechanism: a metric tracking per-network embedding centroid drift over time and cross-network match-rate decay. Note the maintenance graph (`maintenance/maintenance.graph.ts`) is **feed-view-triggered**, not periodic — a drift metric needs the cron infrastructure in `services/api/src/queues/premise.queue.ts` (`startCrons`) or a new scheduled job. Verified: no drift/centroid metric exists anywhere in `packages/protocol/src` today.
- Only if drift is observed: consider periodic vocabulary/prompt re-alignment. Evolutionary-game machinery is premature.

---

## Explicitly rejected from the report

| Proposal | Why rejected |
|---|---|
| Cryptographic felicity verification, dual-signature consent handshakes, "Goffman Faceted Database" isolation (v1 remnants) | No cryptographic layer exists or is warranted; the theories ground the *semantics*, not a key ceremony. |
| Full AGM belief-revision engine | Flagged by the report itself in v2; superseded by item 1. |
| LANE (Levin Alternation Normalization Engine) | Solves a syntactic problem the LLM-judgment pipeline doesn't have; see item 5. |
| Hard `pre-uptake` lifecycle state | The lifecycle already has intermediate `negotiating`/`stalled` states; advisory uptake questions riding `negotiating` (item 2) capture the value. |
