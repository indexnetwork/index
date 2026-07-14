# Academic Grounding Enhancement Backlog

Engineering backlog derived from [Theoretical Foundations of the Index Network Protocol](./Theoretical%20Foundations%20of%20the%20Index%20Network%20Protocol.md) (the NotebookLM v2 grounding report). Each item maps a theory-derived enhancement onto the concrete modules that would implement it, with sizing and an honest note on how much is genuinely new versus formalizing what already exists.

Ordering below is **our** priority order (implementation leverage ÷ risk), which differs from the report's ranking — the report's rank is noted per item. Sizes: **S** ≤ 1 day, **M** ≤ 1 week, **L** = multi-week / needs design doc.

---

## 1. Premise dependency graph with revocation cascade — **M/L**

**Theory:** Schlangen & Skantze (2009), Incremental Unit model — grounded-in (`G`) links with confidence-propagation revocation. *(Report rank #1, Ch. 7.)*

**The real gap it fixes:** `premise/premise.tools.ts#retract_premise` sets `status: retracted` and premise changes cascade into `context/context.generator.ts` regeneration — but nothing invalidates **downstream artifacts derived from the retracted premise**: user contexts already embedded, intents whose felicity was grounded on it, and `latent`/`pending` opportunities whose evidence cites it.

**Work items:**
- Add a provenance edge set (premise → context paragraph, premise → intent, premise/context → opportunity evidence). The natural seam is `opportunity/opportunity.evidence.ts` (already builds per-candidate evidence) plus the `premise_networks` / `user_contexts` tables (schema change owned by `services/api`).
- On retract/expire, walk the transitive closure: mark dependent user contexts stale (already partially done via regeneration), demote or expire dependent `latent` opportunities, and flag dependent intents for re-verification by `intent/intent.verifier.ts`.
- Surface the cascade in the maintenance graph (`maintenance/maintenance.graph.ts`) as a periodic sweep rather than a synchronous purge — matches the existing feed-health pattern.

**Note:** do **not** import the full IU formalism (`⟨I, L, G, T, C, S, P⟩`); the useful core is the dependency edge + revocation walk. This is closer to a truth-maintenance system than to incremental dialogue processing — the report's framing is a loan, not a law.

## 2. Uptake transition guard (pre-accept clarification) — **S/M**

**Theory:** Schlöder & Fernández (2014), clarification requests at the level of uptake; Clark (1996) joint-action ladder — verify *understanding* before *commitment*. *(Report rank #4, Ch. 10.)*

**Mostly formalizes what exists:** the Questioner agent (`questioner/questioner.agent.ts`, presets in `questioner.presets.ts`) and negotiation `question` turns are already proto–uptake-CRs. The gap is that nothing structurally sits between *opportunity understood* and *opportunity accepted*.

**Work items:**
- Add a `negotiation`-mode Questioner preset targeting **preparatory conditions** of the counterparty ("can they actually do this?") — generated when an opportunity reaches `pending` and confidence in the preparatory felicity score is low (score already exists on intents via `intent/intent.verifier.ts`).
- In the accept path (`opportunity` tools → status transition), if unresolved uptake questions exist for the recipient, have the agent present them before offering the accept action. Keep it advisory — a hard `pre-uptake` lifecycle state (report's proposal) is **not** recommended; it complicates the tiered reveal cascade for marginal benefit.

## 3. QUD-typed clarification in the elaboration loop — **S**

**Theory:** Ginzburg (2012) QUD; Purver's clarification-request typology. *(Ch. 2; not in the report's top-6 but highest value-per-effort.)*

**Work items:**
- In `intent/intent.clarifier.ts` (and `intent.specificity.ts`), classify *what kind* of underspecification drove a high-entropy verdict — missing constituent (who/what), missing constraint (where/when/how much), or open alternative set — and emit the clarification question typed accordingly.
- Reuse the typology in `opportunity/question.generator.ts` so discovery-sharpening questions follow the same taxonomy.
- Eval hook: extend `eval/premise` / `eval/matching` fixtures with under-specified inputs and assert question type.

## 4. Frame-constrained HyDE generation — **M**

**Theory:** Fillmore frame semantics; report's "Frame-Constrained Generation Filter" against embedding drift. *(Ch. 4.)*

**Work items:**
- In `shared/hyde/hyde.generator.ts`, constrain Mirror/Reciprocal/Neighborhood generations to frame elements extracted from the source intent (roles, constraints, domain vocabulary) — i.e., prompt-side slot discipline instead of free hallucination.
- Add a post-generation check that rejects HyDE docs introducing entities/constraints absent from the source frame (cheap LLM check or lexical overlap heuristic).
- Measure on `eval/matching` before/after — this is the one item with an existing regression harness, so do it behind a flag and compare.

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

**Assessment:** the most speculative cluster. The protocol already has the structural pieces — network-scoped user contexts (`user_contexts` per network), the personal network boundary, and scope intersection — which deliver most of what SOCPRI's Default/Contextual profile split asks for. The genuinely new idea is **predicting the exposure set** of a premise/context before it becomes discoverable in a network and warning the user on likely context collapse.

**Work items (deferred until a design doc exists):**
- Classify contact tie strength from existing signals (contact source, interaction recency) — feeds `opportunity/opportunity.introducer.ts` routing too.
- Exposure preview at premise→network assignment time (`shared/assignment/network-assignment.policy.ts`): "assigning this premise makes it discoverable by ~N members of X."

## 8. Frame-drift monitoring — **S to start**

**Theory:** the report's own "Index Frame Drift Problem" — its most original contribution. Real even in the centralized implementation: per-network prompts, vocabularies, and embedding-model versions drift independently.

**Work items:**
- Start with measurement, not mechanism: a maintenance-graph metric tracking per-network embedding centroid drift over time and cross-network match-rate decay (`maintenance/maintenance.graph.ts`, alongside feed health).
- Only if drift is observed: consider periodic vocabulary/prompt re-alignment. Evolutionary-game machinery is premature.

---

## Explicitly rejected from the report

| Proposal | Why rejected |
|---|---|
| Cryptographic felicity verification, dual-signature consent handshakes, "Goffman Faceted Database" isolation (v1 remnants) | No cryptographic layer exists or is warranted; the theories ground the *semantics*, not a key ceremony. |
| Full AGM belief-revision engine | Flagged by the report itself in v2; superseded by item 1. |
| LANE (Levin Alternation Normalization Engine) | Solves a syntactic problem the LLM-judgment pipeline doesn't have; see item 5. |
| Hard `pre-uptake` lifecycle state | Complicates the role/tier reveal cascade; advisory uptake questions (item 2) capture the value. |
