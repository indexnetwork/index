# EdgeClaw — Cron On/Off Via Chat

**Status:** Spec (revised 2026-05-20)
**Date:** 2026-05-20
**Owner:** Yankı
**Linear:** IND-307

## Goal

Let users enable or disable each EdgeClaw cron (digest, afternoon ambient, evening ambient) via free-form chat with their agent. Times stay fixed at the installer defaults (08:00, 14:00, 20:00 host-local). Cron *content* is not user-editable.

## Why scope changed

The original brainstorm chose chat-based time customization. Research turned up two blockers within EdgeClaw-only scope:

1. **OpenClaw exposes no agent-callable cron tool.** Cron management is operator-only CLI surface (`openclaw cron add|remove|list`).
2. **OpenClaw's `exec` tool allowlist is binary-level only.** There is no way to grant `openclaw cron *` to an agent without granting the entire `openclaw` binary — which would also give the agent device management, security audits, config writes, and secrets. Unacceptable blast radius.

Within the EdgeClaw-only constraint, the only feasible chat-driven design is **self-gating at the prompt level**: crons stay scheduled, but each prompt reads a preference file and exits silently when its cron is disabled. This delivers on/off control without manipulating the scheduler.

Time customization is deferred — it requires either upstream OpenClaw work (agent-callable cron API) or extending `packages/openclaw-plugin/`, both explicitly out of scope.

## Design

### 1. Preference file: `memory/cron-preferences.json`

Path inside the agent's workspace: `~/.openclaw/workspace/memory/cron-preferences.json`. Sits alongside the existing `heartbeat-state.json` and `welcome-state.json`.

```json
{
  "digest": true,
  "ambientAfternoon": true,
  "ambientEvening": true
}
```

**Default behavior.** If the file is missing, or a key is absent, treat as `true`. No installer changes — users who never customize see exactly today's behavior.

**Keys map to cron job names installed by `install/install_index.ts`:**

| key | cron job name | schedule |
|---|---|---|
| `digest` | `EdgeClaw — daily digest` | `0 8 * * *` |
| `ambientAfternoon` | `EdgeClaw — ambient discovery (afternoon)` | `0 14 * * *` |
| `ambientEvening` | `EdgeClaw — ambient discovery (evening)` | `0 20 * * *` |

Only those three keys are recognized. Anything else is ignored.

### 2. Cron prompts self-gate

Add a preference-gate preamble as the new first step under `# Job` in both cron prompts.

**`prompts/digest.md`** (single key: `digest`):

> 0. **Read preferences.** Read `memory/cron-preferences.json`. Treat missing file or malformed JSON as `{}`. If `preferences.digest === false`, exit silently — do not call any MCP tool, do not write any memory file, do not send a message. Default behavior (file missing, key absent, or `true`) is enabled.

**`prompts/ambient.md`** (two keys, detected by firing hour):

> 0. **Read preferences.** Read `memory/cron-preferences.json`. Treat missing file or malformed JSON as `{}`. Determine which cron this is by the current host-local hour:
>    - hour ∈ {13, 14, 15} → read `preferences.ambientAfternoon`
>    - hour ∈ {19, 20, 21} → read `preferences.ambientEvening`
>    - any other hour (unexpected firing) → treat as disabled and exit silently
>
> If the resolved value is `false`, exit silently — do not call any MCP tool, do not write any memory file, do not send a message. Default behavior (file missing, key absent, or `true`) is enabled.

Why ranges around 14:00 and 20:00 rather than exact equality: cron firing has small drift; if the wake happens at 14:01 we still want the afternoon path. Three-hour windows are generous and non-overlapping.

### 3. Onboarding addition: Step 7 — Schedule preferences (opt-in)

Add to `skills/index-network/bootstrap.md` after Step 6:

