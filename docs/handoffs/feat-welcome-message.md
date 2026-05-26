---
trigger: "IND-249 — OpenClaw plugin: welcome message (first daily post-onboarding)"
type: feat
branch: feat/welcome-message
base-branch: dev
created: 2026-05-06
linear-issue: IND-249
---

## Related Files
- packages/openclaw-plugin/src/index.ts
- packages/openclaw-plugin/src/polling/onboarding/onboarding.status.ts
- packages/openclaw-plugin/src/polling/onboarding/onboarding.prompt.ts
- packages/openclaw-plugin/src/polling/daily-digest/daily-digest.poller.ts
- packages/openclaw-plugin/src/polling/ambient-discovery/ambient-discovery.poller.ts
- packages/openclaw-plugin/src/lib/delivery/main-agent.prompt.ts
- packages/openclaw-plugin/src/lib/delivery/main-agent.dispatcher.ts
- packages/openclaw-plugin/src/lib/delivery/config.ts
- packages/openclaw-plugin/src/lib/utils/connect-token.ts

## Relevant Docs
- docs/specs/2026-05-06-welcome-message-design.md

## Related Issues
- IND-249 OpenClaw plugin: welcome message (first daily post-onboarding) (Todo)
- IND-250 EdgeClaw: end-to-end onboarding and welcome flow (Todo) — parent
- IND-248 OpenClaw plugin: onboarding flow (Done) — dependency, merged
- IND-247 Seren's Telegram message formatting for all notification types (Todo) — related

## Scope
Design spec at `docs/specs/2026-05-06-welcome-message-design.md`. Summary:

Add a short-lived welcome watcher (`welcome.watcher.ts`) that starts alongside the onboarding dispatch in the plugin startup. It polls `isOnboardingComplete()` every 15s. When onboarding completes, it fetches pending opportunities (same endpoint as daily digest), builds candidates with connect tokens and URLs, dispatches a welcome-variant prompt to the main agent, writes `welcomeSent` to plugin config, and self-terminates.

New `'welcome'` content type in `main-agent.prompt.ts` — same payload shape as daily digest but framed as a post-onboarding welcome. Always fires regardless of candidate count (warm closing if empty).

Files: `welcome.watcher.ts` (new), `index.ts`, `main-agent.prompt.ts`, `config.ts`.
