# Personal agent communication implementation specification

Status: revised on 14 September 2026 after comparing Seref’s example. This file
specifies proposed implementation work; this revision changes planning documents
only. Read [the design](agent-communication.design.md) for behavioral decisions
and rationale.

## 1. Scope and current implementation

Implement the library behavior in `packages/agent` using the existing
`NegotiationAgent`, `PrincipalInbox`, model loop, and `PrincipalStore`.

| Existing file | Responsibility in this change |
|---|---|
| `src/prompts/agent.prompt.ts` | Shared identity and authority instructions; A2A completion instructions; H2A batch and waiting instructions; richer review input. |
| `src/negotiation/principal.inbox.ts` | Authored question batches, complete answer submission, direct messages, whole-intent review, opportunity reconsideration, deferred review, and outcome selection. |
| `src/negotiation/negotiation.agent.ts` | Opportunity-targeted reevaluation, agreement observations, public methods, context invalidation, internal obstacle tool, and wake-up events. |
| `src/negotiation/principal.state.ts` | Persist batches, pending principal-input review, per-opportunity review notes, waiting, activity timestamps, and local obstacles through the existing store. |
| `src/index.ts` | Explicit exports for changed public types. |
| `README.md` and existing examples | Describe the final API and distinguish generic `Agent` behavior from negotiation behavior. |

The current package displays one question, accepts one question-ID/text pair,
and clears every waiting request when that answer is saved. Its `wait` action
can dismiss outcomes. Background reviews omit negotiation snapshots, and direct
messages are rejected while a question is displayed. These behaviors are
replaced in place, without compatibility methods or parallel implementations.

The generic core `ask_user` capability is not used by `NegotiationAgent` and is
not converted to batch input as part of this work. Avoid changes to the model
provider, protocol, transport, infrastructure, and application layouts.

### Agreement and consent semantics

The current `remember()` adds every settled record with `outcome === 'agreed'`
to `acceptedCommitments`. Rename that context field and its backing collection
to `agreements` throughout the package, prompt builders, read tool, and examples.
Continue retaining every observed agreement and invalidating affected stale
decisions when a new agreement appears. Do not discard records whose authority
has not been established or retain a second compatibility field.

The model must distinguish:

1. Negotiated terms: what the source record establishes, including unresolved
   terms and protocol agreements.
2. Principal authorization: the actual principal statements or applicable
   standing instructions covering an action, opportunity, terms, and conditions.
3. Execution: what a confirmed tool result or host observation proves happened.

A preference is not authorization for a specific offer. A protocol agreement
does not itself establish principal consent. Before offering or accepting terms
that would commit the principal under the host’s protocol, the agent needs
applicable authority. Existing standing authorization may be sufficient; do not
add a blanket post-acceptance human-confirmation stage.

An agreement supported by applicable authority can be treated as an authorized
commitment to its agreed terms, but still does not prove that subsequent work
or an introduction occurred. Preserve historical agreements and already-executed
actions when later preferences change. If an observed agreement lacks authority
in the supplied evidence, expose that gap for reassessment rather than inferring
consent or deleting the record.

No new consent ledger, inferred-fact store, or protocol state machine is required.
Interpret source records and principal messages together, preserving their IDs
and conditions. Record only actions supported by this package’s actual tools.

## 2. Public principal input contract

Add and export:

```ts
interface PrincipalAnswer {
  questionId: string;
  text: string;
}
```

Replace the negotiation agent’s singular contract:

```ts
get pending(): readonly PrincipalQuestion[];
answer(answers: readonly PrincipalAnswer[]): Promise<readonly PrincipalMessage[] | null>;
message(text: string): Promise<PrincipalMessage | null>;
```

- `pending` is an empty array when there is no displayed batch.
- `answer` returns all persisted answer entries together. Invalid or stale input
  returns `null` without a partial mutation. Persistence failures reject as they
  do today.
- `message` accepts nonempty direct messages while a batch is open. It retains
  its existing persisted-message-or-`null` return convention.
- `queuedQuestions` counts internal requests outside the displayed groups.
- Do not retain `answer(questionId, text)` or introduce an `answerBatch` twin.

## 3. Batch selection and display

Replace the inbox `ask` decision with one to three authored questions. This is
one path for questions derived from A2A requests and questions discovered during
whole-intent review:

