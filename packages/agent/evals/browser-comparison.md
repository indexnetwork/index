# Final hosted agent comparison — 2026-09-21

The original final `packages/agent` run handled human-answer resumption and
avoided an unsupported expertise claim seen in agentv2. It still made
questionable declines and asked an extra question. Its original replay was
slower, while the later staged latency recheck below met the speed target.
These observations do not establish that either implementation is more accurate
overall.

## Scope and setup

This comparison uses the saved agentv2 baseline and the final `packages/agent`
replay, including the owner's last creative-practice answer. All 45 owner/counterpart
intent pairs match between the two runs.

- Separate Frankfurt clone, isolated local Redis, API on port 3001, web on 3000.
- Five owner intents and the same ten counterpart intents; all other intents paused.
- Opportunities, negotiations, and agent conversations reset between implementations.
- Same default OpenRouter model order. Jev was not a mandatory gate.
- Counterparts resumed with the replay helper; owner intents resumed through T3.
- Agentv2 source unchanged. No final human connection approvals submitted.
- Baseline snapshot: 12:59:44 UTC. Final agent snapshot: 14:06:54 UTC.

The runs did not receive identical answers. Both received the owner's **Yes** to
balancing professional and creative practices. Only the final agent asked for a
creative category and received **Design, tech, or digital arts**. It also received
one explicitly simulated counterpart answer: interest in exploring LLM use in game
narration from a systems design perspective, without claiming existing
game-development expertise or committing to a project. That answer is test input,
not evidence about the real counterpart.

## Final results

Counts below cover the owner's five intents only.

| Observation | Agentv2 | Final `packages/agent` |
|---|---:|---:|
| Negotiations | 45 | 45 |
| Agreed | 3 | 2 |
| Declined | 41 | 43 |
| Waiting for a human answer | 1 | 0 |
| Total negotiation turns | 61 | 59 |
| Stalls recorded on the owner's intents | 1 | 3 |
| Questions asked of the owner | 1 | 2 |
| Median creation-to-first-turn time | 25.8 s | 33.2 s |
| Reading match: last human answer to agreement | About 31 s | About 34 s |

Agentv2's remaining negotiation was waiting for Vicky's principal on the
specialist-seeking intent. The final agent had no pending owner questions and no
waiting negotiations. Its two agreements were reading/Vicky and exploratory LLM
narration/Oshyan; both remained pending human connection approval.

Agreement and decline counts are not accuracy scores. The cohort contained many
unrelated matches, and the final agent's additional answers affect comparability.

## Matched negotiation outcomes

| Pair | Agentv2 | Final `packages/agent` |
|---|---|---|
| Reading / Vicky | Agreed in four turns after one owner question about professional and creative practice. | Agreed in four turns after that question plus a creative-category follow-up. |
| Exploratory LLM narration / Oshyan | Agreed in two turns, accepting the opening proposal. | Agreed in four turns after clarifying that an exploratory discussion did not require a predetermined architecture challenge or project commitment. No simulated answer was needed. |
| Storytelling specialists / Oshyan | Agreed in four turns after Oshyan's negotiation agent asserted unsupported LLM/interactive-framework experience. | Asked Oshyan's principal; resumed on the labelled simulated answer, then declined in three turns. The decline remains questionable because not claiming expertise does not establish its absence. |
| Storytelling specialists / Vicky | Still waiting after three turns; the owner's negotiation agent described the owner as building storytelling systems without supporting human evidence. | Declined in one turn on relevance grounds. This resolved the negotiation, but does not by itself establish a correct rejection. |
| Exploratory LLM narration / Vicky | Declined in one turn for insufficient alignment. | Declined in one turn, adding a requirement to meet game developers, narrative designers, and AI researchers that this exploratory intent did not state. |

## Principal and negotiation agent quality

**Grounding:** agentv2's negotiation agent claimed that Oshyan applied generative
systems and LLMs to interactive frameworks, although neither his intent nor a
human answer established that expertise. It also turned the owner's goal of
meeting storytelling practitioners into a claim that the owner builds such
systems. The final agent avoided those claims in the reviewed cases and preserved
an exploratory framing for the LLM/Oshyan agreement.

The final agent still mishandled missing evidence. After the simulated answer
said it was not claiming game-development expertise, the negotiation agent stated
that Oshyan did not specialize in the field. It also introduced specialist-role
requirements when declining the broad LLM/Vicky pair. The specialist-seeking
intent contains those roles; the exploratory intent does not.

