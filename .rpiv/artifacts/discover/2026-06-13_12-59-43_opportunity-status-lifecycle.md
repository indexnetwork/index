---
date: 2026-06-13T12:59:43+0300
author: Yankı Ekin Yüksel
commit: bc94ae699a
branch: dev
repository: index
topic: "Opportunity status lifecycle reference"
tags: [intent, frd, opportunity, status, lifecycle, documentation]
status: ready
last_updated: 2026-06-13T12:59:43+0300
last_updated_by: Yankı Ekin Yüksel
---

# FRD: Opportunity status lifecycle reference

## Summary
Produce an authoritative, code-traceable reference document for the *existing* opportunity status cycle in Index Network. The lifecycle (8 statuses, ~6 distinct flows) already exists in the backend and protocol code but is not documented as a single clear reference. The deliverable is one markdown doc under `docs/design/` that explains every status and flow using Mermaid state diagrams plus a transition table with `file:line` citations, aimed at developers, teammates, and AI agents who need to reason about opportunity state.

## Problem & Intent
The opportunity status cycle is spread across the backend service layer, the protocol opportunity/negotiation graphs, several BullMQ queues, and frontend/CLI read paths. The behavior is real and well-defined in code, but there is no single document a developer or AI agent can read to understand how an opportunity moves through its states and how the different flows (ambient discovery, chat, orchestrator, introducer approval, expiry, premise cascade) differ. The intent is **documentation of the existing lifecycle**, not a redesign — make the implicit state machine explicit and visual so it stops being tribal/implementation knowledge.

## Goals
- Document all 8 canonical opportunity statuses and what each means.
- Visually explain each distinct flow as its own diagram, plus a master overview diagram of the whole state machine.
- Capture the non-obvious subtlety that negotiation "accept" → `pending` (agents agree to surface) is **not** human "accept" → `accepted` (a person opens a DM).
- Document per-opportunity status vs per-participant actor state (`actors` JSONB: `actedAt`, `approved`).
- Provide a written transition reference table with triggers and source `file:line` so the doc is verifiable against code.
- Be useful as a primary reference for both human developers and AI coding agents.

## Non-Goals
- No change to the status enum, transitions, or any source code — this is documentation only.
- No redesign or "should-be" lifecycle proposals; document the lifecycle as it exists at commit `bc94ae699a`.
- No frontend/CLI UI work shipping status visuals to end users (the visuals live in the doc, not the product).
- No new database migrations, services, or graphs.

## Functional Requirements
1. The document SHALL enumerate all 8 statuses (`latent`, `draft`, `negotiating`, `pending`, `stalled`, `accepted`, `rejected`, `expired`) with a definition and the lifecycle role of each, citing `backend/src/schemas/database.schema.ts:11`.
2. The document SHALL include one master Mermaid `stateDiagram-v2` showing all 8 statuses and every transition between them.
3. The document SHALL include a focused Mermaid diagram for each of the 6 distinct flows: (a) ambient/background discovery, (b) chat draft/direct-send, (c) orchestrator inline negotiation, (d) introducer approval, (e) expiry/archive, (f) premise cascade.
4. The document SHALL include a transition reference table; each row lists from-status → to-status, the trigger class (user action / agent decision / queue job / cron / timeout), and the source `file:line` where the status is written.
5. The document SHALL explain the negotiation-accept (`→ pending`) vs human-accept (`→ accepted`) distinction explicitly, citing `packages/protocol/src/negotiation/negotiation.graph.ts:364-369` and `backend/src/services/opportunity.service.ts:501-508`.
6. The document SHALL distinguish per-opportunity status (`opportunities.status`) from per-participant state stored in `opportunities.actors` JSONB (`approved`, `actedAt`), citing the relevant adapter writes.
7. The document SHALL note terminal vs reactivatable states (e.g., `stalled`/`expired` can be reactivated by discovery dedup; `rejected` is blocked by the MCP tool).
8. The document SHALL be placed under `docs/design/` following the repository's documentation conventions.

## Non-Functional Requirements
- **Performance**: N/A — static documentation artifact.
- **Security**: No security surface. Do not include secrets, tokens, or private data in examples.
- **UX / Accessibility**: Mermaid diagrams must render in GitHub and common markdown viewers; prose must stand alone if a viewer cannot render Mermaid (each diagram is accompanied by narrative + table so meaning is not lost).
- **Reliability**: Citations must be accurate at the documented commit (`bc94ae699a`); the doc should state the commit it was traced against so future drift is detectable.

## Constraints & Assumptions
- Target home is `docs/design/` (architecture & data-flow docs), consistent with `CLAUDE.md` Documentation Directories and sibling docs like `protocol-deep-dive.md`.
- Mermaid `stateDiagram-v2` is the chosen diagram syntax (renders natively on GitHub).
- Assumption: the 8-status enum and the 6 flows surfaced by the probe are complete and current as of commit `bc94ae699a`; the writing pass should re-verify each cited `file:line` before finalizing.
- Assumption: frontend's narrower status union (`frontend/src/services/opportunities.ts` omits `stalled`/`negotiating`) is an intentional read-side projection, not a separate lifecycle — note it but do not treat it as canonical.

