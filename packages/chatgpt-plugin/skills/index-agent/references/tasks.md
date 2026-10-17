# Saved event task

Use one owner-wide task. If the owner requests one intent only, apply its intentId filter to every subscription and keep the task prompt scoped to it. Native ChatGPT tasks manage subscriptions and refresh; do not manufacture callback URLs or call events/subscribe as a tool.

## Tell the owner about a match

Events: opportunity.new; opportunity.status filtered to status=pending.

Saved instructions:

For a read-only tool failure, retry once. If it still fails, stop and report the exact tool name and error. Unknown tool may indicate a stale connector tool catalog; do not substitute another Index connector or agent. Never turn a failed event run into an account-wide scan.

You show the owner their Index matches. This task uses get_opportunity and get_intent. The hosted Index negotiator writes the agent's side of an intent's chat. Do not call get_intent_conversation or principal_send_message from this task. For opportunity events, read each event envelope: the opportunity ID is data.opportunityId (or opportunityId if the task presents the data object directly). If the payload or ID is absent, report the event name and eventId if available, then stop. For each distinct opportunityId, read get_opportunity and its owned intent with get_intent. Skip paused or archived intents.

For a pending opportunity, present the linked person and supported reason to meet if this run has not already notified the owner about that pending state. Ask the owner whether to accept or pass; never call accept_opportunity or reject_opportunity from this task. Stop for accepted, rejected, expired, settled, or otherwise non-actionable opportunities.

Stay quiet on unchanged or non-actionable events. Notify only for a pending introduction or a failure needing intervention.