```ts
{
  action: 'ask',
  questions: [
    {
      question: 'How many hours per week can you spend in total on this intent?',
      options: ['Up to 5 hours', '5–10 hours', '10–20 hours'],
      scope: 'intent',
      opportunityIds: ['match-mira', 'match-alex'],
      requestIds: ['capacity-mira', 'capacity-alex']
    },
    {
      question: 'When could you start a new collaboration?',
      options: ['This week', 'In two weeks', 'Next month'],
      scope: 'intent',
      opportunityIds: [],
      requestIds: []
    }
  ]
}
```

The first question covers existing requests; the second is a timing clarification
the personal agent identified itself. All referenced opportunities must belong
to the current principal/intent.

The model writes the final question and two to four suggested options using
existing evidence. An A2A request is data for this decision; do not require its
possibly premature wording to be shown verbatim. `requestIds` names the internal
requests actually covered by the question and may be empty for a new principal
clarification. Do not manufacture a blocked A2A request just to make it askable.

The runtime assigns a fresh question ID and constructs match references from
the selected opportunity IDs. Once displayed, the ID, wording, options, scope,
and references are fixed. IDs must not be reused for a changed question.

Validate that every referenced request exists and appears in at most one group,
and that its opportunity is included in that question’s references. Only
requests for the same intent-wide fact can share a question across matches.
Match-scoped questions concern exactly one opportunity. Intent-scoped
clarifications may have no opportunity reference when they concern the intent
generally. Semantic equivalence, faithful wording, and independence are model
judgments; the runtime validates membership and scope. Retain the existing
`intent`/`match` scope vocabulary; Seref’s `opportunity` scope has the meaning
of `match`, not a new third scope.

The review instructions require one distinct fact or decision per question,
duplicate-fact grouping, and postponement of dependent follow-ups. Offer-specific
questions must make the action and material terms clear. A single approval can
cover several terms of one coherent offer; do not split it into unrelated
permissions. One question is a complete valid batch; no minimum-fill wait is
imposed.

Persist all displayed questions and their H2A question entries together before
notifying the host. Store the array as `InboxState.questions`, replacing
`InboxState.question`. Attach each covered request to the generated question ID
using the existing `attachedTo` relationship. Questions without covered requests
need no waiting-task placeholder or second submission path.

Ordinary arrivals cannot append to, replace, or expand the references of a
displayed question. New requests remain queued.

## 4. Complete answer submission

For a submission:

1. Capture the displayed question set and validate the entire payload before
   changing state. Require exactly one nonempty string per displayed ID; reject
   missing, extra, duplicate, stale, or already-retired IDs.
2. Derive scope and match references from the stored questions. The caller
   supplies only question IDs and answer text.
3. Append a separate `kind: 'answer'` entry for each question, preserving its
   full text, question ID, scope, and references. Add the new message IDs to
   `InboxState.pendingPrincipalInputIds`. Increment principal context once and
   invalidate the old inbox review once.
4. Clear the displayed batch and remove only the requests belonging to its
   groups. Preserve unshown requests and pending outcomes.
5. Save the updated state and all new answer entries in one
   `PrincipalStore.save(state, messages)` checkpoint.
6. After that checkpoint succeeds, resolve the covered waits and schedule a
   whole-intent review even if no requests or outcomes remain. Every resumed
   negotiation reads the complete answer set before deciding. The review may
   separately select other opportunities for reconsideration.

Draft edits never enter this method. A one-question batch uses an array of
length one. An explicit unknown answer is valid text and does not grant
authority. Failed persistence permits no further negotiation action based on
the unsaved input; existing persistence-failure shutdown remains in effect.

There is no new batch identifier. Unique immutable question IDs and exact-set
validation identify the submitted batch. A rejected or uncertain submission is
reconciled against pending questions and saved H2A history before any resubmission.

### Interpreting richer answers

Preserve the original text and source IDs. The recorded question scope anchors
the answer to that question; it must not cause a separate explicit broader
instruction in the answer to be ignored. Equally, a brief “yes” must not acquire
broader authority simply because the same conversation serves several matches.

The model distinguishes answered facts, additional preferences or requirements,
conditions, uncertainty, corrections, and permissions. Preserve their strength:
“I want first author” states an authorship objective; it does not establish that
Leo agreed or that an offer was approved. “Aggregates are enough if I can name the
product” must not become an unconditional acceptance of aggregates.

