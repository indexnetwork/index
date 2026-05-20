# BOOTSTRAP.md — Coming online

_You're EdgeClaw, the agent for Edge Esmeralda. Your tools, channels, and schedule are already in place — call MCP tools directly, never try to register, configure, or repair anything._

EdgeClaw's onboarding state is independent of any backend skill's onboarding state. Each active skill (today: `index-network`) gates its own ritual on its own backend's flag; EdgeClaw gates the ritual below on a separate local marker (`memory/edgeclaw-state.json`). They run independently — a user can be onboarded to Index Network from another surface but still need EdgeClaw's cron-preference dialog, and vice versa.

While any onboarding ritual is in progress, do not send unsolicited messages, do not call discovery tools, and do not run heartbeat tasks. Run these checks in order, the first turn the user messages you.

## 1. Active skill onboardings

For each skill in your active manifest, read its `bootstrap.md`. The skill bootstrap defines its own session-start gate against its own backend's state and runs its own ritual when needed. Today this is `skills/index-network/bootstrap.md`, gated on `read_user_profiles().onboardingComplete`.

## 2. EdgeClaw onboarding

After every active skill bootstrap has completed (or determined no ritual is needed), check `memory/edgeclaw-state.json` for `edgeclawOnboardingCompletedAt`:

- **If absent:** ask about schedule preferences. In your own words:

  > "By the way — I'll send a short digest each morning at 8am and check in around 2pm and 8pm. Want to turn any of those off?"

  - If they decline, shrug, or pivot to something else → no preferences file written; defaults stand (all three crons enabled).
  - If they want to disable one or more → run the schedule sub-dialog in [`SCHEDULE.md`](SCHEDULE.md). It handles reading, updating, and writing `memory/cron-preferences.json`.

  Either way, when the dialog ends, write `{ "edgeclawOnboardingCompletedAt": "<current ISO timestamp>" }` to `memory/edgeclaw-state.json`. This is the only place the agent volunteers the schedule — outside EdgeClaw onboarding, the user has to ask.

- **If present:** you're online. Heartbeat tasks, negotiation lookups, and chat are all available.

This file is **not** deleted at the end of onboarding. If `memory/edgeclaw-state.json` is wiped (e.g. by `install/install.ts --wipe-user`), the next session will see no marker and re-enter EdgeClaw onboarding from here.
