---
title: "Agent-to-Agent Negotiation Boundaries"
type: design
tags: [agent, negotiation, premise, intent, delegation, scope, human-in-the-loop, opportunity, security]
created: 2026-07-10
updated: 2026-07-10
---

# Agent-to-Agent Negotiation Boundaries

This doc maps a design thesis about personal negotiation agents onto Index Network as it actually exists in code. The thesis (external, paraphrased):

> When everyone has a personal LLM agent discovering and negotiating with everyone else's, faithfulness comes from *architecture*, not model capability. Build four boundaries: (1) ground the agent in **explicit premises**, not inference; (2) let opportunities arise only from **explicit intents**; (3) make exchange **structured** — verifiable identity, signed delegation, machine-readable scope enforced at the system level; (4) make **human approval the terminal gate** before any commitment.

The finding: **Index already implements three of these four boundaries, and deliberately diverges on the fourth.** Two of the thesis's stated risks don't apply to Index because the negotiation game here isn't priced bargaining. This document records where code matches the thesis, where it's lossy, and where it diverges — with `file:line` citations so the claims stay checkable.

> Citations resolve at commit `3140fae` (`dev`). The negotiation/agent surface is split across the protocol negotiation graph, the backend dispatcher + polling service, the agent-scope guard, the opportunity graph/status machine, and the premise/context/intent pipeline. That split is the dominant drift risk and the reason this map is worth maintaining.

## Scorecard

| Boundary | Index today | Verdict |
|---|---|---|
| **B1** Ground in premises, not inference | Premise graph exists and is provenance-tagged; but negotiation reads *synthesized* context, not premises | ⚠️ Partial — right spine, lossy at the negotiation seam |
| **B2** Opportunities only from explicit intents | Discovery/negotiation gated on intent×intent/context overlap, with `seedAssessment` provenance | ✅ Strong — with an asterisk on "explicit" |
| **B3** Structured exchange + verifiable identity + signed delegation | Structured scope enforced server-side; **no** cryptographic delegation | ⚠️ Half — scope yes, signatures no |
| **B4** Human approval is the terminal gate | Negotiation "accept" → `pending`; only a human "Start Chat" → `accepted` | ✅ Textbook — the strongest match |

Two thesis risks that **don't map** to Index (see §6): reservation-value leakage and the capability-gap payoff asymmetry — both assume priced bargaining, which Index doesn't do. One live risk the thesis **doesn't name** but Index carries: prompt injection through profile/intent text (see §7).

---

## B1 — Grounding: premises exist, but negotiation argues from a synthesis

**What the thesis wants:** the agent's model of you is built from premises you explicitly contributed, so it can "only say what you actually gave it," and its representation is auditable.

**What exists:** Index has the premise substrate the thesis idealizes.

- `premises` table (`services/api/src/schemas/database.schema.ts:317-334`) stores an `assertion`, `provenance`, `analysis`, `validity`, an `embedding vector(2000)`, and a `status` (`ACTIVE|RETRACTED|EXPIRED`, `:18`).
- Provenance is source-tagged: `PremiseProvenance.source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'` with a `confidence` number (`:296-301`). Explicit user assertions default to `'explicit'` (`packages/protocol/src/premises/premise.graph.ts:199`); scraped social content is stamped `'integration'`/`'enrichment'` (`packages/protocol/src/enrichment/enrichment.graph.ts:690-700`).
- Confidence is derived, not blanket-1.0: `deriveProvenanceConfidence()` averages the analyzer's felicity scores (authority/sincerity/clarity) (`premise.graph.ts:42-48`).
- Premises **expire** (contextual/volatile premises carry an LLM-inferred `validUntil`; a cron transitions them to `EXPIRED` and cascades to the opportunities they motivated — `services/api/src/queues/premise.queue.ts:248-266`) and can be **retracted** (`packages/protocol/src/premises/premise.decomposer.ts:61-80`, with a hallucination guard that only honors ids it actually offered, `:208-214`).

**The seam.** The negotiation agent never sees premises. It's handed a flattened, LLM-*synthesized* view:

- `UserNegotiationContext` (`packages/protocol/src/negotiations/domain/negotiation.state.ts:60-65`) is `{ id, intents:[{id,title,description,confidence}], profile:{name,bio,location,interests,skills} }`.
- Discovery matches on `user_contexts` embeddings — LLM-written identity paragraphs synthesized *from* premises by `UserContextGenerator` ("Synthesizes context paragraphs from user premises… Uses LLM synthesis", `packages/protocol/src/contexts/context.generator.ts:1-12`), not on the premises themselves.

So the grounding is real at the **seed** (explicit text → provenance-tagged premises) but **lossy at the point of use**: at negotiation time the agent argues from an LLM projection of you, with the provenance/confidence/expiry metadata stripped off. The thesis's "can only say what you actually gave it, and it's auditable" holds for the premise store and weakens precisely at the negotiation boundary.

**Consequence / candidate work:** thread premise provenance (at minimum a confidence floor and the `explicit` vs `inferred` distinction) into `UserNegotiationContext`, so a negotiation turn can weight or refuse to concede on low-felicity, inferred material.

## B2 — Provenance: negotiations only fire on intent/context overlap

**What the thesis wants:** the agent doesn't free-range; it acts when a declared intent intersects another party's intent or premises, giving every negotiation a traceable "why."

**What exists:** negotiation is never spontaneous — it's triggered from the opportunity graph when discovery finds overlap.

- The opportunity graph prep node turns the user's active intents into `indexedIntents` and matches on those plus per-network `user_contexts` embeddings (`packages/protocol/src/opportunities/application/opportunity.graph.ts:290-334`); negotiation is invoked from `negotiateNode` (`:2133`) and the discovery path (`:3513`).
- Every candidate negotiation carries a `seedAssessment.reasoning` — "Why this match was suggested" — surfaced into the negotiator's prompt (`packages/protocol/src/negotiations/application/negotiation.agent.ts:152-160`). That is the thesis's provenance: both sides can trace why their agents are talking.

**The asterisk on "explicit."** Intents are LLM-*inferred* from content and then labeled explicit:

- `ExplicitIntentInferrer` ("infer the user's current intentions based on their profile and new content", `packages/protocol/src/intents/inference/intent.inferrer.ts:46-47`); the graph hardcodes `inferenceType: 'explicit'` and derives `confidence` from a score (`packages/protocol/src/intents/graph/intent.graph.execute.ts`).
- Those two fields are **not even persisted** — the adapter's `createIntent` drops `confidence` and `inferenceType` (`services/api/src/adapters/intent.database.adapter.ts:31-58`), though the MCP surface still advertises them.
- A profile-fallback mode infers intents from the profile alone when no content is supplied (`intent.inferrer.ts:104-108`).
- Ambient/autonomous discovery creates `latent` opportunities with no live user query (`services/api/src/services/opportunity.service.ts:791,799`).

So the boundary is genuinely **intent-gated**, but "explicit" is aspirational — much of the intent layer is inference stamped as fact. This is acceptable *because* of B4 (nothing an inferred intent triggers can bind the user), but it means the thesis's clean "the agent doesn't free-range" is softer here than the word "explicit" implies.

## B3 — Structured exchange: scope yes, signatures no

The thesis bundles three things under one boundary: **structured machine-readable scope**, **verifiable identity**, and **cryptographically signed delegation**. Index scores oppositely on the first versus the last two.

### B3a — Structured scope: enforced server-side (match)

- Agent authority is DB rows, not prompt text: `agent_permissions` (`services/api/src/schemas/database.schema.ts:712-727`) carries `actions text[]` × `scope` (`global|node|network`) + nullable `scopeId`.
- `resolveAgentNetworkScopeById()` **fails closed** for mixed-permission agents — "a key that was ever bound to a network must not silently become global because an unrelated global row exists" — and throws on conflicting scopes (`services/api/src/guards/agent-scope.guard.ts:30-58`).
- `assertAgentNetworkScope()` throws `ScopeViolationError` → HTTP 403 on any target-network mismatch (`agent-scope.guard.ts:15-20,96-104`); wired into network/intent/opportunity controllers. Discovery and ambient matching thread the bound network through so a scoped agent can't reach outside it.

