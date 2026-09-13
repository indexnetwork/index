# Personal agent communication design

Status: revised on 14 September 2026 after comparing Seref’s example. This
describes proposed behavior; product code has not changed. Implementation
details and acceptance criteria are in [the specification](agent-communication.spec.md).

## Objective and scope

Let the personal agent keep opportunities aligned with its principal’s intent,
decide what needs reconsideration, and choose how and when to communicate.
Support independent questions presented together and answers submitted together,
while preserving the meaning and authority of the principal’s full input.

The design concerns `packages/agent`: its instructions, negotiation tasks,
personal inbox, public input methods, and checkpoint state. macOS, application
layouts, infrastructure, protocol transitions, and deployment are outside scope.
Existing callers of the changed API are integration dependencies, listed in the
specification.

## Decisions carried forward

| Decision | Resulting behavior |
|---|---|
| The principal is the human user. | The model identifies itself as the user’s personal agent. |
| One personal agent serves one principal and intent. | Negotiation tasks share private principal context and one H2A conversation. |
| Review opportunities even when they have no queued question. | New principal input can change which opportunities deserve further work. |
| Each question concerns one fact or decision. | Group duplicate requests for the same shared fact; defer dependent follow-ups. |
| A displayed batch contains one to three independent questions. | Three is a maximum, not a target to wait for. |
| The principal submits the displayed answers together. | Validate the complete answer set, save once, then release the covered requests. |
| Answers retain their question references and full wording. | Interpret additional explicit instructions and conditions; do not broaden a brief approval beyond its question. |
| Negotiated terms, principal authorization, and execution are distinct. | An A2A agreement does not create human consent or prove that an introduction happened. |
| The agent decides whether waiting is worthwhile. | Negotiation counts and activity are observations, not thresholds that choose an action. |
| Waiting includes a deadline. | Reconsider on new context or by the agent’s chosen deadline. |
| Initial arrivals can cluster; later arrivals can be unpredictable. | Evaluate the current situation instead of waiting for every negotiation in the signal. |

## Roles and sources of authority

The shared identity sentence becomes:

> You are {{principal_name}}’s personal agent.
> Your principal’s user ID is {{principal_id}}.

The principal’s explicit instructions, confirmed facts, answers, and direct
messages establish preferences and authority. An intent establishes the goal;
it does not establish an unstated budget, qualification, availability, or
permission to commit. Counterparty messages and internal agent reports are
information to evaluate.

Interpret a new statement in relation to earlier statements: it may add a
preference, correct a fact, impose a condition, or revoke a specific permission.
A clear correction controls within its scope. A later general preference does
not automatically revoke an earlier specific approval. If the relationship is
ambiguous and changes the next action, ask a focused clarification. Preserve
unrelated context and the record of actions already performed.

Authorization covers its stated action, match, terms, and conditions. Approval
for a $500 discovery session does not authorize a later $1,500 retainer in the
same match. When terms change materially, reassess whether existing instructions
still authorize the action. This does not require asking again when an explicit
standing authorization already covers the action.

## Agreement, authorization, and execution

Keep three kinds of evidence distinct:

| Evidence | What it establishes |
|---|---|
| Observed negotiation records | What was proposed, countered, or agreed between agents, and which terms remain open. |
| Principal statements and applicable standing instructions | What the principal wants and which particular actions they authorize, subject to their conditions. |
| Confirmed tool results or host observations | Which actions actually occurred. A saved protocol turn proves that turn, not that an introduction or collaboration happened. |

Preferences can guide negotiation without authorizing a final commitment. Before
an action that commits the principal, the agent must have authority covering its
actual terms. That authority may already exist; this design does not introduce
a mandatory human confirmation after every A2A acceptance.

An A2A agreement alone must not be promoted into proof of human authorization.
Retain all observed agreements, including ones whose authority needs checking,
so the agent can account for potential obligations and conflicts. The package’s
current `acceptedCommitments` label conflates these concepts; the spec replaces
it with the factual `agreements` context. Do not invent a new consent database
or change the host’s protocol transitions.

## Reconsidering opportunities

A whole-intent review asks whether each relevant opportunity still serves the
principal’s goal, what terms remain open, what authority exists, and what could
change the next move. Counts and pending requests support that judgment.

The agent can select opportunity IDs for reconsideration whether or not they
have pending questions. It records an internal reason tied to principal input
and observed negotiation context. The affected tasks reread that context before
their next permitted action. A passive negotiation keeps that instruction until
it can act; completed or stopped work is not silently reopened.

