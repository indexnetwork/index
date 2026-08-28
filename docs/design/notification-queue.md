---
title: "Notification Queue"
type: design
tags: [notifications, redis, email, telegram, digest]
created: 2026-05-07
updated: 2026-08-28
---

# Notification Queue

`NotificationQueue` (`services/api/src/queues/notification.queue.ts`) delivers opportunity notifications to users. `queueOpportunityNotification` triggers delivery fire-and-forget via `background()`, with up to 3 retries (exponential backoff) — the only retry site left in the codebase, since a failed delivery here has no reconciler behind it.

---

## Priority Tiers

Every opportunity notification is enqueued with one of two priority levels:

| Priority | Delivery path |
|----------|---------------|
| `immediate` | WebSocket emit via `emitOpportunityNotification` |
| `high` | Email sent directly via `executeSendEmail` |

Callers set priority at enqueue time based on their dispatch path.

---

## Email Delivery (`high` priority)

Before enqueuing an email, the handler:

1. Loads the recipient's profile via `userService.getUserForNewsletter`.
2. Skips delivery if the user has no email address, has not completed onboarding, or has `prefs.connectionUpdates = false`.
3. Sets a Redis deduplication key (`email:opportunity:dedupe:{userId}:{opportunityId}`) with `NX` and a 7-day TTL. If the key already exists the email is silently dropped — one email per opportunity per user per week.
4. Sends the email directly via `executeSendEmail`.

---

## Telegram Delivery

Telegram notifications run **after** the priority switch, independently of the tier. This means a single opportunity notification job may trigger both an email (or digest entry) and a Telegram message.

The handler:
1. Loads the user's Telegram preferences via `getTelegramPrefs(recipientId)`.
2. Checks `telegramPrefs.notifications.opportunityAccepted` — if false, skips.
3. Emits via `emitTelegramNotification` with a link button to the opportunity URL.

This independence is intentional: a user can receive an email for high-priority matches while also getting a real-time Telegram ping. The two channels are not mutually exclusive.

---

## Singleton

The module exports a `notificationQueue` singleton and a `queueOpportunityNotification` convenience wrapper, callable from anywhere without any startup step.
