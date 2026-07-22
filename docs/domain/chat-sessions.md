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