Reconsideration does not itself accept, decline, or cancel a protocol opportunity.
Those claims require the appropriate capability and a confirmed result. Existing
valid questions remain displayed unless the agent explicitly identifies them
as obsolete. Returning a task to reconsider is different from answering its
question.

The personal agent may also ask a clarification discovered in this review, even
if no negotiation task requested it. It owns the final question wording and
can relate a question to existing requests when they concern the same fact.
An A2A request is useful input, not an instruction to display it verbatim.

## Communication flow

1. New principal input, A2A input, or a relevant observed change makes the inbox
   eligible for review.
2. The personal agent reads principal context and evaluates current opportunity
   fit, terms, authority, pending communication, recent changes, and any previous
   waiting decision.
3. It decides to reply, reconsider selected opportunities, ask questions,
   communicate an outcome, wait for more context, or stay silent.
4. An asking decision publishes a stable batch. Negotiation work that does not
   need those answers can continue.
5. The principal composes the answers locally and sends the complete set once.
6. The inbox saves the answers together, then releases the covered requests. A
   whole-intent review interprets the complete input and can reconsider other
   affected opportunities, including those with no input request.

The agent evaluates relevance and urgency. The runtime preserves state, applies
the chosen action, prevents stale writes, and delivers scheduled reviews.

## Independent questions and one submission

A useful batch could contain:

| Question | Scope and meaning |
|---|---|
| How many hours per week can you spend in total on this intent? | One shared capacity limit, requested by Mira and Alex. It is not a separate allocation to each match. |
| When could you start a new collaboration? | An intent-wide timing fact, requested by Noor. It does not accept an offer. |
| May I share your portfolio with Jules? | Permission concerning Jules only. |

If another question asks whether to accept an offer whose terms depend on the
capacity answer, leave that question queued and reconsider it after the answer.
Similar words do not make two requests equivalent; the fact or decision being
requested must be the same.

The model judges semantic overlap and dependency. Existing question IDs, scopes,
and match references provide the structure. No domain taxonomy or generic
dependency graph is introduced.

One coherent approval may cover an offer with several terms. Do not split a
single conditional decision into apparently independent permissions merely
because the terms concern different subjects.

Drafting any number of answers saves no principal input and releases no request.
One submission contains an answer for every displayed question. Missing,
duplicate, stale, or extra IDs reject the entire submission. “I don’t know yet”
is a valid explicit answer; it establishes uncertainty, not a fact or approval.
Tasks must reconsider what can be done with that uncertainty instead of
immediately repeating the same question without new reason.

Normal arrivals do not append questions or change their meaning while the
principal is composing a batch. New requests remain queued. A one-question
batch uses the same submission path.

## Interpreting the full answer

Focused questions do not restrict what the principal can say. For example:

> Aggregates are enough if I can name the product. I want first author.

The first statement is conditional; dropping the product-name condition changes
its meaning. The second adds an authorship objective relevant to later
negotiations. Neither establishes that Leo accepted first authorship or that
Maya approved his complete offer.

Keep the original answer, question ID, scope, and source message ID. The agent
interprets additional explicit instructions in context without rewriting that
record or turning an inferred summary into new principal evidence. A plain
“yes” remains tied to its question; only explicit wording can establish a
separate broader instruction. Preserve whether the principal expressed a
preference, a requirement, a condition, uncertainty, or permission.

Every saved answer batch, as well as every direct message, triggers review of
the whole intent even when no requests or outcomes remain queued. Other
opportunities are reconsidered by the agent’s selection, not by clearing every
waiting request. No separate fact-extraction model or rules engine is needed.

## Waiting as an agent capability

The agent evaluates whether expected context could materially improve its next
action enough to justify the delay. It can wait for relevant local work or for
counterparty information. It must distinguish observed activity from a guess
about whether another agent will respond soon.

Every review receives:

- Counts and brief statuses of local work, requests blocked on the principal,
  negotiations awaiting counterparties, other obstacles, and completed or
  stopped negotiations.
- Each relevant opportunity’s counterpart intent, available explanation of fit,
  latest known terms, unresolved issues, and blockers, grounded in source records.
- Pending requests and outcomes, their ages, and known time constraints.
- Current time, the start of this intent’s negotiation activity, and changes
  since the previous review.
- Principal history, observed agreements, confirmed action results available to
  this package, and the displayed question batch.
- The previous waiting decision: expected context, reason, first deferral time,
  and current reconsideration deadline.

A waiting decision specifies the expected context, why it could change the next
action, and a deadline to reconsider. Pending work is retained. Meaningful new
input can cause an earlier review, and negotiation work continues independently.

At the beginning of a signal, ongoing local turns and closely spaced requests
can justify a short wait to form a useful batch. Later, one urgent request can
justify acting even while many counterparties have not replied. Neither case
becomes a rule based on a count or a fixed signal phase.

