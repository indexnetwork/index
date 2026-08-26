---
title: "Opportunity notifications"
type: design
tags: [notifications, redis, email, telegram, digest]
created: 2026-05-07
updated: 2026-08-26
---

# Opportunity notifications

`OpportunityNotifier` (`services/api/src/lib/notification/opportunity-notifier.ts`) delivers opportunity notifications in-process. Call `notifyOpportunity(opportunityId, recipientId, priority)`.

## Priority Tiers

| Priority | Delivery path |
|----------|----------------|
| `immediate` | WebSocket emit via `emitOpportunityNotification` |
| `high` | Email via `executeSendEmail` |
| `low` | Weekly digest Redis list |

## Email Delivery (`high` priority)

1. Loads the recipient via `userService.getUserForNewsletter`.
2. Skips if there is no email, onboarding is incomplete, or `prefs.connectionUpdates = false`.
3. Sets a Redis deduplication key (`email:opportunity:dedupe:{userId}:{opportunityId}`) with `NX` and a 7-day TTL.
4. Sends the email.

## Weekly Digest (`low` priority)

Adds the opportunity id to `digest:opportunities:{userId}` after a matching Redis dedupe key. Telegram delivery is independent of priority when the user has `opportunityAccepted` enabled.