This is exactly the thesis's "structured scoping reduces reliance on model alignment alone" — the scope is enforced at the system level, below the model.

### B3b — Verifiable identity + signed delegation: absent (divergence)

- Authentication is **API-key + DB-row trust**. A raw key is SHA-256 hashed and looked up (`services/api/src/guards/auth.guard.ts:23-27`); the agent binding lives in `apikeys.metadata.agentId` (`:101-126`). The agent acts fully **as its owning user** — there is no separate agent principal at the auth layer.
- Principal resolution fails closed on ambiguity: `resolveApiKeyUserId()` rejects a key whose two principal columns disagree (`services/api/src/lib/apikey/principal.ts:41-49`).
- `SessionOnlyGuard` keeps a leaked key's blast radius at "act as the user in the product": API keys are rejected (403) on account deletion and all agent-management writes — create/update/delete agents, tokens, permissions, transports (`auth.guard.ts:76-93`; endpoints at `services/api/src/controllers/agent.controller.ts:177,225,246,262,289,306,333,366,387`). A leaked agent key cannot mint successor credentials.
- **But there is no cryptographic delegation.** No signed mandate, verifiable credential, JWS, DID, or attestation exists in the agent/auth path. Delegation = a `grantPermission()` insert creating an `agent_permissions` row. Authority is proven by *possession* of an unexpired, enabled key — not by a signature the principal produced.

**Auditability** exists but is DB/log-based (permission `createdAt`, hash-prefixed auth-failure logs, typed scope-violation logs), **not** cryptographic. Nothing lets a third party *verify* the principal granted the authority; the trust root is server-side key possession. Against the thesis's AP2-style "non-repudiable mandate chain," Index has a repudiable one. This is a deliberate divergence, not an oversight — but it's the one boundary where Index is materially weaker than the thesis, and the place to look first if agent-to-agent trust ever needs to extend across trust domains.

## B4 — Human approval is the terminal gate (textbook match)

This is Index's strongest alignment, and it's the boundary that makes the B1/B2/B3b weaknesses tolerable: an out-classed or manipulated agent **cannot bind you**.

- The word "accepted" has three meanings; only one is a commitment (`docs/design/opportunity-status-lifecycle.md` §3.C). An agent negotiation "accept" writes opportunity status **`pending`, not `accepted`** — "agents agree this is worth surfacing; a human still has to accept it" (`packages/protocol/src/negotiations/application/negotiation.graph.ts:364-369`; the poller path mirrors the mapping, `services/api/src/services/negotiation-polling.service.ts:399-410`).
- Status `accepted` — which resolves/creates the DM and sets `acceptedBy` — is written **only** on a human accept / "Start Chat", across three guarded paths (`opportunity.service.ts:501-504`, `:728-732`, `opportunity.graph.ts:3287-3293`); `acceptedBy` is set only there (`services/api/src/adapters/database.adapter.ts:5181-5182`).
- A **self-accept guard** blocks the actor who already `actedAt` from being the accepter (`opportunity.graph.ts:3269-3277`, service `:477-480,691-693`) — forcing the *counterparty* to be the one who commits. No single side's agent can unilaterally bind the other user.

The audit chain the thesis asks for (premises → intent → negotiation → approval) exists as real persisted state.

**Known crack:** the REST `PATCH /opportunities/:id/status` endpoint applies no source-status guard (only the self-accept check), so `rejected`/`expired` aren't truly terminal at that layer (`opportunity.controller.ts:222-231`, `opportunity.service.ts:459-508`). Documented in the lifecycle doc §7 item 7.

---

## 5. The dispatch model (context for B4's safety margin)

The negotiation *engine* shapes how much capability-gap exposure exists before the human gate. Summary (full map in `docs/design/protocol-deep-dive.md` and the negotiation source):