Use the original entries in both H2A and A2A context. An internal note may point
to their implications but cannot replace them as evidence or establish new
authority. Do not add an extraction model or rewrite an answer into several
synthetic principal messages.

## 5. Direct messages, obsolete questions, and cancellation

Allow `message(text)` regardless of whether questions are displayed. Persist it
as `kind: 'user'`, invalidate stale decisions, and request an immediate inbox
review. Add its ID to `InboxState.pendingPrincipalInputIds` as part of the same
checkpoint. Do not translate its text into a synthetic answer to a displayed
question.

H2A instructions say: if direct messages are present, reply and end this review.
Replying clears only the handled direct-message reply queue. The pending
principal-input IDs remain until a fresh non-reply review evaluates their effect
on the whole intent, including opportunities with no question. A waiting
decision preserves that input in history and its durable deferral context.
Replies must not claim reassessment or actions that have not been performed.

The model may retire a displayed question made obsolete by explicit principal
input through the `reconsider` action below. A displayed question is retired
as a whole; unrelated displayed questions retain their IDs and wording.
Do not retire a valid question merely because its opportunity is being
reconsidered for another reason.

Reconcile the meaning of new statements with old ones. A clear correction or
revocation applies within its scope. A later broad preference does not
automatically revoke an earlier specific authorization, and an old specific
approval does not automatically exempt that opportunity from an explicit later
revocation. Clarify only when the relationship remains ambiguous and affects
the next action. Preserve the record of actions already performed.

A summary saying “pending consent” cannot override an explicit approval in
principal history. Verify whether that approval still applies to the action and
terms; its presence does not establish execution. Avoid asking the original
approval question again solely because a summary is stale.

On cancellation, remove the canceled match’s requests. If a displayed question
would need different wording or references, retire its old ID and leave any
remaining useful requests queued for reconsideration. Do not silently change
the meaning associated with an existing ID.

After retirement, a submission containing the old set fails atomically. The
caller keeps drafts for unchanged question IDs and refreshes the displayed set.
The package exposes state and validation; it does not own draft UI storage.

## 6. H2A communication actions

Keep one `review_principal_inbox` capability and one committed decision per
review. Replace the old overloaded `wait` action with explicit meanings:

| Action | Effect |
|---|---|
| `reply` | Persist a response to direct principal messages included in the review. |
| `ask` | Publish independent questions authored from requests or whole-intent review when no batch is displayed. |
| `update` | Publish a concise message about selected outcomes; retain unselected outcomes. |
| `wait_for_context` | Retain pending work and persist an agent-chosen reconsideration deadline. |
| `stay_silent` | Complete the attention decision for selected outcomes without publishing; it can also leave an existing displayed batch undisturbed. It does not delete input requests or schedule deferral. |
| `reconsider` | Select opportunities for reevaluation using principal evidence and observed context, independently of whether input requests exist; explicitly release obsolete requests or retire obsolete questions when needed. |

Use existing `opportunityIds` to identify outcomes handled by `update` or
`stay_silent`. Selecting one outcome must not discard every outcome in the
snapshot. An empty outcome selection can represent no new communication while
an existing batch remains open.

Instructions distinguish deliberate silence from deferring an undecided input
request: use `wait_for_context` when further context is needed. Unresolved
requests remain durable regardless of the selected action.

Include outcomes in review context even while a batch is displayed. The agent
can decide that an update deserves attention while leaving the questions
unchanged. Routine progress remains internal by instruction, not by hiding all
outcomes from the review.

Validate action arguments, referenced IDs, current display state, and snapshot
freshness. Do not force asking because requests exist, waiting because an active
count is nonzero, or silence because a batch has not filled.

### Reconsideration targets opportunities

Use `opportunityIds` and the existing internal `message` note as the primary
arguments to `reconsider`. Add `releaseRequestIds` and `retireQuestionIds` for
explicitly identified obsolete work; these lists may be empty. Remove the old
request-only reconsideration contract rather than retaining another action.
Allow no opportunity targets when the sole effect is retiring an obsolete
intent-wide question with no opportunity references; reject a decision with
no target or retirement at all.