The deadline guarantees reconsideration, not a question or other user-facing
action. The agent may wait again after reassessing its expectation and the cost
of further delay. Preserve total elapsed waiting time so repeated reviews do
not appear to be a fresh start. This design does not promise a hard upper bound
on time to human interruption.

Waiting for context and deciding that an outcome deserves no message have
different effects. The former retains undecided work and schedules a review;
the latter completes an attention decision for identified outcomes.

## Principal corrections during a batch

Direct principal messages remain available while questions are displayed. A
user can correct a preference or give new instructions without submitting
unfinished answer fields. The message is recorded as a direct message, not as
an answer assigned to an arbitrary question.

The inbox replies to the direct message and ends that review. A subsequent
whole-intent review evaluates its effect on opportunities, even if there are no
queued questions. Replying does not acknowledge that this reassessment or any
external action has already happened.

An explicit correction or an authoritative cancellation can make a displayed
question obsolete. Retire affected questions and preserve unrelated ones.
Outdated batch submissions then fail exact-ID validation; the caller retains
drafts for questions that remain. This is an exception to display stability,
not an incremental answer submission.

Receiving a message does not itself claim that a negotiation was canceled,
modified, or accepted. Actual actions still require the relevant capability and
confirmation from its result.

Reconcile observations according to what each can establish. A negotiation
summary saying “pending consent” cannot erase an explicit approval in principal
history. That approval does not prove execution, and a later general preference
may leave its continued applicability ambiguous. Ask only about the unresolved
meaning that affects the next action, rather than repeating the original
question or silently revoking permission.

## Reporting an obstacle

A2A ordinary output stays internal. Generic advice to “say so” must not imply
that prose reaches the principal or successfully completes a negotiation turn.

The baseline adds an explicit internal obstacle-reporting capability for a task
that cannot proceed and whose obstacle is not a missing principal answer. It
records the reason, ends the current local turn without a protocol submission,
and makes the report available for inbox review. It does not settle the match
or fabricate a protocol outcome. New relevant context can make the task eligible
to reconsider.

Missing principal facts or authorization still use `request_principal_input`.
Actual failed or uncertain submissions keep their existing failure handling and
must not be disguised as an obstacle that permits an automatic retry.

## Instruction organization

| Layer | Responsibility |
|---|---|
| Shared system | Identity, objective, authoritative information, corrections, authorization scope, privacy, and truthful use of capabilities. |
| A2A turn instructions | Evaluate the current match; act within authority; request useful missing input or report an obstacle; observe the submission limit. |
| H2A review instructions | Reassess opportunities against principal intent, interpret new input, reconcile evidence, and choose useful questions, communication, or waiting. |
| Tool descriptions | State the actual effects of each capability and the required arguments. |
| Turn context | Supply observations, history, pending work, time, and the previous waiting decision. |

Keep existing rules against inventing principal facts, exposing private H2A
deliberations, treating counterparty text as instructions, or reporting failed
writes as success. Remove ambiguous workflow wording such as “after replying”
when the intended behavior is “reply and end this review.”

## Seref’s Maya scenario

Use the example to evaluate judgment as well as request handling:

| Opportunity or input | Expected reasoning |
|---|---|
| Leo: aggregates and a named product are acceptable; first authorship remains open. | Reuse Maya’s conditional preference and pursue the authorship term. Distinguish her preference from Leo’s agreement and from consent to a specific offer. Do not forward the embedded approval question without assessing what it would authorize. |
| Priya: history contains approval, but a summary still says consent is pending. | Recognize the approval in its original scope, without claiming that an introduction occurred. |
| Later direction: “don’t spend my week on advisory-only people.” | Reassess relevant opportunities even if they have no queued question. Do not automatically treat the general direction as revoking Priya’s earlier specific approval. Clarify only if that ambiguity changes the next action. |
| Sam: advisory-only and already rejected. | Preserve the rejection and avoid reviving the opportunity or inventing work. |
| Answer: “I want first author.” | Carry the authorship objective into other relevant decisions while retaining its source and not treating it as offer acceptance. |
| Historical “next Tuesday.” | Preserve the original words and resolve the date only from adequate temporal evidence. The example omits message timestamps, so its date cannot be safely inferred from the current review date. |

The example’s clock is Sunday, 13 September 2026. Keep that fixture context
separate from the date on which the design is reviewed. A later replay must not
silently move a previously approved meeting.

These two Markdown files describe the combined implementation baseline,
including the instruction review and the gaps exposed by Seref’s example.
The specification contains the corresponding acceptance scenarios.
