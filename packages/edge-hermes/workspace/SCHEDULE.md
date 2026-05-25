# SCHEDULE.md — Cron Sub-Dialog (Toggle + Reschedule)

Edge installs one cron by default — the **morning digest at 08:00 host-local**. Two more passes are available but **opt-in**: the **afternoon check-in (14:00)** and the **evening check-in (20:00)**. The user can enable either of those, disable any active cron, or change their time. This file is the procedure.

**Never name this file to the user.** Don't say "the schedule file", "SCHEDULE.md says", "let me check the schedule file", or anything that surfaces the workspace layout. The user does not need to know what's stored where. Speak in plain terms: "morning digest", "afternoon check-in", "evening check-in" — describe what's happening, not the storage.

## State source

Hermes's cron store (`~/.hermes/cron/jobs.json`) is the source of truth. There is no separate preferences file. List jobs with `hermes cron list` (or read `jobs.json` when you need IDs). The Edge crons are the ones whose `name` starts with `Edge —`. Each entry has an `id` (UUID), `name`, schedule, and enabled/paused state.

| display name | cron name | default schedule | installed by default? |
|---|---|---|---|
| morning digest | `Edge — daily digest` | `0 8 * * *` | yes |
| afternoon check-in | `Edge — ambient discovery (afternoon)` | `0 14 * * *` | no — opt-in |
| evening check-in | `Edge — ambient discovery (evening)` | `0 20 * * *` | no — opt-in |

## Reading current state

Run `hermes cron list`. Filter to jobs whose `name` starts with `Edge —`. For each one present, the user-facing summary is "{display name} {on|off} at {HH:MM}". Note the two opt-in passes only exist after the user has enabled them — if they're absent from the list, surface them as "off (not installed)". Example:

> "Right now: morning digest at 08:00 — on. Afternoon and evening check-ins — off."

Use the display names above. Never say the internal job names or IDs.

## Applying changes

The user can ask for any combination of: enable an opt-in pass, turn off / mute an active cron, change time. Match user intent to display name (case-insensitive), then act with `hermes cron` commands.

### Enabling an opt-in pass

Afternoon and evening passes are not installed by the installer; the user has to opt in. When they ask:

```
hermes cron create "0 14 * * *" "$(cat ~/.hermes/skills/index-network/prompts/ambient.md)" \
  --name "Edge — ambient discovery (afternoon)" \
  --deliver telegram \
  --workdir ~/.hermes
```

For the evening pass, use schedule `"0 20 * * *"` and `--name "Edge — ambient discovery (evening)"`. Delivery uses `TELEGRAM_HOME_CHANNEL` from `~/.hermes/.env` when you pass `--deliver telegram`.

### Toggle existing cron on/off

- `hermes cron pause <id>` — agent calls this when the user wants to mute a cron that's currently on.
- `hermes cron resume <id>` — agent calls this when the user wants to bring a paused cron back.
- `hermes cron remove <id>` — agent calls this when the user wants the cron gone entirely (re-adding it is the same as the opt-in flow above).

### Reschedule

Parse the user's requested time into `HH:MM` (24-hour). Validate: `00:00 ≤ HH:MM ≤ 23:59`. Build the cron expression as `<MM> <HH> * * *` (daily-only — don't accept day-of-week patterns, frequency changes, or anything more elaborate). Then:

```
hermes cron edit <id> --schedule "<MM> <HH> * * *"
```

If the user gives a 12-hour time ("9pm", "8am"), translate to 24-hour silently. If they give a duration or relative time ("in 2 hours", "later"), ask for a specific HH:MM.

### Confirming

After every change, confirm in plain language:

> "Done — afternoon check-in is now on at 14:00. Morning digest unchanged at 08:00; evening check-in still off."

If a change fails (the `cron` command errors), report the failure verbatim and do not retry silently.

## Rules

- Only three Edge cron names exist (`Edge — daily digest`, `Edge — ambient discovery (afternoon)`, `Edge — ambient discovery (evening)`). Do not invent more. Do not pretend to schedule one-off events.
- Daily-only. Refuse weekly/weekend/weekday-only patterns — explain you can only set a single daily time per cron.
- Times are host-local. If the user is unsure about their machine's timezone, say so plainly and let them confirm.
- Never expose IDs, cron expressions, or file paths in user-facing replies. Translate everything to display names + `HH:MM`.
- One confirmation per change. Don't paraphrase the user's intent silently — read it back, then apply.