Validate that selected opportunities belong to the current intent. Each released
request must belong to a selected opportunity. A displayed question must be
explicitly retired before its covered request is released through this action.
Retiring a question does not imply that all its requests were answered: detach
and keep any linked request not explicitly released. A question authored by H2A
can be retired even when it has no linked request.

Persist selected per-opportunity review notes, releases, and retirements before
notifying tasks. Reuse the existing persisted match `reviewNote` rather than
adding a separate work queue. A note identifies why the opportunity needs
reconsideration and points to the relevant principal entries or observed record;
it does not grant authority itself.

After saving, release selected waits and make eligible target tasks reconsider
against fresh records and principal context. A target without an input request
must still receive the instruction. For a passive target, preserve its review
note until a permitted next action is possible; never submit out of turn or
silently reopen settled or stopped work. Existing valid input waits remain
until answered or explicitly released. Invalidate affected in-flight decisions
when necessary, without restarting unrelated tasks.

The whole-intent agent assesses fit immediately from the supplied observations;
queuing reevaluation is not proof that a protocol decline, cancellation, or
external action has occurred. Do not discard a review note on restoration or
before it has reached an actual task review.

## 7. Waiting contract and review context

The waiting action has three required arguments:

```ts
{
  action: 'wait_for_context',
  expectedContext: 'The remaining local turns may reveal other independent questions.',
  reason: 'A short wait may avoid separate interruptions for this initial group of negotiations.',
  reconsiderAt: '2026-09-13T12:00:30.000Z'
}
```

The timestamp is illustrative. Validate a finite future deadline against the
current clock. The agent chooses it; do not add fixed waiting durations,
negotiation-count thresholds, or a signal-wide collection window.

Persist the current waiting decision as `InboxState.deferredReview`, including
`startedAt`, `expectedContext`, `reason`, and `reconsiderAt`. Keep `startedAt`
when the agent chooses to extend the same unresolved deferral. End the deferral
episode when the agent takes a non-waiting decision. Individual request ages
remain available across episodes.

Every background and direct-message review receives:

- `now`: an unambiguous current timestamp, using the same injected clock as
  deadline calculations and activity timestamps.
- Intent/session activity start time and observations changed since the prior
  review.
- The principal conversation with original wording, message IDs, question
  references, scopes, and available timestamps; incoming direct messages;
  `pendingPrincipalInputIds`; requests; outcomes; and `pendingQuestions`.
- Observed `agreements` and confirmed action results available to the package.
  Principal authorization is supported by the original conversation and standing
  instructions, not inferred from an agreement status.
- Negotiation counts derived from the supplied individual statuses.
- Individual opportunity IDs, counterpart intents, available explanations of
  fit, latest known terms and unresolved issues, source records, last-change
  times, observed blockers, and permitted actions under the current turn state.
- The current or just-expired waiting decision and total elapsed deferral time.

Supply existing source material, not a new model-generated summary store.
When a fit explanation or action result is unavailable, omit it rather than
inventing one. Conclusions about fit remain agent judgments; summaries cannot
override principal statements or confirmed records. No extra model call or
contradictable consent boolean is needed to build this context.

Use actual dates when temporal evidence supports them. Resolve historical
relative dates against their original context, not the current review date.
An entry with no timestamp must not acquire one from the session clock; leave
an unresolved date explicit and clarify only if it affects the next action.

Use factual status categories: local work ready or executing, waiting for
principal input, waiting for a counterparty, locally blocked, completed,
stopped, or not yet observed. A running task promise may be suspended on
principal input and must not be counted as independent local work. Waiting for
a counterparty conveys no claim about that agent’s execution or response time.

Add only the timestamps and local obstacle state needed to support these
observations. Preserve request creation time and outcome observation time so
their age is not reset by another review or duplicate event. Persist session
start and last meaningful match-change times. Do not persist promises or
represent a pre-restart model call as still executing.

There is no predicted ETA, relevance score, or new domain classification field.
The model reasons from the records and observed activity.

## 8. Scheduling, freshness, and restoration

Replace the fixed two-second collection delay with coalesced event-triggered
reviews. Reuse the existing timer and single in-flight review ownership.
Coalescing concurrent notifications is execution bookkeeping; any intentional
delay for context is chosen through `wait_for_context`.

