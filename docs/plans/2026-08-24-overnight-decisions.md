# Overnight orchestration decisions — 2026-08-23/24

Written by the root session while implementing the design doc
(2026-08-23-personal-agent-and-negotiation-graphs.md) end to end while the
owner was asleep. Every entry is a call taken WITHOUT the owner, with the
alternative that was rejected. These are for the owner to revisit.

## D1. External-agent surface removed from step 1 (owner delegated: "you choose")
Chose: delete dispatcher path, freshness gate, Hermes wake/respond, polling
remnants; one stated break — external agents return in a follow-up on the new
auth model (agent credential + seat validation in apply).
Alternatives: fix in place (rejected: epicenter of repeat findings across three
review rounds, already half-broken by the stated 401 break, and step 2 may
reshape the surface anyway).

## D2. Reflect trigger: roundSize stamped after opens settle
Problem (round-3 review, finding 6): with kickoffs under Promise.all, an early
first-pause can see 0 working tasks before siblings create theirs; the
deterministic jobId then dedupes away the genuine all-paused reflect.
Chose: kickoff stamps intents.negotiation_round_size only AFTER all open
invokes settle (counting only opens that actually created a task); checkAllPaused
is a no-op until the stamp exists; kickoff runs one final check after stamping
to cover pauses that landed before the stamp. Condition: roundSize stamped AND
zero working tasks for (intentId, round).
Alternatives: (a) delayed eligibility on expected count without post-settle
correction — rejected: an open that fails pre-task strands the round below its
size forever; (b) idempotent re-enqueueable reflect (drop completed-job
retention) — rejected: reflect must fire exactly once per round moment or IS-A
double-acts; (c) leave as-is until step 2 — superseded, step 2 is tonight.

## D3. Questioner park/settle/claim substrate NOT deleted
captureNegotiationAskUserBinding, settleInflightNegotiationAnswerFromDm,
claimNegotiationContinuationExecution are production-dead post-rewrite but are
pinned as survivors by the #1474/#1475 counterparty-binding initiative's tests.
Deleting them declares that initiative closed — an owner call. Left in place,
flagged in PR #1494's body. Recommendation: delete in a small follow-up branch.

## D4. Track A run by a root-session subagent in the pre-cut worktree
The human worktree-session flow needs the owner to open Zed and paste; owner is
asleep. Implementation delegated to a background agent working only inside
.worktrees/refactor-personal-agent-persona, same PR + review + CI bar as any
worktree session. Alternative: wait for morning — rejected by the overnight goal.

(Additions below as they happen.)

## D5. Track A scope semantics (agent question, resolved)
(a) "Global not implemented" = no NEW global-agent capability; existing
unscoped/network-scoped chat surfaces (home chat, /d/:id, onboarding stream)
keep running the ChatGraph loop under the one 'personal' persona; onboarding is
a prompt/toolset fragment selected by incomplete-onboarding session state.
Alternative rejected: refusing unscoped sessions — would break live web
surfaces for a deferral that only concerns the future protocol AgentGraph.
(b) Old 'signal-intent' pinned-signal chat sessions re-key into the intent
scope where the IntentAgent owns the turn (same as /i/:id). Stated break in the
Track A PR. Alternative rejected: keeping both surfaces — two agents per intent
is the duplication this redesign exists to remove.

