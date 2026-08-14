---
title: "Chat sessions"
type: domain
tags: [chat, conversations]
---

# Chat sessions

A **conversation** identifies the people or agents allowed to communicate. A
**conversation session** is a bounded chronological section within that conversation.

Sessions make long-lived chats readable without changing participants, unread policy,
or A2A task privacy. H2A and H2H sessions follow a 24-hour inactivity boundary by
default; each A2A task run is its own session. Opening a chat shows its newest session;
people may explicitly load older sessions one at a time.

Question cards shown in a chat are canonical pending questions, not text supplied by an
agent. They belong to a recipient and conversation, and, after persistence, are
anchored to the assistant message and chat session that produced them.

## Stable sessions and scope keys

Some sessions are **stable**: one per user per subject, resolved get-or-create rather
than created per visit. The `chat_session_scopes` table keys them, and its
`(user_id, scope_type, scope_id)` unique index is what makes resolution race-safe —
concurrent creates lose with a unique violation and the caller re-reads.

`scope_type` is a registry key, not the `ChatScopeType` (`network` | `intent`) envelope
a session presents to clients. Personas that need their own stable session for the same
subject get their own key, so they never collide:

| `scope_type` | `scope_id` | Session |
|---|---|---|
| `intent` | intent id | Orchestrator's intent session |
| `signal-intent` | intent id | Signal Agent's canonical intent session |
| `negotiator-intent` | intent id | Negotiator session pinned to that intent |

### The negotiator is reachable only through an intent

The negotiator has exactly one chat surface: the intent-pinned session
(`negotiator-intent`, one per user+intent). It presents as an ordinary intent-scoped
session — conversation metadata still says scope type `intent` — so graph seeding and
session load behave like any other intent chat.

An unscoped negotiator DM (`scope_type='persona'`, `scope_id='negotiator'`) used to
exist alongside it: same persona, same tools, same prompt, differing only in the scope
row. It was removed. Opening a negotiator session now requires an intent, and
`POST /chat/negotiator/session` rejects a request without `intentId` rather than
falling back to an unscoped thread. Conversations created under the old key are left
in place — their history is preserved and readable by id; only the entry points are
gone.