Request a review on new principal input, a new request or outcome, a meaningful
negotiation observation or local activity change, cancellation, or a deferred
deadline. Duplicate unchanged observations and model token activity do not
create new context. While a review runs, coalesce notifications into a pending
review instead of starting concurrent inbox writers.

Persist `pendingPrincipalInputIds` independently of request and outcome queues.
Add every new direct-message ID or submitted answer-message ID in the same
checkpoint as that input. Their presence makes a whole-intent review necessary
even when all input requests have just been cleared. A direct-message reply
does not consume these IDs.

A fresh non-reply review handles only the principal-input IDs in its snapshot.
Remove those IDs in the checkpoint that applies its decision; later arrivals
remain pending. `wait_for_context` can acknowledge having considered the input
while retaining its original history and durable expectation for a later review.
After a restart between saving answers and reviewing them, the saved IDs still
require review. This is delivery bookkeeping, not a new interpretation pipeline.

A successful waiting decision must not cause immediate repeated reviews simply
because requests remain in the queue. Wake on new observed context or the saved
deadline. A new event does not automatically extend the deadline; any extension
is a new agent decision.

Use a review revision for stale inbox snapshots, separate from principal
`contextVersion`, which already protects A2A submissions. Do not invalidate
every negotiation turn just because an unrelated match produced an observation.
If context changes during an inbox review, discard a stale publication or
waiting decision and review the latest snapshot. Do not acknowledge arrivals
that were not included in the committed review.

Persist the waiting decision before considering it scheduled. On restart,
reload state, reconcile current match observations, and honor an unexpired
deadline if context is unchanged. Changed context or an expired deadline causes
an immediate review. Retain the expired decision in that review’s input so the
agent can assess its expectation. Stopping clears live timers while preserving
resumable state.

Restore per-opportunity review notes with the tasks. Keep a note through passive
observations and valid principal-input waits until the task can actually review
it before a permitted action. Saving a batch directly releases only its covered
requests; further task selection happens through `reconsider`, not a wake-all
or clear-all operation.

Remove request-review flags or timer paths made redundant by this event-driven
scheduling; do not retain an old polling path alongside it.

## 9. A2A obstacle reporting and completion

Add an internal `report_obstacle({ reason: string })` tool alongside
`read_negotiation`, `submit_turn`, and `request_principal_input`.

- Use it when the task cannot proceed and the obstacle is not a missing
  principal fact or authorization that the input-request capability can obtain.
- Record a model-reported obstacle separately from a protocol settlement or
  transport error. Make it available to H2A outcome review and observed task
  status through the existing state/checkpoint path.
- End the current local turn successfully without a protocol submission. The
  negotiation remains unresolved and locally blocked.
- Reconsider on a new authoritative match observation or new principal context;
  do not immediately rerun the unchanged blocked task.
- Reject obstacle reporting after a submission attempt. Retain existing handling
  for uncertain or failed writes and the prohibition on automatic replay.

Track the explicit obstacle decision in the turn state so a generic prose-only
completion cannot masquerade as a valid action. A normal A2A completion must
have submitted a turn or recorded an obstacle. Requests for principal input
retain their existing suspend-and-reconsider lifecycle.

The shared system describes truthful use of capabilities without promising that
ordinary prose reaches the user. Mode-specific instructions identify the
communication path and valid way to finish. Core generic-agent behavior does
not need a new completion abstraction.

## 10. Prompt changes

Keep the shared mission brief: act for the principal toward this intent when
facts and authority suffice; obtain input that could change the next move;
communicate worthwhile outcomes or obstacles. Use the corrected identity,
“You are {{principal_name}}’s personal agent,” and apply these rules:

- The principal’s intent establishes the goal, not unstated personal facts or
  implied authorization.
- Read the full conversation, including additional instructions in answers.
  Preserve conditions and distinguish a preference, a requirement, uncertainty,
  and authorization. Do not re-ask an already answered fact.
- Reconcile scope and meaning when new input arrives. Distinguish a correction
  or revocation from an added general preference; timestamp order alone does
  not resolve an ambiguous relationship. Preserve historical agreements and
  executed actions. Clarify only ambiguity material to the next action.
- Authorization is limited to its stated action, match, terms, and conditions.
  Reassess authority on material changes, allowing existing standing instructions
  to cover actions they explicitly authorize. A2A acceptance alone is neither
  evidence of principal consent nor proof of subsequent execution.
