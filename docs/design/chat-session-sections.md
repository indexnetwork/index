---
title: "Durable chat session sections"
type: design
tags: [chat, conversations, privacy]
---

# Durable chat session sections

`conversations` remain the durable container for H2A, H2H, and A2A traffic. The
`conversation_sessions` sidecar divides their timeline into display and context
sections. Every persisted `messages` row is stamped with `session_id` server-side.

- A2A maps one session to one `tasks` row.
- H2A and H2H open a new session only when the next write is strictly later than
  `CHAT_SESSION_GAP_MS` (24 hours by default) after the active session's last
  message.
- Transaction-scoped advisory locking serializes writers per conversation, so
  concurrent first writes cannot create two active sections.
- The backfill migration orders immutable history by `(created_at, id)`, uses the
  same gap rule for non-task messages, and maps task messages one-to-one.

History endpoints return the latest section first. A previous-session cursor is
opaque and retrieves exactly one section per request. Earlier sections are display
state only; send/continue operations always rebuild context from the database.

## Model context

Chat graph context uses a dedicated latest-N query: messages are selected descending
by `(createdAt, id)`, limited, and reversed before being passed to the model. The
query is scoped to the active durable section and does not use UI pagination. This
keeps historical loading from expanding or reordering the model context window.

## In-chat questions

A streamed `user_question` event contains only canonical question IDs. The web client
resolves cards through a recipient- and conversation-scoped pending-question read;
model-authored text never becomes a rendered question. When the assistant message is
persisted, chat questions are stamped with its message ID and durable session ID for
reload anchoring. Pool-discovery rows remain excluded from this path.
