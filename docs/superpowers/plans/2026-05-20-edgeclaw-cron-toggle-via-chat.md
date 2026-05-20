# EdgeClaw Cron Toggle Via Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users disable/enable each EdgeClaw cron (digest, afternoon ambient, evening ambient) by asking the agent in chat. The agent writes a preference file the cron prompts read; crons stay scheduled at 08/14/20 but exit silently when their key is `false`.

**Architecture:** Self-gating at the prompt level. New file `schedule.md` is the agent-facing sub-dialog. Both cron prompts gain a "Step 0 — Read preferences" preamble that exits silently when the user's key for that cron is `false`. No installer changes, no new tool capabilities, no `openclaw cron` calls from the agent.

**Tech Stack:** Skill markdown bundle (`packages/edgeclaw/skills/index-network/`). No automated tests — all verification is by reading the diff back and a manual smoke test at the end (Task 6). Branch name: `feat/edgeclaw-cron-toggle`.

**Linear:** IND-307. Spec at `docs/superpowers/specs/2026-05-20-edgeclaw-cron-customization-design.md`.

---

### Task 1: Create the schedule sub-dialog file

**Files:**
- Create: `packages/edgeclaw/skills/index-network/schedule.md`

- [ ] **Step 1: Write the new file**

Write this exact content to `packages/edgeclaw/skills/index-network/schedule.md`:

```markdown
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
```

- [ ] **Step 2: Verify by reading back**

Run: `head -60 packages/edgeclaw/skills/index-network/schedule.md`
Expected: the content above renders correctly with no broken markdown.

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/skills/index-network/schedule.md
git commit -m "feat(edgeclaw): add schedule sub-dialog for cron on/off toggling"
```

---

### Task 2: Wire schedule.md into SKILL.md

**Files:**
- Modify: `packages/edgeclaw/skills/index-network/SKILL.md`

- [ ] **Step 1: Add `schedule.md` to the "When to read each file" list**

Find the existing list (it has bullets for `tools.md`, `exemplars.md`, `bootstrap.md`, `heartbeat.md`). Add this new bullet at the end of that list, immediately before the next paragraph:

```markdown
- **User asks about cron schedule / digest times / on-off** → [schedule.md](schedule.md). Schema for `memory/cron-preferences.json` and the conversational procedure for toggling each cron.
```

Use Edit. The `old_string` should be the last existing bullet in the list (the one for `heartbeat.md`); the `new_string` keeps that bullet and appends the new one.

- [ ] **Step 2: Add the schedule-recognition rules block**

Locate the paragraph that begins "Cron prompts in `prompts/` (`welcome.md`, `digest.md`, `ambient.md`) are loaded by the cron runner via `--message`; you do not read them yourself." Immediately after that paragraph (and before `## Handoff`), insert this new section:

```markdown
## Cron preferences

If the user asks to turn off, enable, disable, mute, or silence any cron — digest, daily check-in, ambient pass, morning summary, evening update, etc. — run the schedule sub-dialog in [schedule.md](schedule.md). Recognize natural phrasings, not literal keywords.

If the user asks to change the *time* of a cron (e.g. "move digest to 9", "later check-ins"), explain plainly that you can only enable or disable today, not reschedule. Do not promise time changes.
```

- [ ] **Step 3: Verify**

Run: `grep -n "schedule.md\|Cron preferences" packages/edgeclaw/skills/index-network/SKILL.md`
Expected: at least one hit for each — the new bullet referencing `schedule.md`, and the new `## Cron preferences` heading.

- [ ] **Step 4: Commit**

```bash
git add packages/edgeclaw/skills/index-network/SKILL.md
git commit -m "feat(edgeclaw): wire schedule sub-dialog into index-network SKILL.md"
```

---

### Task 3: Add Step 7 to onboarding ritual

**Files:**
- Modify: `packages/edgeclaw/skills/index-network/bootstrap.md`

- [ ] **Step 1: Insert Step 7 between Step 6 and the Rules separator**

Locate the end of Step 6 (it currently ends with "The next ambient/accepted heartbeat tick will pick up from here.") followed by a blank line and `---`. Insert this new section between Step 6's closing sentence and the `---` separator:

