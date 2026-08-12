---
title: "Welcome Message (First Post-Onboarding Notification)"
type: spec
tags: [openclaw-plugin, welcome, onboarding, delivery]
created: 2026-05-06
updated: 2026-05-06
---

# Welcome Message — Design Spec

**Linear issue:** IND-249
**Depends on:** IND-248 (onboarding guard — merged)
**Related:** IND-247 (Seren's formatting — applies to welcome prompt)

## Problem

> **Superseded (2026-08-07):** This historical foreground-discovery design is replaced by background-only discovery; see [background-only discovery release 1](../rollout/background-only-discovery-release-1.md).

After the user completes onboarding, there is no immediate follow-up message. The user calls `complete_onboarding()`, the onboarding subagent says "You're all set," and then silence until the next scheduled ambient or daily digest pass fires. The first intent is already captured during onboarding (Step 3), and `discover_opportunities` runs at Step 4 — pending opportunities may already exist. The system should deliver a welcome message immediately, framing those initial results.

## Solution

Add a **short-lived welcome watcher** that starts alongside the onboarding dispatch and polls `isOnboardingComplete()` every 15 seconds. The moment onboarding completes, it fetches pending opportunities, builds a welcome-variant prompt with connect links, dispatches it to the main agent, writes `welcomeSent` to plugin config, and self-terminates. No coupling to the ambient or daily digest pollers.

## Design

### Welcome Watcher

A new module `packages/openclaw-plugin/src/polling/welcome/welcome.watcher.ts` that exports a `start()` function.

**Lifecycle:**

1. Called from `register()` in `index.ts`, right after `dispatchOnboardingIfNeeded()`.
2. On start, checks `readWelcomeSent(api)` — if already true, returns immediately (no-op).
3. Sets a `setInterval` at 15s that:
   - Calls `isOnboardingComplete(api, config)`
   - If false → no-op, wait for next tick
   - If true → dispatch welcome, write `welcomeSent`, clear interval
4. Self-terminates after successful dispatch or if `welcomeSent` is found true on any tick.

**Integration in `index.ts`:**

```typescript
// After the onboarding dispatch (line ~303-305)
setTimeout(() => {
  dispatchOnboardingIfNeeded(api, { baseUrl, agentId, apiKey });
  welcomeWatcher.start(api, { baseUrl, agentId, apiKey, frontendUrl });
}, 5_000).unref();
```

### Welcome Dispatch Logic

When the watcher detects onboarding completion:

1. Fetch pending opportunities via `GET /api/agents/:agentId/opportunities/pending?limit=20` (same endpoint as daily digest)
2. For each opportunity with a `counterpartUserId`, fetch a connect token via `POST /api/opportunities/:id/connect-token`
3. Build `OpportunityCandidate[]` with `profileUrl` and `acceptUrl` (same shape as daily digest)
4. Build prompt with content type `'welcome'` via `buildMainAgentPrompt()`
5. Dispatch to main agent via `dispatchToMainAgent()`
6. On successful dispatch, write `welcomeSent = true` to plugin config

**Candidates may be empty.** The welcome always fires regardless of candidate count.

### New Content Type: `welcome`

Add `'welcome'` to `MainAgentContentType` and `MainAgentPayload` in `main-agent.prompt.ts`.

**Payload shape:** `{ contentType: 'welcome', candidates: OpportunityCandidate[] }`. The candidates array may be empty.

**Prompt instructions (`perTypeInstruction`):**

- Frame as the first message after onboarding — "here's what I found based on what you just told me."
- If candidates exist: render as numbered list (same URL/link rules as daily digest). Each mentioned opportunity requires `confirm_opportunity_delivery` with `trigger: 'welcome'`.
- If no candidates: warm closing — acknowledge that nothing was found yet, but the system is actively looking. No empty-list awkwardness.
- Always fires regardless of candidate count.

### State: `welcomeSent` in Plugin Config

- Key: `welcomeSent` in `api.pluginConfig`
- Type: boolean
- Written once after successful welcome dispatch
- Read by the welcome watcher on each tick
- Persistent across plugin restarts (plugin config is on disk)
- One-way: once true, never reset

### `readWelcomeSent` / `writeWelcomeSent` Helpers

Add to `config.ts`:

- `readWelcomeSent(api): boolean` — reads `api.pluginConfig['welcomeSent']`, returns `false` if absent
- `writeWelcomeSent(api): void` — sets `api.pluginConfig['welcomeSent'] = true`

## Files Touched

| File | Change |
|------|--------|
| `packages/openclaw-plugin/src/polling/welcome/welcome.watcher.ts` | New module — short-lived watcher that detects onboarding completion and dispatches welcome |
| `packages/openclaw-plugin/src/index.ts` | Start welcome watcher alongside onboarding dispatch |
| `packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts` | Add `'welcome'` to `MainAgentContentType`, `MainAgentPayload`, and `perTypeInstruction` |
| `packages/openclaw-plugin/src/lib/delivery/config.ts` | Add `readWelcomeSent` / `writeWelcomeSent` helpers |

## Tests

| Test | Assertion |
|------|-----------|
| Welcome fires when onboarding complete + welcomeSent false | Dispatch called with content type `'welcome'`, `welcomeSent` written to config, interval cleared |
| Welcome skipped when welcomeSent already true | Watcher returns immediately, no interval started |
| Watcher waits while onboarding incomplete | Multiple ticks pass with no dispatch, dispatch fires on first complete tick |
| Welcome dispatches with zero candidates | Prompt built with empty candidates array, dispatch still fires |
| Welcome dispatches with candidates | Same `OpportunityCandidate[]` shape as daily digest, connect tokens fetched |
| Watcher self-terminates after dispatch | Interval cleared, no further ticks |