**Questions:** both principal agents asked about the requirement to balance
professional and creative practices. The final agent additionally asked which creative category
the owner pursued. That followed a counterpart request for detail, but whether
it was necessary to decide if the principals should meet remains uncertain.
More stalls and questions do not automatically mean better decisions.

**Answer resumption:** both implementations persisted the owner's answers,
cleared the corresponding questions, and resumed negotiation. In the final run,
the creative-category answer updated the principal agent's brief after 11.6
seconds; the negotiation agent proposed again after 25.6 seconds; agreement was
recorded after 34.1 seconds. The simulated counterpart answer also resumed its
negotiation, producing a new turn after 22.5 seconds. That verifies the event and
resumption path, not the correctness of the subsequent decline.

The final reading acceptance said “My principal agrees” without a new human
approval. The persisted opportunity correctly remained pending human review,
but the negotiation agent's wording blurred that distinction.

## Speed and frontend observations

### Original browser/API replay

The original final-agent replay's median creation-to-first-turn time was 33.2
seconds versus 25.8 seconds for agentv2. These elapsed times included
scheduling, host reads, briefing, reasoning, and any human wait before the
first turn. Activation order varied, and some live regression calls overlapped
the final replay. The baseline's failed startup requests were excluded after
correcting Redis isolation and a stale inherited model credential.

### Staged latency recheck after host batching

After the original comparison, the hosted runtime was changed to group one
Redis read by owner, dispatch owners concurrently, and check the selected
external negotiator once per owner batch. Events for the same owner still reach
that owner's runner in stream order.

The approved Frankfurt clone was reset. Ten counterpart signals were made
active while the API was stopped, their setup events were cleared from the
isolated Redis instance, and the API was started through its normal `bun run
dev` command. The owner's five signals then resumed one at a time through the
same service path as the status endpoint. This produced 45 owner negotiations:
43 took a first turn and two stalled before advancing because Vicky's
professional-and-creative-practice requirement lacked a principal answer.

| Metric | Agentv2 saved baseline | Patched `packages/agent` staged replay |
|---|---:|---:|
| Owner negotiations | 45 | 45 |
| Negotiations with a first turn | 45 | 43 |
| Grounded stalls before a first turn | 0 | 2 |
| Median creation-to-first-turn time | 25.8 s | **23.18 s** |
| p90 creation-to-first-turn time | not retained | 30.26 s |
| Slowest creation-to-first-turn time | 34.85 s | 33.06 s |

The staged replay is 2.62 seconds (about 10%) below the saved agentv2 median.
It establishes that the current package clears the target on this cohort, but
it is not a strict paired A/B result: OpenRouter routing, calendar time, and
activation cadence differed. It is evidence for the host scheduling change,
not proof that all of the difference came from it.

Both implementations exposed internal Brief, Decision, and Stall bookkeeping in
the principal conversation. The final agent also showed these issues:

- The principal agent reported that all LLM matches had been declined even though
  the Oshyan agreement was already recorded.
- During the reading stall, Radar showed Waiting and zero Needs you while a
  question was pending in the principal conversation.
- The agreement card described the owner's “work” in LLM narration even though
  the intent only expressed interest in exploring it.
- The narrow T3 viewport intermittently left the principal-agent drawer off-screen
  despite its open state.

The API and T3 frontend verified the main replay, answer submission, and the
expanded exploratory-agreement transcript. T3 automation was unavailable for the
owner's final answer follow-up; that result was verified from the successful API
answer-handler log and persisted messages, questions, and negotiation records.
No fresh visual verification of that final agreement is claimed.

## Evidence

These are local test artifacts, not committed fixtures. Only the baseline and
final run are used in this comparison.

| Evidence | Agentv2 | Final `packages/agent` |
|---|---|---|
| Persisted records | [Baseline snapshot](/private/tmp/agentv2-baseline-data.json) | [Final snapshot after the owner's answer](/private/tmp/agent-quality-answer-data.json) |
| Counts and negotiation transcripts | [Baseline summary](/private/tmp/agentv2-baseline-summary.json) | [Final summary](/private/tmp/agent-quality-answer-summary.json) |
| Browser/API observations | [Baseline browser evidence](/private/tmp/agentv2-browser-baseline.json) | [Final replay browser evidence](/private/tmp/agent-quality-browser-evidence.json) |
| Simulated counterpart input | None | [Labelled answer](/private/tmp/agent-quality-simulated-answer.json) |
| Staged latency recheck | [Saved baseline timing above](/private/tmp/agentv2-baseline-summary.json) | [Patched replay snapshot](/private/tmp/agent-speed-after-data.json), [summary](/private/tmp/agent-speed-after-summary.json) |
