---
title: "Negotiation"
type: domain
tags: [negotiation, bilateral, agents, opportunity, a2a, roles]
created: 2026-03-26
updated: 2026-03-26
---

# Negotiation

Negotiation is a bilateral agent-to-agent protocol that acts as a quality gate before opportunities are persisted. Two AI agents -- one representing each user -- debate whether a proposed match genuinely serves both parties. Only matches where both agents agree become opportunities visible to users.

This mechanism prevents the system from surfacing low-quality connections that passed the initial scoring threshold but would not withstand scrutiny from an advocate for each side.

---

## Why Negotiation Exists

The opportunity evaluator assigns scores based on profile and intent analysis, but it operates from a neutral third-party perspective. It cannot fully represent either user's interests. Negotiation adds an adversarial quality check: one agent argues for the match while the other critically evaluates whether it serves their user.

This catches failure modes that single-pass evaluation misses:
- Superficial keyword overlap without genuine alignment
- Vague matches that sound good but lack concrete mutual benefit
- Matches where one side benefits much more than the other

---

## Roles

### Proposer

The proposer agent argues FOR the match. On the first turn, it proposes the connection and explains why it would benefit both parties. On subsequent turns (after a counter from the responder), it addresses objections and either counters with updated reasoning, accepts the responder's position, or withdraws.

The proposer is instructed to be honest -- it should not hallucinate fit where there is none. If the evaluator's pre-screen score was low, the proposer should acknowledge weaknesses.

### Responder

The responder agent EVALUATES proposals and PROTECTS its user from poor matches. It critically assesses whether the match genuinely serves its user's intents. The responder is instructed to be skeptical: it should not accept just because the other agent is enthusiastic.

The responder looks for concrete intent alignment rather than vague overlap. If the proposer addressed previous objections well, the responder acknowledges it. If objections were not addressed, the responder rejects.

---

## Turn-Based Protocol

Negotiation proceeds in alternating turns:

### Actions

Each turn produces one of four actions:

| Action | When used |
|---|---|
| **propose** | First turn only. The proposer presents the match case. |
| **counter** | Either agent partially agrees but has specific objections. States what is missing or weak. |
| **accept** | The agent is convinced the match genuinely benefits their user. |
| **reject** | The agent concludes the match does not serve their user's needs. |

### Turn structure

Each turn produces a structured assessment:

- **fitScore** (0-100): The agent's independent assessment of match quality. This is the agent's own judgment, not an echo of the seed score.
- **reasoning**: Why the agent took this action
- **suggestedRoles**: What roles each user should play
  - `ownUser`: agent, patient, or peer
  - `otherUser`: agent, patient, or peer

### Flow

1. **Init**: A conversation and task are created in the A2A system to track the negotiation
2. **Proposer's turn**: The proposer presents the case (action: propose)
3. **Responder's turn**: The responder evaluates and responds (accept, reject, or counter)
4. **Alternation**: If the responder countered, the proposer responds; turns alternate until resolution
5. **Finalize**: When a terminal action occurs or the turn cap is reached, the outcome is computed

### Turn cap

Negotiations have a maximum turn limit (default: 6). If the cap is reached without accept or reject, the negotiation ends with no opportunity (the match is not persisted). The outcome records `reason: "turn_cap"` to distinguish this from explicit rejection.

---

## Outcome Determination

The finalization logic examines the negotiation history to determine the outcome:

- **Has opportunity**: The last action was "accept". The opportunity proceeds to persistence.
- **Rejected**: The last action was "reject". The match is discarded.
- **Turn cap**: The maximum turns were exhausted with the last action being "counter". No opportunity; the match is discarded.

### Final score

When an opportunity is produced, the final score is the average of all fit scores across the negotiation history. This smooths out the potentially varying assessments across turns.

### Agreed roles

When an opportunity is produced, the final roles are derived from the last two turns (the accept turn and the preceding turn). Each side's `suggestedRoles.ownUser` from their respective last turns becomes the agreed role for that user.

---

## Seed Assessment

Each negotiation begins with a seed assessment from the opportunity evaluator:

- **score**: The evaluator's initial score (0-100)
- **reasoning**: Why the evaluator thinks this is a match
- **valencyRole**: The evaluator's initial role suggestion

Both agents receive this seed assessment as context. They are instructed to use it as a starting point but form their own independent judgment.

---

## A2A Conversation Integration

Negotiations are tracked as A2A (Agent-to-Agent) conversations:

- A **conversation** is created with two agent participants (`agent:{userId}`)
- A **task** is created within the conversation with type "negotiation"
- Each turn is persisted as a **message** with the turn data in a DataPart (`kind: "data"`)
- When finalized, an **artifact** is created on the task containing the negotiation outcome

This integration means negotiation history is stored in the same conversation/message infrastructure used by the rest of the system, enabling future features like letting users review the reasoning that led to their opportunities.

---

## Relationship to Opportunity Persistence

Negotiation is the final gate before an opportunity is written to the database:

1. The opportunity evaluator identifies candidates with scores above threshold
2. Each qualifying candidate enters bilateral negotiation
3. Only candidates that produce an opportunity are persisted
4. The negotiation's agreed roles become the opportunity's actor roles
5. The negotiation's final score and reasoning inform the opportunity's interpretation

If negotiation is skipped or not available for a particular discovery path, the evaluator's assessment is used directly. But when negotiation is active, it has the final word on whether a match becomes a real opportunity.