- The dispatcher checks a 90s heartbeat (`FRESHNESS_THRESHOLD_MS`, `services/api/src/services/agent-dispatcher.service.ts:11`). If no personal agent is fresh, the **system negotiator (`IndexNegotiator`) runs inline** (`agent-dispatcher.service.ts:69-76`) — so the baseline counterpart is a uniform system agent, not an arbitrary weak personal one. If a fresh personal agent exists, the turn is **parked** (`waiting_for_agent`) within a bounded park window (`AMBIENT_PARK_WINDOW_MS = 5 min`, `packages/protocol/src/negotiations/application/negotiation.tools.ts:22`) and picked up via `POST /agents/:id/negotiations/pickup` + `/respond`.
- Turn counts are capped: `NEGOTIATION_MAX_TURNS_CHAT` (4) and `NEGOTIATION_MAX_TURNS_AMBIENT` (6) (`opportunity.graph.ts:1986-1988`). **Exception:** when *both* sides have personal agents, `maxTurns = 0` = unlimited (`negotiation.graph.ts:88-98`). That's the highest capability-gap exposure surface — but B4 still caps the blast radius at "surfaced, not bound."

## 6. Two thesis risks that don't map to Index

The thesis's §1 threat model is drawn from priced consumer-market bargaining (weak agents earning 6.9–14% less, leaking reservation price, anchoring on opening offers, feigning desperation for ~20% more payoff). Two of those don't apply here:

1. **No reservation-value leakage — because there are no reservation values.** Index negotiations exchange **symmetric public context** (both agents receive both users' profiles + intents + seed reasoning; `negotiation.agent.ts:168-182`) and produce a boolean `hasOpportunity` + role assignment (`agent`/`patient`/`peer`), not a price (`negotiation.state.ts:47-58`). There is no private reservation-price channel to leak. Private data enters only via questioner `userAnswers` scoped to that user's own prompt, and a speaker-scoped `discoveryQuery` (`negotiation.graph.ts:206-209`). The thesis's "keep private context out of the conversation" is satisfied by construction, not by discipline.
2. **The capability-gap payoff asymmetry is muted.** There's no payoff to skew — the outcome is fit/no-fit, and the human decides commitment regardless. A stronger counterpart agent can at most get a marginal opportunity *surfaced*; it cannot extract value or bind the user.

## 7. The live risk the thesis doesn't name: prompt injection via profile/intent text

The negotiation agent ingests both users' bios and intent descriptions as free text into its prompt (`negotiation.agent.ts:168-182`). The negotiator's behavioral rules — role framing, the "discovery query is the PRIMARY gate" instruction (`negotiation.agent.ts:116-121`) — live **only in the prompt**. The thesis's own §4 warns "rules that live only in the prompt are the rules that get broken." So while structured *scope* is enforced server-side and safe (B3a), negotiation *behavior* is a prompt-injection surface: a crafted intent or bio is untrusted input reaching the model with authority-shaped instructions nearby. This is the highest-leverage hardening target the thesis doesn't call out.

---

## Walk-away

Index's trust model matches the thesis where it matters most — **human approval is a real, code-enforced terminal gate**, and **structured scope is enforced below the model**. It's lossy at grounding (negotiation argues from a synthesis, not from provenance-tagged premises), aspirational on "explicit" intents (much is inference stamped as fact), and deliberately without cryptographic delegation (API-key + DB-row trust, repudiable). The thesis's bargaining-centric risks largely don't apply; the risk it omits — prompt injection through user-authored text into the negotiator's prompt — does.

### Candidate follow-ups (not scoped here)

1. **B1:** thread premise provenance/confidence into `UserNegotiationContext` so negotiation can down-weight inferred/low-felicity material.
2. **B3b:** if agent-to-agent trust ever crosses trust domains, evaluate signed delegation (AP2-style mandate or authenticated-delegation JWS) over the current API-key model.
3. **B4:** close the REST `PATCH .../status` source-guard gap so terminal statuses are terminal at every layer.
4. **§7:** treat profile/intent text as untrusted input in the negotiator prompt (delimiting, instruction/data separation, or a pre-negotiation sanitization pass).
