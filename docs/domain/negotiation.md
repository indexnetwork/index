# Negotiation

Each opportunity has one NegotiationGraph task and A2A thread. A negotiator
turn may send `outreach`, `counter`, or `question`, or pause with one of the
graph-owned reasons. It never accepts, rejects, or consults a principal
directly.

`needs_principal` and `ready_for_verdict` pauses return to the owning
PersonalAgent's intent-scoped reflect turn. The PersonalAgent asks its
principal in the signal DM, then either re-kicks, promotes the opportunity to
`pending`, or rejects it. Owner acceptance remains a separate user action.

The host invokes one shared AgentGraph and one shared NegotiationGraph. Task
state is `working`, `paused`, or terminal; the retired questioner,
`input_required`, and continuation lifecycle do not exist.

See [the graph design plan](../plans/2026-08-23-personal-agent-and-negotiation-graphs.md)
for the full cycle and pause semantics.
