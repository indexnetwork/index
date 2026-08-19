# Checklist negotiations: match qualification as a grounded dialogue

**Status: draft — theory and target model agreed, slicing not yet cut.**
Reference prototype: `docs/plans/2026-08-19-negotiator-floor.reference.jsx`. Companion plans:
`2026-08-18-conversational-questions.md` (delivery spine this reuses),
`2026-08-17-personal-agent-authored-questions.md` (superseded authoring model).

## Why

The conversational-questions spine (#1428–#1443) works: a park produces a
question message in the DM within seconds. But the *policy* starves it. Three
days of dev testing: 24 negotiations involving the owner, 23 concluded
agent-only, 1 park — and that question went to the counterparty. Under the
current stance rules, asking is an exception (stall, or a flagged owner
constraint); with skeptic verification the agent almost always reaches
accept-or-pass from profile evidence alone, so it concludes — and concluding
means never asking. The floor prototype inverts this: **asking the principal is
the default move for resolving unknowns**, bounded by a budget, and the verdict
is a function of an explicit checklist rather than free-form judgment.

This plan grounds that inversion academically and maps it to prompt- and
schema-level rules. It is not an implementation plan yet.

## 1. What this negotiation IS (and is not)

Formally, our "negotiation" is **not bargaining**. There is no price, no
surplus to divide, no ZOPA, and the prototype forbids negotiating deal terms
outright. In the Walton & Krabbe dialogue typology (*Commitment in Dialogue*,
1995 — six types: information-seeking, inquiry, persuasion, negotiation,
deliberation, eristic), what our agents do is a **deliberation dialogue** —
"should these two people meet?" — with **embedded information-seeking
sub-dialogues** (agent → own principal) spliced in when the deliberation hits a
privately-held unknown. Mixed/embedded dialogues are the normal case in that
framework, and the shift into information-seeking and back is a legitimate,
rule-governed move — not a failure of the outer dialogue. That is the academic
name for what a park is.

Two more frames pin down the verdict semantics:

- **Two-sided matching** (Gale–Shapley): a match requires *mutual*
  acceptability — each side's screen must pass independently. The prototype's
  handshake (one agent proposes a match; the other agrees unless it sees a real
  conflict) is exactly two-sided acceptance. "Mutual want" is not one checklist
  dimension among many; it is the mutuality condition of matching itself, which
  is why the prototype hard-codes it into every checklist.
- **Optimal search** (Weitzman's Pandora's-box model / optimal stopping): a
  match verdict is not a certificate of compatibility — it is a decision that
  **the first conversation is now the cheaper instrument for gathering the
  remaining information**. Dialogue turns and principal questions have a cost;
  when the residual unknowns are things "people naturally settle when they
  meet," continuing to interrogate through agents costs more than the meeting
  it is trying to de-risk. "Match = worth a first conversation, nothing more"
  is a stopping rule, and it should be stated in the prompt as one.

## 2. The checklist: a pre-registered conjunctive screen

The checklist is the schema-level heart. Its grounding:

- **Satisficing, not optimizing** (Simon): match when every dimension is
  satisfactory ("ok"), not when some weighted utility is maximized. There are
  no scores, no weights, no compensation between dimensions. This is a
  **conjunctive screening rule** from the choice-heuristics literature — and it
  is deliberately *non-compensatory*: a great answer on one dimension cannot
  buy out a conflict on another.
- **Rejection is Elimination by Aspects** (Tversky, 1972): one clearly
  conflicting aspect eliminates the candidate. This keeps the Federico-class
  outcome correct: a hard evidence contradiction still passes/rejects with no
  question asked, because no answer from the principal can un-conflict it.
- **Fixed after turn 1 = pre-registration.** Freezing the dimensions before
  any evidence is exchanged is the same discipline as pre-registered study
  criteria: it prevents goalpost-moving in both directions — an agent talking
  itself into a match by dropping hard dimensions, or out of one by inventing
  new requirements after the counterparty answered the original ones. The
  checklist is authored once, from the two intents alone, and every later turn
  may only *re-score* it.
- **Dimension selection is multi-attribute decision analysis in miniature**
  (Keeney & Raiffa): 3–5 attributes, each decision-relevant (its value can
  change the verdict), non-overlapping, and testable from facts a principal
  could state. "Mutual want" always; then only what truly matters — location or
  format, stage or type fit, timing, one hard constraint. A dimension no
  plausible answer could flip is not a dimension; it is decoration.
- **Scoring is evidence-provenance-bound.** A dimension may be scored `ok` or
  `conflict` only from the **commitment store** — what the principals have
  actually stated: intents, premises, and answers given in negotiations. This
  is Walton & Krabbe's commitment store made concrete, and it is the checklist
  form of #1448's provenance rule: the agent's own prior conclusions and past
  verdicts are *decisions*, not commitments, and can never score a dimension.
  A dimension with no commitment either way is `unknown` — it is not rounded
  to `ok` by vibes or profile inference.

Schema sketch (state-level, carried across turns):

```
checklist: [
  { name: string,                      // fixed at turn 1
    kind: 'mutual_want' | 'hard_constraint' | 'fit',
    result: 'ok' | 'conflict' | 'unknown',
    basis: string }                    // the commitment(s) it was scored from; empty iff unknown
]
```

`basis` is the audit trail: an `ok`/`conflict` with an empty basis is invalid
by schema, which is the machine-checkable form of the provenance rule.

## 3. When an agent asks: the pivotal-question rule

The literature on elicitation during negotiation converges on
**value-of-information**: ask when the expected value of the answer exceeds the
cost of asking (Baarslag et al.'s VOI-based elicitation; the clarifying-question
and information-gain lines in the LLM-agent literature). We do not compute
EVSI numerically — we encode its *qualitative preconditions* as an
admissibility rule. An agent may ask its principal iff **all** hold:

1. **Unknown** — the dimension is `unknown`: no commitment from either
   principal settles it.
2. **Pivotal** — some plausible answer would change the verdict. Schema-level
   enforcement: every ask carries an *answerhood map* (below). If every branch
   of the map leaves the verdict where it is, the question has zero value of
   information and is inadmissible.
3. **Principal-authoritative** — the missing fact is privately held by the
   agent's own principal (their preference, constraint, or willingness). If
   the commitment store can settle it, the agent must answer from stated facts
   instead — Clark & Brennan's principle of **least collaborative effort**:
   never spend the principal's attention on what the transcript already
   contains.
4. **Unasked** — the topic has not been asked in this negotiation. A vague but
   non-negative answer counts as `ok` (charitable closure); re-asking a topic
   is a repeat regardless of phrasing.
5. **Budget remains** — at most **3 questions per negotiation per principal**
   (bounded rationality made explicit; absorbs the pre-contact consult cap for
   negotiation-time asks). Budget spent + nothing in conflict → match: the
   remaining unknowns are exactly the "settle it when you meet" residue of the
   stopping rule in §1.

Rule 2 is the important cultural change: today's stances ask "can I verify
this from evidence?" and pass when they cannot. The checklist model asks "is
this unknown *askable*?" first — pass is reserved for `conflict`. An unknown
never kills a negotiation; it is either asked about, or explicitly deferred to
the meeting once the budget is spent.

The pre-contact consult (#1445) is the same rule at turn 0: an unknown that is
pivotal *before any contact* and client-resolvable. It stays; it becomes the
turn-0 case of one rule instead of a separate mechanism.

## 4. What the questions ARE

Grounded in the Questions-Under-Discussion framework (Roberts 1996): every
open `unknown` dimension is a QUD, and a principal question is a discourse
move that addresses **exactly one** of them.

- **One dimension, one question.** Never bundle. (Cognitive load on the
  principal; and the answerhood map is only well-defined per-dimension.)
- **Closed answerhood.** The question must be answerable in one sentence, and
  the ask declares a priori how answers score the dimension:

```
ask: {
  dimension: string,                   // must name an existing checklist item
  question: string,                    // one topic, one sentence, plain words
  answerhood: {
    ok_when: string,                   // what kind of answer scores it ok
    conflict_when: string }            // what kind of answer scores it conflict
}
```

  Writing `ok_when`/`conflict_when` *before* asking is the pivotality proof
  (rule 2): if the author cannot say what answer would flip the verdict, the
  question is not askable. It also makes answer consumption deterministic at
  the prompt level: the answer is scored against the declared map, not
  re-interpreted freely.
- **Counterparty context in the phrasing.** The question names who/what it
  unblocks ("Ada's agent asked whether…", "to decide on Yusuf: …") — grounding
  in the Clark sense: the principal should not need to open the transcript to
  answer.
- **The answer becomes a commitment.** Every answer is appended to the
  principal's durable fact ledger — in our system, a **premise** (provenance:
  `negotiation_answer`) — public to all of that user's future negotiations.
  This is the prototype's "Agent knows" panel, and it compounds: each answered
  question makes every future checklist more scorable and every future
  negotiation quieter. It also composes exactly with the answer-only-intents
  principle: a user's answer is user-authored evidence — precisely the class
  verification (#1446/#1448) is allowed to ground in.

## 5. Blocking, dismissal, and no expiry-to-pass

An open question **holds the negotiation parked** until answered or dismissed.
No timer resolves it to pass (#1445's expiry-to-pass is retired by this plan
for negotiation-time asks). Rationale: an expiry that silently converts "the
agent needs to know X" into "assume the worst" punishes the principal for
being away — and empirically produced zero owner questions. Nothing expires in
the floor model; "Matched" is where humans take over, and unanswered simply
stays visibly waiting.

Dismissal ("not relevant") is itself a verdict: the principal retracting the
negotiation's premise closes it as rejected. That is a commitment-store
retraction in the Walton & Krabbe sense, made by the store's owner — the one
party entitled to make it.

## 6. Verdict rules, restated as prompt law

- `match` — every dimension `ok`, **or** budget spent / only
  meeting-settleable unknowns remain **and** nothing is `conflict`. Requires
  the two-sided handshake: propose, counterparty agrees unless it names a real
  conflict.
- `reject` — any dimension `conflict` (with basis), or the intents are
  unrelated. Never for mere unknowns.
- `ask` — the admissibility rule of §3, one dimension per ask.
- otherwise — continue the dialogue: state facts from the commitment store,
  answer what the counterparty's agent asked, update the checklist.
- Deal terms, valuation, logistics: out of dialogue scope, always. Matching
  means "worth a first conversation," nothing more.

## 7. What this changes in production (prompt/schema level)

Reused unchanged: the delivery spine — park → question message in the DM,
```index-questions block, singleton serialization, edit rule, answer
consumption seam, notifications (#1429–#1441). The change is **when parks
happen and what the ask payload carries**.

1. **Negotiation state schema** gains `checklist` (§2 shape), authored turn 1,
   re-scored per turn. The turn prompt renders it every turn.
2. **Ask payload schema** gains `dimension` + `answerhood` (§4 shape); the
   question block in the DM renders the dimension name as the step label.
3. **Stance contracts** (`negotiation.stance.contracts.ts`): the checklist
   protocol and §3 admissibility rule become the core of evaluator/skeptic
   turn rules. The verification duty (#1446) and provenance rule (#1448)
   survive as the `basis` discipline — they move from prose duties to schema
   constraints. The strict-prefix architecture and advocate-byte-identical
   invariant need re-examination here: this is a restructuring, not a fragment.
4. **Question budget** (3/negotiation/principal) replaces the pre-contact
   consult cap for negotiation-time asks; turn-0 consult becomes the budget's
   first draw.
5. **Answer persistence**: consumed answers additionally write a premise with
   `negotiation_answer` provenance.
6. **No expiry-to-pass** for negotiation asks (§5); parked stays parked,
   visibly.

Not in scope: UI beyond the existing question steps (checklist bar and fact
ledger surfaces are a later, separate plan); multi-party floors (the prototype
is n-seat, production stays bilateral per opportunity); any deal-term
capability.

## 8. Grounding bibliography

- Walton & Krabbe, *Commitment in Dialogue* (1995) — dialogue typology,
  embedded information-seeking, commitment stores and retraction.
- Gale & Shapley (1962) — two-sided matching, mutual acceptability.
- Simon (1956) — satisficing; conjunctive screening.
- Tversky (1972) — Elimination by Aspects (rejection semantics).
- Keeney & Raiffa (1976) — decision-relevant attribute selection.
- Weitzman (1979) — Pandora's box: search, inspection cost, stopping rules
  ("the meeting is the cheaper next experiment").
- Clark & Brennan (1991) — grounding, least collaborative effort.
- Roberts (1996) — Questions Under Discussion.
- Baarslag et al. (AAMAS 2019) — value-of-information-based preference
  elicitation during negotiation.
- Recent LLM-agent lines: clarifying-question agents and information-gain
  gating for when an agent should ask vs. act.

## PRs

| PR | Scope | Status |
| --- | --- | --- |
| #1455 | Core: checklist state + freeze/basis in graph, answerhood asks + admissibility, verdict law, budget (3, consult first draw), stance restructuring (protocol 23.0.0). Grew during dev testing: every-turn client-DM read (in-process only), decision options through the question block, consult binding fail-closed, failed-turn-is-not-a-decision, policy admits rather than manufactures asks. | merged `eaf898a4fd` |
| — | §7 item 5: answer → premise persistence | not started |
| — | §7 item 6: expiry-to-pass retirement | not started |
| — | UI: checklist bar, fact ledger | not started |

Known follow-ups from #1455: no deterministic resume tool on the negotiation
MCP surface (reopen boundary should come from the checklist — a new answer
scoring a previously-unknown dimension); external `respond` seats receive the
checklist but cannot return scores. Post-deploy operational: review dev
`negotiator_memories` — pre-basis-rule memories are circular-evidence bait.
