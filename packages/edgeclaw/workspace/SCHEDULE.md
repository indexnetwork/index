# SCHEDULE.md — Cron Sub-Dialog (Toggle + Reschedule)

EdgeClaw runs three crons by default — morning digest (08:00), afternoon ambient pass (14:00), evening ambient pass (20:00), all host-local. The user can turn any of them off or move them to a different time. This file is the procedure.

**Never name this file to the user.** Don't say "the schedule file", "SCHEDULE.md says", "let me check the schedule file", or anything that surfaces the workspace layout. The user does not need to know what's stored where. Speak in plain terms: "morning digest", "afternoon check-in", "evening check-in" — describe what's happening, not the storage.

## State source

OpenClaw's cron list is the source of truth. There is no separate preferences file. List jobs with `openclaw cron list --json`; the EdgeClaw crons are the three whose `name` starts with `EdgeClaw —`. Each entry has an `id` (UUID), `name`, `cron` expression, and `enabled` flag.

| display name | cron name | default schedule |
|---|---|---|
| morning digest | `EdgeClaw — daily digest` | `0 8 * * *` |
| afternoon check-in | `EdgeClaw — ambient discovery (afternoon)` | `0 14 * * *` |
| evening check-in | `EdgeClaw — ambient discovery (evening)` | `0 20 * * *` |

## Reading current state

Run `openclaw cron list --json`. Filter to jobs whose `name` starts with `EdgeClaw —`. For each one, the user-facing summary is "{display name} {on|off} at {HH:MM}" — translate the cron expression's `minute hour` fields into `HH:MM` (zero-padded, host-local). Surface plainly:

> "Right now: morning digest at 08:00, afternoon check-in at 14:00, evening check-in at 20:00 — all on."

Use the display names above. Never say the internal job names or IDs.

## Applying changes

The user can ask for any combination of: turn on/off, change time. Match user intent to job names by display name (case-insensitive), then act with `openclaw cron` commands.

### Toggle on/off

- `openclaw cron disable <id>` — agent calls this when the user wants to mute a cron.
- `openclaw cron enable <id>` — agent calls this when the user wants to bring one back.

### Reschedule

Parse the user's requested time into `HH:MM` (24-hour). Validate: `00:00 ≤ HH:MM ≤ 23:59`. Build the cron expression as `<MM> <HH> * * *` (daily-only — don't accept day-of-week patterns, frequency changes, or anything more elaborate). Then:

```
openclaw cron edit <id> --cron "<MM> <HH> * * *"
```

If the user gives a 12-hour time ("9pm", "8am"), translate to 24-hour silently. If they give a duration or relative time ("in 2 hours", "later"), ask for a specific HH:MM.

### Confirming

After every change, confirm in plain language:

> "Done — evening check-in is now at 21:45. Morning digest and afternoon check-in unchanged at 08:00 and 14:00."

If a change fails (the `cron` command errors), report the failure verbatim and do not retry silently.

## Rules

- Three crons exist. Do not invent more. Do not pretend to schedule one-off events; reschedule only the three known crons.
- Daily-only. Refuse weekly/weekend/weekday-only patterns — explain you can only set a single daily time per cron.
- Times are host-local. If the user is unsure about their machine's timezone, say so plainly and let them confirm.
- Never expose IDs, cron expressions, or file paths in user-facing replies. Translate everything to display names + `HH:MM`.
- One confirmation per change. Don't paraphrase the user's intent silently — read it back, then apply.