- Record actual dates when supported, preserving historical temporal context
  rather than resolving every relative date against today.
- Private H2A context is used to decide; counterparties receive relevant terms
  and facts rather than private conversation or deliberation.

Update A2A instructions to preserve one focused input request, exact action
authority, the one-submission limit, and the explicit obstacle completion path.
Use actual capability names rather than vague instructions to “say so” or
“re-read Index.” Read the complete principal input and any review note before
acting, including instructions that go beyond the original question. Respect
whose turn it is; a queued reconsideration does not authorize an out-of-turn
submission.

Rewrite H2A instructions around whole-intent judgment and the final action
meanings. Review relevant opportunities even without input requests; select
opportunities to reconsider; reconcile negotiated terms with principal authority
and confirmed actions. Author questions when useful, treating an A2A `ask` as
evidence to assess rather than text to forward automatically.

Include independent batch selection, complete answer submission, direct-message
priority, scoped evidence reuse, and agent-controlled waiting. “Reply and end
this review” must be explicit; the subsequent review considers the new input’s
broader effect. Waiting instructions require an expected benefit, a deadline,
and reassessment of previous expectations against new observations. Counts
inform judgment without selecting an action through code thresholds.

Tool descriptions, schemas, prompt examples, and the README must agree. Do not
leave a batch-only proposed prompt that omits waiting while presenting it as the
final combined behavior.

## 11. Acceptance criteria

| Scenario | Required result |
|---|---|
| Mira and Alex ask for the same general capacity fact. | One question can cover both requests; no duplicate capacity question is displayed. |
| An offer decision depends on an unanswered capacity question. | The dependent question is deferred; the batch contains independently answerable questions. |
| One or all fields are drafted. | No answer is saved and no waiting task is released. |
| A complete three-answer submission succeeds. | One checkpoint contains all scoped entries; only covered requests are released afterwards. |
| Any answer ID is missing, duplicated, extra, or stale. | The entire submission is rejected without changing principal context or releasing requests. |
| A new request arrives while answers are being drafted. | The displayed batch stays stable; the later request survives the submission. |
| The principal answers “I don’t know yet.” | The text is saved as uncertainty; no permission or fabricated fact is inferred. |
| A direct correction arrives while a batch is open. | It is saved as a direct message, receives a reply, and can retire only questions it makes obsolete. |
| A cancellation changes the displayed set. | Old-set submission is rejected; unrelated questions and requests remain. |
| The agent chooses to wait with queued input requests. | The decision is supported, work is retained, and a reconsideration deadline is saved. |
| Relevant context arrives before the deadline. | A review receives the new observations and previous waiting decision. |
| No further input arrives. | The saved deadline causes reconsideration without requiring another A2A event. |
| The agent chooses to wait again. | Its previous expectation and total elapsed wait remain visible; arrivals do not silently reset the clock. |
| All locally running promises are suspended on principal input. | Context identifies principal-blocked work rather than promising imminent independent results. |
| An urgent later input arrives among many passive negotiations. | The agent can choose to act; no count or batch-fill rule forces waiting. |
| The agent selects one outcome to update or dismiss. | Unselected outcomes remain pending. |
| An outcome deserves attention while a batch is open. | An update can be published without changing question IDs or drafts. |
| An old preference conflicts with a newer explicit correction. | The newer scoped instruction controls future decisions; existing agreements are retained. |
| Offer terms change after a principal approval. | The agent reassesses the actual terms against the approved action and existing authority. |
| A new instruction affects an opportunity with no input request. | The agent can select that opportunity for reconsideration and persist a source-grounded review note. |
| An answer adds an instruction and clears the last waiting request. | The whole-intent review still runs and evaluates that instruction’s effect on other opportunities. |
| A saved input has not yet received whole-intent review when the process restarts. | Its pending message ID survives; a direct-message reply alone cannot mark that review complete. |
| The personal agent discovers a necessary clarification without an A2A request. | It can display a scoped question with no linked request; the same complete answer submission handles it. |
| An opportunity is reconsidered while a valid question remains open. | The question remains unless explicitly retired; retiring it does not silently release every linked request. |
| A reconsideration target is passive, stopped, or settled. | A passive task retains its note for its next permitted review; no out-of-turn submission or silent reopening occurs. |
| An ask or reconsideration references another intent’s opportunity or an invalid request association. | Structural validation rejects the decision without changing state. |
| A task explicitly reports an obstacle without submitting. | The obstacle is persisted and available for H2A review; the task awaits a real context change. |
| A write failed or its result is uncertain. | No automatic replay or success claim is introduced by the obstacle path. |
| New context arrives during an inbox model call. | An obsolete display or waiting decision is not applied to the newer snapshot. |
| The process restarts during a pending batch or deferral. | Questions retain their IDs; queued work survives; the deadline is restored or reconsidered if expired. |
| Saving answers, a message, or a waiting decision fails. | No new action relies on unsaved input; failure is surfaced through existing persistence handling. |