## Acceptance Criteria
- [ ] A new file exists at `docs/design/<opportunity-status-lifecycle>.md` (exact slug TBD during writing).
- [ ] The doc contains exactly one master Mermaid `stateDiagram-v2` plus 6 per-flow Mermaid diagrams (7 diagrams total), and all render without syntax error when previewed on GitHub.
- [ ] All 8 statuses from `database.schema.ts:11` appear in the master diagram and are each defined in prose.
- [ ] The transition table has a row for every edge in the master diagram, each with a trigger class and a `file:line` citation.
- [ ] The negotiation-accept vs human-accept distinction is called out in its own subsection.
- [ ] Spot-checking 5 random `file:line` citations against the code at commit `bc94ae699a` confirms each points at the described status write.

## Recommended Approach
Add a single markdown reference doc under `docs/design/` (e.g. `opportunity-status-lifecycle.md`) containing: an intro + status glossary, one master Mermaid `stateDiagram-v2`, six per-flow Mermaid diagrams, a from→to transition table with trigger + `file:line`, and short subsections for the negotiation-vs-human accept distinction and per-participant actor state. No source code changes. Re-verify every citation against the working tree during the writing pass.

## Decisions

### Content completeness — full reference
**Question**: How complete should the documented reference be (all 8 statuses + all 6 flows, core only, or user-facing only)?
**Recommended**: Full reference — all 8 statuses + all flows.
**Chosen**: Full reference — document every status (including internal `latent`/`draft`/`negotiating`/`stalled`) and all 6 flows including machine-driven cron expiry and premise cascade.
**Rationale**: Maximizes value as the authoritative reference for devs and AI agents. evidence: `backend/src/schemas/database.schema.ts:11` + 6 flows traced across `opportunity.graph.ts` / `negotiation.graph.ts` / `premise.queue.ts` + confirmed.

### Document location — docs/design/
**Question**: Where should the reference live — `docs/design/`, `docs/domain/`, or both?
**Recommended**: `docs/design/`.
**Chosen**: `docs/design/`.
**Rationale**: A state machine with `file:line` citations is a data-flow/architecture artifact; fits alongside `protocol-deep-dive.md`. evidence: `CLAUDE.md` Documentation Directories + confirmed.

### Visual format — Mermaid state diagrams
**Question**: What rendering approach should the diagrams use — Mermaid, ASCII, or both?
**Recommended**: Mermaid `stateDiagram-v2`.
**Chosen**: Mermaid state diagrams.
**Rationale**: GitHub/most viewers render Mermaid natively, transitions can be labeled with triggers, and it diffs cleanly as text — best fit for an 8-state machine.

### Diagram layout — master + per-flow
**Question**: How should the diagrams be structured?
**Recommended**: One master overview diagram plus one focused diagram per flow.
**Chosen**: Master diagram + per-flow diagrams.
**Rationale**: Directly serves the stated "different flows" emphasis while preserving a single big-picture view.

### Transition table — with triggers + file:line
**Question**: Should the doc include a written transition reference table, and should it carry code citations?
**Recommended**: Yes — from→to table with trigger class and `file:line`.
**Chosen**: Yes — table with triggers + `file:line`.
**Rationale**: Makes the doc authoritative and code-traceable for AI agents and devs; accepted the line-drift maintenance cost in exchange for verifiability.

### Primary intent — document existing lifecycle
**Question**: What problem are you solving and who hits it?
**Recommended**: n/a — `intent` question.
**Chosen**: Document the existing lifecycle — the status cycle/flows already exist in code but lack a clear visual + written reference for teammates/AI agents.
**Rationale**: Sets the whole deliverable as documentation, not redesign or product UI.

## Open Questions
- None deferred. Exact filename slug under `docs/design/` to be settled during the writing pass (recommended: `opportunity-status-lifecycle.md`).

## Suggested Follow-ups
- Frontend status union appears narrower than the backend enum (missing `stalled`/`negotiating`) — `frontend/src/services/opportunities.ts:24,87`. Worth a separate check on whether the read-side projection is intentional or a gap.
- Premise cascade can move `accepted → stalled` — `backend/src/queues/premise.queue.ts:45-49,354-360`. Documenting it may surface whether demoting an already-accepted opportunity is desired behavior.

## References
- Free-text input: "status cycle of opportunities. different flows etc. Use visual elements to explain."
- `backend/src/schemas/database.schema.ts:11` — `opportunity_status` enum (8 values)
- `backend/src/services/opportunity.service.ts:459-508` — primary status transition service
- `packages/protocol/src/opportunity/opportunity.graph.ts` — persist/send/update/reactivation nodes
- `packages/protocol/src/negotiation/negotiation.graph.ts:101-104,364-369` — negotiation entry + finalize
- `backend/src/queues/opportunity/expiration.queue.ts`, `backend/src/queues/premise.queue.ts:45-49,354-360` — machine-driven transitions
- `packages/protocol/src/opportunity/opportunity.utils.ts:123-202` — visibility/actionability rules
