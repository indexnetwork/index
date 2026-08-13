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

## Personas

Every H2A chat session is driven by a named **persona**, recorded on
`conversations.persona`. There is no default: each surface names the persona it
starts, and unknown values fail closed.

| Persona | Surface |
| --- | --- |
| `signal` | Main web chat — the primary product persona |
| `reporter` | Read-only agent-reporting surface (web only) |
| `onboarding` | Session-only onboarding route, while onboarding is incomplete |
| `negotiator` | The pinned Personal Agent DM, and the macOS agent chat |

Two values are not chat personas. `telegram` marks a Telegram notification
transcript — nothing drives a turn in it. `orchestrator` is the retired
pre-personafication default: those sessions stay readable and listable, but a new
turn is refused with `WEB_SIGNAL_SESSION_REQUIRED` and the product offers a fresh
Signal chat instead of rewriting history.

Intent-scoped sessions are keyed per persona in `chat_session_scopes` as
`<persona>-intent`, so two personas can hold distinct sessions for the same
signal. The bare `intent` key is retired and belongs to orchestrator rows.
