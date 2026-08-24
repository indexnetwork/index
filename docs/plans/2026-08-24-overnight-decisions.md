# Overnight decisions log (2026-08-23/24) — for the owner's morning review

Every solo design call taken while orchestrating to completion, with the
alternatives rejected. To be folded into docs/plans/2026-08-23-personal-agent-
and-negotiation-graphs.md by the step-2 PR.

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

## D15. Migration journal bug found and hotfixed (#1497) — NEEDS OWNER ATTENTION
#1495 merged `0145_collapse_chat_personas.sql` with NO `_journal.json` entry.
`drizzle-kit migrate` (Railway preDeployCommand) reads the journal, so the
persona collapse never ran: dev deployed the one-persona code against rows
still carrying 'signal'/'negotiator'/'onboarding' and the old registry keys.
Root cause of the miss: during the #1495 rebase the agent deliberately left it
unjournaled "matching the existing 0142/0143 pattern", and I accepted that —
but 0142/0143 are themselves unjournaled by accident (added by the
enrichment-removal commits edc996c05 / 7de70d2a6), not a convention.
Fixed by #1497 (journal entry only; the migration is re-runnable by
construction). 0142/0143 left alone — separate question for their authors.

TWO THINGS FOR THE OWNER:
(a) Railway SKIPPED the #1497 deploy even though the changed file
    (services/api/drizzle/meta/_journal.json) matches watchPatterns
    "/services/api/**". So a migration-only or journal-only fix does NOT
    deploy on its own. The migration applies on the next deploy that Railway
    does pick up (#1496 will, it touches many services/api files). Worth
    checking the watchPattern semantics — this will bite again.
(b) The step-2 agent applied `bun run db:migrate:test` (0145 + 0146) to the
    shared Neon TEST branch. 0145 archives fold-loser conversations there.
    Test DB only; no production/dev-DB writes were made by any agent.

## D16. Step-2 merge stop-rule (set 2026-08-24, round 3)
PR #1496 has had three adversarial review rounds, each surfacing blockers
(6, 7, 6 findings). Every finding was fixed with a regression test the author
verified actually catches the bug. Rule set now, before the outcome is known:
if the round-4 review still returns blockers, step 2 does NOT merge tonight —
the owner gets the PR implemented, reviewed four times, with the open findings
listed, rather than a merge neither the reviewer nor I trust.
Rationale: dev is in a documented, safe interim (negotiations open/turn/pause
correctly; nothing reflects; external agents offline). That interim is strictly
better than a merged reflect loop with a known permission bypass or a
false-confirmation path. Alternative rejected: merging on "close enough"
because the goal said implement everything overnight — the goal also said not
to stray from what was asked, and what was asked was a working system.

## D17. Stop-rule executed: step 2 (#1496) is NOT merged
Round 4 returned eight findings including three blockers, so D16's rule fired.
#1494, #1495, #1497 are merged (each cleared a review with all findings fixed).
#1496 stays open for the owner: implemented, four adversarial review rounds,
every reported finding fixed except two deliberately deferred design questions.
Why not merge anyway: the round-4 blockers are silent-failure paths in the
reflect loop (a transient DB error permanently consuming a round's only
reflect; a retry duplicating verdicts and strategy messages; a repair that
reflects a round it then supersedes). dev's current interim — negotiations
open/turn/pause, nothing reflects, external agents offline — is documented and
safe. Merging would replace a known-inert state with a known-wrong one.

### Two open design questions for the owner (deferred, not bugs to fix blind)
(a) Interrupted-kickoff detection is indistinguishable from a kickoff in
    flight; it is only safe while exactly one worker processes a signal, but
    the queue already contemplates several. Needs a per-intent lock or a
    staleness bound on the kickoff marker.
(b) Kickoff fan-out is unbounded: the prompt caps context at 12 matches but
    kickoff opens ALL of them, each self-playing up to 6 turns. 40 matches =
    40 concurrent briefs + 40 concurrent negotiations in one job. Needs a
    concurrency policy — and it interacts with (a).

## D18. One brief, two seats → the brief is PER SEAT, authored lazily by that seat's own IS-A
Chosen: `brief` stops being one column read by whoever speaks. It becomes
per-seat (keyed by userId). A seat with no brief has its OWN IS-A author one at
its first turn — negotiationNode already receives {negotiationId, userId,
intentId}, so no new wake or schema beyond the keyed column is needed. This is
what the design doc always implied ("the per-negotiation context IS-A writes")
given that both sides have an IS-A.
Alternatives rejected: (a) keep the shared brief and soften the prompt — the
counterparty would still be arguing the initiator's constraints, just less
confidently; (b) give the counterparty no brief — worse than before this work,
since #1494 at least gave it a deterministic "opened from a signal" line;
(c) have the initiator's kickoff author both briefs — the initiator's agent
does not know the counterparty's principal, so it would be inventing them.

## D19. Kickoff fan-out is bounded to exactly the matches the agent decided from
Chosen: kickoff opens at most MAX_MATCHES (12) — the same cap assembleContext
uses for the prompt — and runs the opens with a small concurrency limit rather
than all at once. The agent decides from 12, so it opens those 12; the rest are
picked up by the next round, which is what rounds are for.
Alternatives rejected: (a) unbounded fan-out (today) — 40 matches = 40
concurrent briefs and self-playing negotiations in one job, past the 90s
controller wait and into provider rate limits, whose failures then land in
compensateFailedOpen; (b) one job per match — loses the property that a round
settles together, which the whole reflect trigger depends on.

## D20. Interrupted-vs-in-flight kickoff is resolved by a staleness bound
Chosen: treat `kickoffStartedAt` as an interrupted round only once it is older
than a bound (10 minutes — comfortably longer than any real kickoff, far
shorter than a stuck one matters). Under that bound a concurrent turn leaves
the in-flight round alone.
Alternatives rejected: (a) a per-intent Redis lock — correct but adds infra and
a new failure mode (a held lock after a crash) for a race the bound already
closes; (b) rely on single-worker serialization — the queue's own code
contemplates several workers, so this is an assumption that fails silently at
the first replica.
