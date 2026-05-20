# Schedule — Cron On/Off Sub-Dialog

Used from `bootstrap.md` Step 7 (during onboarding) and at any time the user later asks about turning off, enabling, or muting any cron. EdgeClaw cron *times* are not user-configurable today; only on/off per cron.

## State

Preferences live at `memory/cron-preferences.json` in the agent workspace. Shape:

```json
{
  "digest": true,
  "ambientAfternoon": true,
  "ambientEvening": true
}
```

If the file is missing, malformed, or a key is absent, treat that cron as **enabled** (`true`). The three valid keys map to the cron jobs installed by the EdgeClaw installer:

| key | cron name | schedule |
|---|---|---|
| `digest` | `EdgeClaw — daily digest` | `0 8 * * *` |
| `ambientAfternoon` | `EdgeClaw — ambient discovery (afternoon)` | `0 14 * * *` |
| `ambientEvening` | `EdgeClaw — ambient discovery (evening)` | `0 20 * * *` |

Any other key is ignored and not writable.

## Procedure

### Reading current state

Try to read `memory/cron-preferences.json`. Treat missing file or malformed JSON as `{}` (all three default to enabled). Surface plainly:

> "Right now: digest on, afternoon check-in on, evening check-in on."

Match the user's framing — say "digest" / "afternoon check-in" / "evening check-in", never the JSON key names.

### Applying a change

1. Parse the user's intent into one or more `{key: boolean}` deltas. The three valid keys are `digest`, `ambientAfternoon`, `ambientEvening`. If they ask about something that does not map (e.g. "turn off notifications"), ask one short clarifying question: *"Which one — the morning digest, the afternoon check-in, or the evening one?"*
2. Read the existing `memory/cron-preferences.json` (or start from `{}` if absent / malformed).
3. Merge in the deltas. Keep the three known keys; ignore anything else already in the file.
4. Write the file back as JSON, two-space indented, all three known keys present (fill in defaults for any not yet set so the file is always complete after a write):
   ```json
   {
     "digest": true,
     "ambientAfternoon": false,
     "ambientEvening": true
   }
   ```
5. Confirm in plain language what changed and what stays:

   > "Done — afternoon check-in is off. Digest and evening check-in still on."

### Rules

- Only the three known keys are writable. Do not invent fields.
- Always confirm after applying. Never paraphrase intent silently.
- If the user asks to change the *time* of any cron (e.g. "move digest to 9am"), explain plainly:

  > "I can only turn each one on or off today — I can't change the times. Digest fires at 8am, check-ins at 2pm and 8pm. Want me to turn any of them off?"

  Do not promise time changes; do not pretend to schedule something else.
- If the file write fails, report the error verbatim and do not retry.