```
## Step 7 — Schedule preferences (opt-in)

Tell the user briefly:

> "By the way — I'll send a digest each morning at 8am and check in around
>  2pm and 8pm. Want to turn any of those off?"

If they decline, shrug, or pivot → finish onboarding silently. Do not write
the preferences file; defaults stand.

If they want to disable one or more → run the schedule sub-dialog in
`schedule.md`. It handles reading, updating, and writing the file.
```

This is the only onboarding change. The 6 existing steps and the top-level `BOOTSTRAP.md` router are untouched.

### 4. Schedule sub-dialog: new file `skills/index-network/schedule.md`

Used from onboarding Step 7 and any time the user later asks about their schedule.

**Read current state**
- Try to read `memory/cron-preferences.json`. If missing or malformed, treat all three as `true`.
- Surface plainly: *"Right now: digest on, afternoon check-in on, evening check-in on."*

**Apply a change**
1. Parse user intent into one or more `{key: boolean}` deltas. The three valid keys are `digest`, `ambientAfternoon`, `ambientEvening`. Reject anything else with a short clarifying question.
2. Read the existing preferences file (or start from `{}`).
3. Merge in the deltas (later values overwrite earlier).
4. Write the file back as compact JSON, two-space indented.
5. Confirm in plain language: *"Done — afternoon check-in is off. Digest and evening check-in still on."*

**Rules**
- Only the three known keys are writable.
- Never paraphrase intent silently — always confirm after applying.
- If the user asks to change a *time*, explain plainly: *"I can't change the times today — only turn each one on or off. Digest is 8am, check-ins are 2pm and 8pm."* Do not promise time changes.
- If the JSON write fails, report verbatim and do not retry.

### 5. Free-form recognition in `SKILL.md`

Add two changes:

1. Add `schedule.md` to the "When to read each file" table:
   > **User asks about cron schedule / digest times / on-off** → [schedule.md](schedule.md).

2. Add a short rules block under whatever section governs runtime behavior:
   > If the user asks to turn off, enable, disable, mute, or silence any cron — digest, daily check-in, ambient pass, morning summary — run the schedule sub-dialog in `schedule.md`. Recognize natural phrasings, not literal keywords.
   >
   > If the user asks to change the *time* of a cron, explain plainly that you can only enable or disable, not reschedule. Do not promise time changes.

## Out of scope

- Changing cron *times* — fixed at 08/14/20 host-local for now.
- Per-day variation (weekend vs. weekday schedules).
- Changing cron *content* (digest/ambient prompts).
- Multi-channel routing per cron.
- Introspecting actual OpenClaw cron state — we trust the installer's schedule and never read it back.
- Modifying `packages/openclaw-plugin/`.

## Files touched

- `packages/edgeclaw/skills/index-network/schedule.md` — new
- `packages/edgeclaw/skills/index-network/SKILL.md` — add `schedule.md` row + rules block
- `packages/edgeclaw/skills/index-network/bootstrap.md` — add Step 7
- `packages/edgeclaw/skills/index-network/prompts/digest.md` — add preference-gate as Step 0
- `packages/edgeclaw/skills/index-network/prompts/ambient.md` — add preference-gate as Step 0
- `packages/edgeclaw/package.json` — minor version bump (0.4.0 → 0.5.0)
- root `bun.lock` — workspace version sync

No installer changes. No new tool capabilities. No `cron-defaults.json`.

## Verification approach

Skill files are prose; no unit tests apply. Verification is manual:

1. Re-run `bun install/install.ts <KEY> --dev` to stage the new skill files into `~/.openclaw/workspace/skills/`.
2. Reset onboarding server-side (or use a fresh test user).
3. Message the agent → expect the standard 6 onboarding steps followed by Step 7's confirmation question.
4. Reply "turn off afternoon" → expect the agent to confirm and write `memory/cron-preferences.json` with `ambientAfternoon: false`.
5. Inspect the file on disk to confirm shape.
6. Trigger the afternoon ambient cron manually (or wait for 14:00) → expect it to exit silently with no message sent.
7. Trigger the morning digest → expect normal behavior.