```markdown
## Step 7 — Schedule preferences (opt-in)

Tell the user briefly, in your own words:

> "By the way — I'll send a short digest each morning at 8am and check in around 2pm and 8pm. Want to turn any of those off?"

- If they decline, shrug, or pivot to something else → finish onboarding silently. Do not write the preferences file. Defaults stand (all three crons enabled).
- If they want to disable one or more → run the schedule sub-dialog in [`schedule.md`](schedule.md). It handles parsing, reading, updating, and writing `memory/cron-preferences.json`.

This step is the only place the agent volunteers the schedule. Outside onboarding, the user has to ask. Do not nudge or re-offer.
```

Use Edit. The `old_string` should include the last sentence of Step 6 and the blank line + `---` after it; the `new_string` includes that same last sentence, the new Step 7, and the same `---` separator.

- [ ] **Step 2: Verify**

Run: `grep -n "Step 7\|schedule.md" packages/edgeclaw/skills/index-network/bootstrap.md`
Expected: `## Step 7 — Schedule preferences` heading and a link to `schedule.md`.

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/skills/index-network/bootstrap.md
git commit -m "feat(edgeclaw): add Step 7 schedule confirmation to onboarding"
```

---

### Task 4: Add preference gate to digest cron prompt

**Files:**
- Modify: `packages/edgeclaw/skills/index-network/prompts/digest.md`

- [ ] **Step 1: Insert Step 0 at the top of `# Job`**

Locate the line `# Job` followed by the line `Send a morning brief to the user via the \`message\` tool.` and then the existing `1. **Read dedup state.**` step. Insert this new step between the "Send a morning brief…" sentence and the existing Step 1:

```markdown
0. **Read preferences.** Read `memory/cron-preferences.json`. Treat a missing file, malformed JSON, or absent `digest` key as `digest: true`. If `digest` is explicitly `false`, exit silently: do not call any MCP tool, do not write any memory file, do not send a message. End your turn here.
```

Important: the existing steps reference each other by number (e.g. "step 11", "step 12"). Do **not** renumber them. The new step is `0`; existing steps 1, 2, 3, … keep their numbers.

Use Edit. The `old_string` should be `Send a morning brief to the user via the \`message\` tool.\n\n1. **Read dedup state.**` (or use enough surrounding context to make it unique); the `new_string` inserts the Step 0 block between them.

- [ ] **Step 2: Verify**

Run: `grep -n "Step 0\|cron-preferences\|0\\. \\*\\*Read preferences" packages/edgeclaw/skills/index-network/prompts/digest.md`
Expected: one hit for the new Step 0 block referencing `cron-preferences.json`.

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/skills/index-network/prompts/digest.md
git commit -m "feat(edgeclaw): gate digest cron on cron-preferences.json"
```

---

### Task 5: Add preference gate to ambient cron prompt

**Files:**
- Modify: `packages/edgeclaw/skills/index-network/prompts/ambient.md`

- [ ] **Step 1: Insert Step 0 at the top of `# Job`**

Locate the line `# Job` and the existing first step `1. Call \`read_user_profiles()\` (no args)...`. Insert this new step between the `# Job` header and the existing Step 1:

```markdown
0. **Read preferences.** Read `memory/cron-preferences.json`. Treat a missing file or malformed JSON as `{}`. Determine which cron this is by the current host-local hour:
   - hour ∈ {13, 14, 15} → read `preferences.ambientAfternoon`
   - hour ∈ {19, 20, 21} → read `preferences.ambientEvening`
   - any other hour (unexpected firing) → treat as disabled and exit silently.

   If the resolved value is explicitly `false`, exit silently: do not call any MCP tool, do not write any memory file, do not send a message. End your turn here. Missing file, absent key, or `true` means enabled — continue to Step 1.
```

Same renumbering caveat as Task 4: existing steps reference each other by number; do not renumber them.

Use Edit. The `old_string` is `# Job\n\n1. Call \`read_user_profiles()\``; the `new_string` keeps `# Job`, inserts the Step 0 block, then Step 1.

- [ ] **Step 2: Verify**