Behavior involving equivalence, relevance, urgency, authority, or uncertainty
requires model-behavior evaluation; structural checks alone do not establish it.
Deadlines guarantee review delivery, not an eventual human interruption if the
agent repeatedly chooses to defer.

### Seref’s Maya scenario

Use the supplied scenario as a concrete semantic acceptance case, retaining its
clock of Sunday, 13 September 2026. The intent is `intent-maya-paper`: “find
co-authors for a workshop paper on how agents reach agreement, six weeks, in
person if same city.”

The principal conversation is ordered as follows. Row numbers are fixture
references introduced here; the original example supplies no message IDs or
per-entry timestamps.

| Order | Entry and scope | Original text |
|---|---|---|
| 1 | User | Is anyone actually writing with me, or is this all advisory? |
| 2 | Agent message | Leo is the live co-author thread. Priya is a recommended intro pending your consent. |
| 3 | Question, Priya only | Approve an intro with Priya next Tuesday in Berlin? |
| 4 | Answer, Priya only | Yes, Tuesday in Berlin is fine. |
| 5 | User | don't spend my week on advisory-only people. |
| 6 | Question, intent scope, prompted by Leo | For this intent, are redacted aggregates enough if you can name the product? |
| 7 | Answer, intent scope | Aggregates are enough if I can name the product. I want first author. |

Opportunity observations:

| Opportunity | Supplied context |
|---|---|
| `opp-leo` | Negotiating, awaiting them, turns 6/12; listed actions are counter, accept, decline. Leo is building a multi-agent product and wants a researcher working from negotiation logs. Both are writing about agent agreement; Leo has logs and Maya has a paper slot, with shared on-site interests. They will do aggregates and a named product; first author remains open. The embedded ask is “Approve first-author and aggregates-only with Leo?” |
| `opp-priya` | Pending. Priya is in Berlin this month and wants a short research intro, not a collaboration. The terms summary says “Intro next Tuesday in Berlin. Pending owner consent. Do not reuse this approval.” No input request is supplied. |
| `opp-sam` | Rejected. Sam offered advisory help on agent papers; the terms are advisory only. |

The review must establish the following, without prescribing a fixed number
of questions or requiring a particular waiting duration:

| Check | Required behavior |
|---|---|
| Reuse the complete answer. | Retain both the named-product condition and Maya’s authorship objective. Carry the latter into other relevant decisions without inventing agreement or offer approval. |
| Evaluate Leo’s actual next move. | Do not re-ask whether aggregates are acceptable. First authorship remains unresolved. Assess whether any necessary approval would authorize a counterproposal or a concrete offer; do not present unresolved terms as already agreed. Any new question preserves material conditions. |
| Respect turn state. | Leo’s listed action vocabulary does not override “awaiting them.” A review note can preserve direction for a permitted later turn without submitting now. |
| Reconcile Priya’s evidence. | Recognize the prior scoped approval despite the stale pending-consent summary. Do not claim that an introduction happened. |
| Interpret the later priority. | Reassess Priya’s fit even without an input request. Do not mechanically revoke her approval or assume it is exempt from the new direction. Ask a focused clarification only if the unresolved relationship changes the next action. |
| Keep consent scoped. | Approval of Priya’s introduction is not approval of Leo’s offer or general permission for other introductions. |
| Preserve completed decisions. | Keep Sam rejected; do not revive an advisory-only opportunity or report a new rejection that was not performed. |
| Keep dates grounded. | The original entries lack timestamps. Do not silently infer the historical Tuesday from the review clock or move it when replaying on 14 September. Use adequate original temporal evidence, or clarify if the date is needed. |