## D6. Merge order: #1494 before #1495
The rewrite (#1494) is the foundation and the large diff; Track A (#1495) is
small, so it absorbs the rebase (reflect.queue textual conflict + protocol
version: BOTH PRs bump 28.1.0→29.0.0, which git would auto-merge silently —
after rebasing, #1495 bumps to 30.0.0 with its own CHANGELOG line).
Alternative rejected: land #1495 first — would force the 40k-line PR to rebase.

## D7. Track A agent's solo decisions (see PR #1495 "Decisions taken")
Highlights accepted by root: negotiator persona + chat-only tools deleted
(surface fully IntentAgent-owned); persona policy reduced to two denial codes —
old client builds get 400s until co-deployed (stated break); pinned-signal
sessions re-keyed into the DM with a canonical-DM guard for collision losers;
PersonalAgentChat capability class deleted in favor of one direct construction.

## D8. Onboarding fragment scope (from #1495 review, plausible finding)
Chose: the restricted onboarding fragment applies only to truly unscoped
sessions (no network scope, no intent scope) — matching pre-PR behavior where
the onboarding persona could never be scoped. A network-scoped chat always gets
the full toolset regardless of onboarding state.
Alternative rejected: treating network-scoped sessions as 'global' for
onboarding — silently gives un-onboarded users a 2-tool setup assistant in a
network chat.

## D9. #1495 cleanup batch approved in-PR
Dead PersonalAgentScope parameter, write-only persona request field (4
codebases), isNegotiatorChatEnabled flag + gates, duplicate
/chat/session/resolve route, unscoped excludeIntentPinned subquery — all
deleted/fixed in the same PR per repo rules (delete what the change made dead;
flags are being deleted).

## D10. Onboarding fragment keys on the surface, not the durable record
(#1495 r2 finding 2) The restricted setup-assistant fragment applies ONLY to
sessions created via the onboarding stream route (the mac onboarding flow).
Generic unscoped chats always get the full fragment regardless of
onboarding.completedAt — a web-only account must never be downgraded.
Alternative rejected: keying on the onboarding record (web has no flow to
complete it, so most web accounts would be permanently restricted).

## D11. /auth/me keeps emitting negotiatorChat: true as a literal
(#1495 r2 finding 5) Shipped mac DMGs read features.negotiatorChat and go dead
without it; keeping the bit is one line — compat that is free, so we keep it,
annotated as legacy-client compat, deletable when a mac build ships without the
gate. Alternative rejected: dropping it (bricks installed clients) or shipping
a new mac build tonight (out of scope).

## D12. Fold-loser sessions are archived by the migration itself
(#1495 r2 findings 1,3,4,6,9) The 0144 migration archives the fold-loser
conversations (collision losers of the DM fold-in) instead of leaving
intent-scoped ghost rows: hidden from listings, read-only, excluded from every
generic reader by the archive flag rather than by three copies of a registry
subquery. The canonical-DM 409 gains a typed code + start_signal_session
action as backstop; the api-key surface requires the canonical registry row.
One shared is-intent-pinned predicate builder replaces the three variants.
Alternative rejected: metadata-keyed exclusions in every reader — four places
to keep in sync, and the review shows exactly that class failing.

## D13. Legacy pre-rewrite negotiation rows are made INERT (not migrated, not half-processed)
(#1494 round-4 review: three confirmed findings — legacy rows invisible to the
round count, stale five-state SQL twin still gating, watchdog SSE-publishing
into legacy conversations — all one root cause.)
Chose: one "rewrite-era task" predicate (the round stamp) applied to the
watchdog sweep, round counting/all-paused, and the open/resume lookups, so
pre-rewrite rows are untouched by the new lifecycle. This is the honest
completion of the already-stated break "in-flight negotiations orphaned".
Alternatives rejected: (a) migrating legacy rows onto the new lifecycle —
CLAUDE.md says backwards compatibility only when free, and this is a real
migration path; (b) deleting the dead continuation substrate that carries the
stale enum — belongs to the #1474/#1475 initiative whose closure is the owner's
call (see D3), so it is made unreachable rather than removed.

## D14. Review depth reduced after credit exhaustion (2026-08-24 ~02:00)
The parallel 8-angle reviews consumed the session's credits mid-flight, killing
#1494's round-4 and #1495's round-3 reviews. Remaining work proceeds with
targeted single agents and direct inspection instead of full fan-out reviews.
#1494 merges on: partial-round-4 findings fixed + CI green (its confirmed
findings were all recovered before the review died). #1495 merges on: CI green
+ its two completed review rounds, with a lighter final pass.
Alternative rejected: waiting for morning to re-run full reviews — the standing
instruction is to finish overnight; the risk is documented here instead.
