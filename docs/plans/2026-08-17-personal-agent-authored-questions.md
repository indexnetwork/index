# Personal-agent-authored questions

**Status:** done — PR 1 (issues 1–5) shipped as
[#1428](https://github.com/indexnetwork/index/pull/1428), squash-merged
2026-08-18. Delivery (PRs 2–5) superseded by
[2026-08-18-conversational-questions](2026-08-18-conversational-questions.md):
questions are delivered as messages in the signal's A2H DM, not persisted as
question rows. PR 1's authoring path is the foundation of that plan and
survives unchanged.
**Date:** 2026-08-17
**Branch:** `feat/personal-agent-authored-questions`

## Goal

The user's own personal agent is the only thing that generates questions. It asks
its client, from the negotiation conversation it is actually having, what it needs
to conclude an open opportunity on one of their signals.

Three properties, all of which must hold for every question:

1. **One author** — the user's personal agent, and nothing else.
2. **One purpose** — an opportunity has not concluded and the client holds what
   the negotiation needs to conclude it. Answering drives it to a conclusion.
3. **One scope** — the owner's signal. A question hangs off the negotiation, which
   hangs off `recipientIntentId`.

## Grounding

The agent authors from what it already knows about this client **on this signal**.
Two sources, both intent-scoped:

1. **The negotiation transcript** — what was actually said, and where it stuck.
   Bound to the opportunity, which is bound to `recipientIntentId`.
2. **The A2H conversation for that signal** — the negotiator DM, keyed in
   `chat_session_scopes` as `('negotiator-intent', intentId)` with a unique index
   on `(userId, scopeType, scopeId)`. Exactly one DM per signal, enforced at the
   database.

This is the point of one author: the agent that negotiates is the agent that talks
to the client about this signal, so a question can be conditioned on what the
client already said. Today a question can ask something settled in the DM last
week, because the blind generator sees neither source.

### Not `negotiator_memories`

Memory is the wrong grounding source here and must not be used for it.
`negotiator_memories` (`database.schema.ts:1155`) has no intent column — it is
keyed by `agentId`/`userId` with an optional `subjectUserId` for counterparty
dossiers, and retrieved by vector similarity. Grounding on it would cross signals
by construction and non-deterministically: a threshold the client set for one
signal would silently condition a question about another. Memory keeps its
existing job of shaping how the agent argues; it does not decide what the agent
asks.

### Reading the DM from an A2A turn

The turn payload carries `negotiatorMemory` but has no A2H reader, so this needs a
new injected seam: given `(userId, recipientIntentId)`, return a bounded recent
excerpt of that signal's negotiator DM. Same composition-root pattern as
`memoryRetrieve`, but keyed on the intent rather than the counterparty, and
resolving to empty on any failure — no DM means a transcript-only question, never
a failed one.

**Do not ship this excerpt to external agents.** `negotiatorMemory` already goes
out in the dispatch payload, but that is distilled standing rules; a raw DM
excerpt is the client's private conversation. Ground the system agent with it and
withhold it from external seats until there is a reason to do otherwise.

## Where we are

Seven generators feed one blind `QuestionerAgent`:

| Generator | Trigger | Intent binding |
| --- | --- | --- |
| `intent` | intent create/update, signal intake | `sourceId` |
| `intent` / `recovery` | discovery run finds nothing | `triggeredBy` |
| `pool_discovery` | pool mining | `triggeredBy` |
| `negotiation` / `stalled_followup` | negotiation ends unconcluded | `recipientIntentId` |
| `negotiation` / `uptake` | opportunity pending, low counterparty authority | `recipientIntentId` |
| `negotiation_inflight` | mid-turn `ask_user` | `recipientIntentId` |
| `chat` | orchestrator `ask_user_question` | message/session anchor |

The personal agent authors none of them. It is a consumer: `negotiator.prompt.ts:80`
instructs it to "explain the question's context from the record it came from —
look it up, don't guess." It researches questions it did not ask.

Three specific consequences:

**The one path that is structurally right is starved.** In the mid-negotiation
consult the negotiation genuinely stops (`task.state = 'input_required'`), the
client is asked, the answer returns privately as `privateConsultation`, and the
negotiation resumes and concludes. That loop is complete. But the agent only
picks one of four enum values (`AskUserPayloadSchema`, `negotiation-state.schema.ts:48`);
`consultationPromptFor()` maps it to fixed copy; and `isValidQuestionerInputContract`
(`question.input.ts:246`) *hard-rejects* the payload unless the counterparty and
network are the generic placeholder constants. The component holding the transcript
is forbidden from saying what it needs.

**The post-stall path asks but concludes nothing.** The answer is appended to
`opportunity.metadata.userAnswers` and, per `question.answer.negotiation.ts:5`, is
only consumed "the next time `respond_to_negotiation` is called" — by hand. Nothing
resumes. It raises a question in order to conclude an opportunity and then leaves
it exactly as unconcluded.

**Intent scoping is expressed five ways.** `questioner.adapter.ts:1435` is a
40-line SQL disjunction with one branch per generator, plus a separate
message-anchor proof for chat rows.

## Target

The personal agent authors every question, in both its faces:

- **A2A** — taking negotiation turns for the user (external registered agent, or
  the system negotiator as fallback).
- **Chat** — the negotiator persona, built per session from the user's
  `type='personal'` agent row.

Three moments, one mechanism (park → ask → answer → resume → conclude):

- Mid-negotiation, when it cannot proceed without its client.
- After a negotiation failed to conclude, so the opportunity can be retried.
- In the DM, working through the client's open opportunities on a pinned signal.

### Survives

> **Revised by the conversational-questions plan.** The first two bullets no
> longer hold as written: the `Question` shape, persistence, answer/dismiss
> tools, and Questions page are retired — questions become message content in
> the signal's DM, and the parked negotiation is the only durable record.
> Of the settlement machinery, exact task re-resolution, the `input_required`
> admission gate, and expiry timers survive (they are negotiation-level);
> idempotent settlement records and sibling dismissal are re-provided
> structurally by message regeneration from the parked set. See the
> [revisions table](2026-08-18-conversational-questions.md#revisions-to-the-2026-08-17-plan).

- ~~The structured `Question` shape the UI renders; persistence; answer/dismiss
  tools; the Questions page.~~
- The negotiation-level machinery — exact task re-resolution, the
  `input_required` admission gate, expiry timers. This is what makes an answer
  actually conclude something, and it is the good part of the current system.
- `assessConsultationEligibility` as an *admission* policy — it decides when a
  pause is allowed. It stops deciding what is asked.
- `isSafeNegotiationQuestionText` as the guard on agent-authored text.

### Goes

- `QuestionerAgent`, `question.presets`, the mode/purpose/context union in
  `question.input`, and the queue's mode dispatch.
- The four non-negotiation generators: intent refinement, post-discovery recovery,
  pool-discriminator mining and its answer-reaction chaining, and the
  orchestrator's `ask_user_question`.
- The pre-accept uptake check.
- `NEGOTIATION_QUESTION_GENERIC_*` and the placeholder clauses of
  `isValidQuestionerInputContract`. They exist only because a blind generator was
  in the loop; the agent that read the transcript does not need to be lied to
  about it.
- `consultationPromptFor()`.

### New

- `AskUserPayloadSchema` carries the question the agent wrote, not an enum.
- An injected A2H reader keyed `(userId, intentId)` for DM grounding.
- An ask-my-client capability in `NEGOTIATOR_TOOL_NAMES` for the DM face.
- Post-stall questions route into the same park/resume loop as the pause path.

## Sequencing

Each issue lands independently and leaves the system working. Issues 1-5 are
deliberately inert: they build the authoring path without connecting it, so
nothing a user sees changes until delivery — which now belongs to the
conversational-questions plan. That is the PR boundary.

### PR 1 — authoring (inert) ✅ complete

All five shipped in [#1428](https://github.com/indexnetwork/index/pull/1428).
The branch's per-issue commits are not referenced by SHA: the PR was
squash-merged, so they survive on no ref. Read them from the PR.

| # | Issue |
| --- | --- |
| 1 | Turn payload carries the authored question |
| 2 | Negotiator authors it from the transcript |
| 3 | A2H reader seam, keyed `(userId, intentId)` |
| — | Validate the three documented-but-unchecked env vars (drive-by) |
| 4 | Ground authoring in the signal's client DM |
| 5 | Guard the authored question |

At the time it merged the agent wrote a grounded, guarded question into a field
that was dropped on the floor — nothing read it. That was the point: the
authoring path landed complete and inert, and the conversational-questions
plan connected it afterwards.

### PRs 2–5 — superseded ⛔

Delivery does not persist question rows. It regenerates a question-message in
the signal's A2H DM from the set of currently-parked negotiations — see
[2026-08-18-conversational-questions](2026-08-18-conversational-questions.md)
for the model (triggers, coalescence, edit rule, serialization) and its own
sequencing. What carries over from the plan as originally cut:

- **Issue 6's intent** (deliver the authored question, stop calling
  `QuestionerAgent` from `negotiation_inflight`) — now via the regeneration
  job, not the binding/settlement machinery.
- **Issues 7–8** (post-stall onto the park/resume loop, negotiator authors at
  finalize) — unchanged in intent; the post-stall question surfaces through
  the same message.
- **Issues 9–10** (DM face: ask-my-client tool, drop "look it up, don't
  guess") — unchanged; the DM is now the *only* question surface, so this
  stops being a parallel face and becomes the center.
- **Issues 11–15** (retire uptake, pool mining, recovery, intent refinement,
  orchestrator `ask_user_question`) — unchanged; each voids its pending rows
  with `voidedReason: 'retired_mode'`.
- **Issues 16–17** grow: alongside the scope-filter collapse and
  `QuestionerAgent` deletion, the questions table, its adapter surface, the
  answer/dismiss tools, and the Questions page retire too. Last, once nothing
  reads them.

## Risks

**External agents become question authors.** A registered third-party agent can
hold the personal-agent seat, and its authored text renders as a card to the user.
`isSafeNegotiationQuestionText` becomes load-bearing in a way it currently was not —
it used to guard a `disclosureSubject` that never reached the client verbatim.
Addressed by issue 5 (`8fc57f4a35`): a payload-level, identifier-aware check runs
at the turn node, where the counterparty name and seed text are in hand, and an
unsafe question is dropped while the turn and its `reason` survive. The existing
live-path verdicts are frozen by test so a later tightening cannot silently
suppress consultations that work today.

**Cold start goes quiet.** Intent refinement and pool mining are what produce
questions for a user with no negotiations. Under "questions conclude opportunities"
an empty Questions page for a new user is correct, but it is a visible product
change. The DM face (issues 9-10) is where it gets covered — the agent asks about
signals conversationally instead of a background job minting cards.

**In-flight rows.** Retired-mode rows must stay answerable or be voided; answering
a row whose reaction handler has been deleted must not error.

**Flag state is not the in-code default.** `QUESTIONER_ENABLED`,
`NEGOTIATION_CONSULTATION_POLICY_MODE`, and the ask-user flag decide which of these
paths is actually live. Check Railway before assuming any of this runs.