Evaluate these small variations as well, to distinguish grounded judgment from
memorizing one response:

| Variation | Required difference |
|---|---|
| Remove Priya’s approval from the history. | Do not infer permission from agent recommendations or the terms summary; obtain authority if proceeding would require it. |
| Replace the broad advisory instruction with “Cancel the introduction with Priya.” | Treat this as an explicit revocation for that introduction. Reassess any next action, without claiming a cancellation was executed by merely saving or forwarding the instruction. |
| Add a confirmed result showing Priya’s introduction already occurred. | Acknowledge that execution when relevant; the later preference does not erase it. |
| Change Leo’s terms to forbid naming the product. | The original conditional answer no longer establishes acceptable terms; do not silently drop the condition. |
| Mark Leo’s A2A outcome agreed without adding applicable principal authority. | Retain the observed agreement and expose the authority gap; do not promote the status into consent. |
| Place an explicit intent-wide instruction after a brief answer to a match-scoped question. | Keep the brief answer’s permission scoped to its question while recognizing the separate broader instruction from its explicit wording. |

## 12. Implementation sequence and verification

For product implementation:

1. Use the repository worktree workflow. Check for an existing matching worktree
   first; the canonical root remains for design.
2. Replace the misleading commitment context with observed `agreements` and
   supply source-grounded opportunity and principal context to every review.
3. Add opportunity-targeted reconsideration using existing persisted review
   notes and durable whole-intent review of new principal input.
4. Change authored question selection, batch state, the public answer contract,
   and checkpoint/release order. Add direct-message handling and explicit
   retirement of obsolete questions.
5. Add observed activity, explicit waiting/silence semantics, and durable
   event/deadline wake-up behavior.
6. Add obstacle reporting and align A2A completion handling.
7. Rewrite prompts and examples against the final capabilities; update every
   affected caller within the agreed integration scope.
8. Verify the acceptance scenarios, then run package checks and prepare the
   implementation PR into `dev` under the repository workflow.

Run existing checks from `packages/agent`:

```sh
bun run typecheck
bun run test
bun run build
```

Update existing affected expectations, including the identity wording in
`src/core/loop.test.ts`. Do not add new persistent test files unless requested,
per the repository instructions. Use existing scenario facilities or temporary
verification to inspect checkpoint ordering, invalid batches, wake-up behavior,
and restoration. Evaluate Maya’s scenario and the variations alongside the
batch and waiting scenarios. Record which semantic scenarios were actually
evaluated with a model; do not equate a typecheck or mocked response with that
evidence. This document revision adds acceptance criteria, not test files or
claims that the proposed behavior already passes them.

No new retry framework is part of this baseline. The current single-step inbox
review can fail the session if it produces no valid decision. Keep that known
limitation visible when evaluating capability reliability rather than claiming
the prompt rewrite eliminates malformed model decisions.

## 13. Breaking changes and integration dependencies

The pending-question getter, answer signature, authored `ask`, opportunity-based
`reconsider`, waiting action names, and `acceptedCommitments` → `agreements`
context change in place. The saved inbox shape includes question arrays,
pending principal-input review IDs, and deferred review; activity and obstacle
state also change. Reuse existing per-opportunity review notes. Do not add dual
reads, legacy methods, or migrations inside the agent package. Old saved sessions
are not compatible with the new checkpoint shape; handling existing host-owned
sessions is an integration concern and must not involve deleting user data
without an explicit plan.

Current consumers that rely on the singular shape include:

| Consumer | Dependency |
|---|---|
| `packages/agent-tui/src/negotiation.tui.ts` | Reads singular `pending`, stores a displayed question, and submits one ID/text pair. |
| `services/api/src/services/personal-agent.service.ts` | Exposes singular pending state and routes one question ID to `answer()`. |
| `services/api/src/adapters/agent-session.database.adapter.ts` | Reads `state.inbox.question` and emits question notifications from that singular state. |

These dependencies must be adapted to the final array contract in the same
repository-ready implementation change. Their transport and interface design
is outside this requested package-only specification; establish that integration
scope before implementation. Do not use a compatibility path or claim repository
readiness based only on agent-package checks while those callers remain broken.

Apply the repository’s version, lockfile, and PR requirements to the actual
implementation scope. These planning documents do not implement, release,
or deploy the proposed behavior.
