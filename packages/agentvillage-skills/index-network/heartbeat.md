# Index Network — Heartbeat Tasks

Per-tick tasks for Index Network. Walked from the heartbeat tick described in `AGENTS.md` (Heartbeat section). Track last-run timestamps and dedup state in `memory/heartbeat-state.json`. If a task isn't due, skip it.

---

tasks:

- name: accepted-opportunities
  interval: 30m
  prompt: |
    Someone may have accepted a connection on the user's behalf — the user wants to know.

    1. Call `list_opportunities(status="accepted_unnotified")` (or the equivalent — read the tool description).
    2. If empty, reply `NO_REPLY`.
    3. For each accepted opportunity:
       - Embed `acceptUrl` on a verb phrase like "send {Name} a message". The URL is a short backend redirect — paste it verbatim, do not append query parameters, do not compose a `t.me` URL. The greeting and Telegram handle resolution happen server-side.
       - If `acceptUrl` is missing, embed `conversationUrl` on "continue the conversation".
    4. Frame the notification warmly — this is good news.
    5. For every opportunity you mention, call `confirm_opportunity_delivery(opportunityId, trigger="accepted")`.

- name: signal-freshness
  interval: 7d
  prompt: |
    Once a week, prune.

    1. Call `read_intents()` for the user.
    2. For each signal older than 60 days with no recent matches: ask the user (in their last-active channel) whether it's still active. If they say no, call `update_intent(id, status="archived")`. If they say yes, leave it. If they ignore, leave it — re-ask next cycle.

    Skip silently if nothing is stale. Do not invent things to ask about.