Run: `grep -n "Step 0\|ambientAfternoon\|ambientEvening" packages/edgeclaw/skills/index-network/prompts/ambient.md`
Expected: one hit for the new Step 0 block referencing both `ambientAfternoon` and `ambientEvening`.

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/skills/index-network/prompts/ambient.md
git commit -m "feat(edgeclaw): gate ambient cron on cron-preferences.json"
```

---

### Task 6: Version bump and smoke test

**Files:**
- Modify: `packages/edgeclaw/package.json`
- Modify: `bun.lock` (regenerated by `bun install`)

- [ ] **Step 1: Bump edgeclaw version 0.4.0 → 0.5.0**

Read `packages/edgeclaw/package.json` to confirm the current version is `0.4.0`. Then Edit:

- `old_string`: `"version": "0.4.0",`
- `new_string`: `"version": "0.5.0",`

If the current version is something other than `0.4.0` (e.g. someone bumped it since this plan was written), use the actual current version as `old_string` and increment its minor number for `new_string`.

- [ ] **Step 2: Sync bun.lock**

Run from repo root: `bun install`
Expected: `bun.lock` updated, no other dependency changes.

- [ ] **Step 3: Verify version is bumped end-to-end**

Run: `grep '"version": "0\.5\.0"' packages/edgeclaw/package.json bun.lock | head`
Expected: at least two matches (the package.json line and the workspace entry in bun.lock).

- [ ] **Step 4: Commit version bump**

```bash
git add packages/edgeclaw/package.json bun.lock
git commit -m "chore(edgeclaw): bump version to 0.5.0 for cron toggle feature"
```

- [ ] **Step 5: Manual smoke test (human verification)**

The agent's behavior cannot be tested by code — it has to be exercised in a live chat. Run these steps locally:

  1. Re-stage the new skills into the local OpenClaw workspace:
     ```bash
     cd packages/edgeclaw
     bun install/install.ts <YOUR_DEV_API_KEY> --dev
     ```
     Expected: `→ staged N skill files into /Users/.../.openclaw/workspace/skills` with `N` higher than before (the new `schedule.md`).

  2. Reset the test user's onboarding server-side (via the Index Network dev console or a fresh test account), then message EdgeClaw in Telegram.
     Expected: the full 6-step onboarding ritual runs, followed by Step 7's confirmation question about morning digest / 2pm / 8pm.

  3. Reply with something like *"turn off the afternoon check-in"*.
     Expected: the agent confirms in plain language that the afternoon check-in is off and the other two are still on.

  4. On the host machine, inspect the written file:
     ```bash
     cat ~/.openclaw/workspace/memory/cron-preferences.json
     ```
     Expected: a complete object with `digest: true`, `ambientAfternoon: false`, `ambientEvening: true`.

  5. Manually trigger the afternoon ambient cron (or wait until 14:00 host-local):
     ```bash
     openclaw cron run "EdgeClaw — ambient discovery (afternoon)"
     ```
     (If `cron run` is not the correct subcommand, use `openclaw cron list --json` to find the run-now equivalent.)
     Expected: the agent reads preferences, sees `ambientAfternoon: false`, and exits silently — no message delivered to Telegram.

  6. Trigger the morning digest the same way:
     ```bash
     openclaw cron run "EdgeClaw — daily digest"
     ```
     Expected: the agent runs normally, sends the morning brief.

  7. Ask the agent later (outside onboarding): *"can you change my digest to 9am?"*.
     Expected: the agent explains it can only enable or disable today, not reschedule. It does **not** promise a time change.

If any step diverges, fix the underlying skill file, re-run `bun install/install.ts`, and repeat the failing step.

- [ ] **Step 6: Verify nothing else changed**

Run: `git status` and `git log --oneline dev..HEAD`
Expected: 6 commits on the feature branch (one per task), all touching only files under `packages/edgeclaw/skills/index-network/`, `packages/edgeclaw/package.json`, or `bun.lock`. Nothing else.

---

## Notes for the executor

- **No tests to run.** Skill files are prose loaded by the agent at session start. The only verification path is the manual smoke test in Task 6 Step 5.
- **Do not modify the installer (`install/install_index.ts`, `install/install.ts`).** This whole design is intentionally installer-free.
- **Do not introduce `openclaw cron` calls anywhere in the skill bundle.** The spec rejected that path — the agent must not run shell commands. If you find yourself wanting to add a shell call, stop and re-read the spec.
- **Step numbering matters.** Existing prompt steps cross-reference each other by number (e.g. digest.md says "jump to step 11"). The new gate steps are explicitly numbered `0` to leave existing numbers untouched.
- **Branch name:** `feat/edgeclaw-cron-toggle`. No Linear ID in the branch name.
- **Subtree note:** `packages/edgeclaw/` is a git subtree mirrored to `indexnetwork/edgeclaw`. The auto-sync workflow runs on push to `dev`/`main`, so commits land in the fork after merge. No manual subtree push needed.
