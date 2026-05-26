# EDG-9: Onboarding Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Edge Esmeralda onboarding to lead with a community welcome, remove immediate opportunity surfacing, and harden gate instructions so the LLM runs the ritual without asking.

**Architecture:** All changes are markdown prompt files and one TypeScript installer file in `packages/agentvillage/`. No backend changes. The onboarding steps are renumbered from 6 to 5 (Step 6 / welcome pass is removed). Gate 2 in AGENTS.md (one-time welcome) is removed; gates renumber from 3 to 2.

**Tech Stack:** Markdown (agent prompts), TypeScript/Bun (installer)

---

### Task 1: Rewrite bootstrap.md — new Edge welcome + hardened gate + remove Step 6

**Files:**
- Modify: `packages/agentvillage/skills/index-network/bootstrap.md`

- [ ] **Step 1: Rewrite the session-start gate section (lines 8–14)**

Replace the current gate section with hardened language. The new content for the `onboardingComplete: false` bullet must include explicit "do not ask" instructions:

```markdown
## Session-start gate

The Index Network server is the source of truth for Index onboarding — not local file state. At session start, call `read_user_profiles()` (no args) and check `onboardingComplete`:

- **If `onboardingComplete` is `false`:** run this ritual immediately. Do not ask the user whether they want to onboard. Do not describe what you are about to do. Do not summarize the profile data. Start with the welcome message in Step 1 and proceed through each step without pausing for permission. Do not skip or reorder steps. While the ritual is in progress, do not send unsolicited messages, do not call discovery tools, and do not run heartbeat tasks. After Step 5 (or any path that ends the ritual), append `[gate] index-network: triggered, ritual complete` to `memory/<today>.md` before handing back to `AGENTS.md` for the Edge gate.
- **If `onboardingComplete` is `true`:** skip the ritual. Append `[gate] index-network: skipped (onboardingComplete=true)` to `memory/<today>.md`, then hand back to `AGENTS.md` for the Edge gate. Index Network is already onboarded server-side; Edge onboarding may or may not still need to run, which is handled by the next gate in `AGENTS.md` "First-message gates".
```

- [ ] **Step 2: Rewrite Step 1 — Edge Esmeralda community welcome (lines 18–38)**

Replace the current Step 1 with the community-first welcome. The new Step 1 combines the welcome and profile creation:

```markdown
## Step 1 — Welcome and create the user profile

Welcome the user to Edge Esmeralda the place — **never mention the underlying platform by name** (see SOUL.md "Never name the plumbing"). Lead with the community, then introduce yourself:

> "Welcome to Edge Esmeralda — four weeks in Healdsburg, May 30 to June 27. 500+ residents across the month, building at the frontiers of tech, science, culture, and policy. Tracks, residencies, and applied experiments run in parallel.
>
> I'm Edge, your agent here. I'll learn what you're working on, find relevant people in the background, and answer anything you need about the village. Let's get you set up."

Draw dates, attendee count, and programming format from `AGENTS.md` Community context — do not invent them.

Then call `create_user_profile()` with no arguments — the lookup runs against your tooling, the user does not need to know how.

Narrate while processing:

> `> Looking you up…`

Present the profile summary naturally:

> "Here's what I found: [summary]. Does that sound right?"

Then:

- If they confirm → `create_user_profile(confirm=true)` and proceed to Step 2.
- If they want edits → `create_user_profile(bioOrDescription="[their correction]", confirm=true)` and proceed to Step 2.
- If nothing is found → ask them to describe themselves in a sentence, then `create_user_profile(bioOrDescription="[their text]", confirm=true)`.
```

- [ ] **Step 3: Remove Step 6 (lines 77–81) and renumber**

Delete the entire "Step 6 — First ambient pass (welcome message)" section. The file now has Steps 1–5:

1. Welcome and create the user profile (rewritten above)
2. Capture their first signal (unchanged, was Step 2)
3. Capture chat-channel handle silently (unchanged, was Step 3)
4. Close out onboarding (unchanged, was Step 4)
5. Populate USER.md (unchanged, was Step 5)

In Step 5, add the gate-trace line that was previously in Step 6. Append to the end of Step 5:

```markdown
After populating USER.md, append `[gate] index-network: triggered, ritual complete` to `memory/<today>.md` (the gate-trace line from the session-start gate). The next ambient/accepted heartbeat tick will pick up from here.

Cron-schedule preferences are not asked about here — they belong to Edge, not Index Network. `AGENTS.md` "First-message gates" runs that step after this ritual finishes.
```

- [ ] **Step 4: Update the Rules section (lines 85–93)**

Change the rule about discovery tools — with Step 6 gone, discovery is no longer allowed during onboarding at all:

Replace:
```
- Do not call `discover_opportunities`, `list_opportunities`, or any other discovery tool **before Step 6**. Onboarding ends at `complete_onboarding()`; the welcome ambient pass is the first time discovery is allowed.
```

With:
```
- Do not call `discover_opportunities`, `list_opportunities`, or any other discovery tool during onboarding. Opportunities surface on the first scheduled cron tick after onboarding completes.
```

- [ ] **Step 5: Commit**

```bash
git add packages/agentvillage/skills/index-network/bootstrap.md
git commit -m "feat(agentvillage): rewrite bootstrap — Edge welcome, remove welcome pass, harden gate"
```

---

### Task 2: Delete `prompts/welcome.md`

**Files:**
- Delete: `packages/agentvillage/skills/index-network/prompts/welcome.md`

- [ ] **Step 1: Delete the file**

```bash
git rm packages/agentvillage/skills/index-network/prompts/welcome.md
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(agentvillage): remove welcome.md — opportunities land on first cron tick"
```

---

### Task 3: Update AGENTS.md — remove gate 2, harden gate preamble, clean up welcome-state references

**Files:**
- Modify: `packages/agentvillage/workspace/AGENTS.md`

- [ ] **Step 1: Harden the first-message gates preamble and remove gate 2 (lines 38–56)**

Replace the entire "First-message gates" section with:

```markdown
## First-message gates

**Before the first user message of any session, run these gates in order. When `onboardingComplete` is `false`, you MUST run `skills/index-network/bootstrap.md` immediately. Do not ask. Do not offer a choice. Do not summarize what you found. Run the ritual. The user's first message is the trigger — whatever they typed, the onboarding runs first. Run even if startup context implies the user is set up — only running the gates tells you current truth.**

1. **Per-skill session-start gates.** Today only `index-network` — call `read_user_profiles()` (no args). **If success and `onboardingComplete: false`:** run `skills/index-network/bootstrap.md` end-to-end. **If success and onboarded:** skip. **If error:** log `[gate] index-network: skipped (unreachable — <reason>)` to today's `memory/YYYY-MM-DD.md` and continue.
2. **Edge schedule gate.** If `memory/edge-state.json` is missing, ask about the schedule (opening line depends on gate 1 above):
   - **Index ritual just finished:** *"By the way — morning digest at 8am. Want to move it, turn it off, or also enable an afternoon (2pm) or evening (8pm) check-in?"*
   - **Gate 1 skipped (already onboarded), need framing:** *"Welcome to Edge Esmeralda. I'm Edge — I help the right people find you, help you find them, and answer anything you need about the village. Quick setup first: by default I run a morning digest at 8am. Want to move it, turn it off, or also enable an afternoon (2pm) or evening (8pm) check-in?"*

   Read `SCHEDULE.md` and follow the procedure (never name it). When settled, write `{ "edgeOnboardingCompletedAt": "<ISO timestamp>" }` to `memory/edge-state.json`. If the file exists, skip.

While gates run: no heartbeat tasks, no unrelated content, no answering the user's first message until gates finish.

After each gate, append one line to `memory/YYYY-MM-DD.md`:

- `[gate] index-network: skipped (onboardingComplete=true)` | `triggered, ritual complete` | `skipped (unreachable — <reason>)`
- `[gate] edge: skipped (marker present)` | `triggered, schedule confirmed`
```

Note: gate 2 (one-time welcome) is removed entirely. The old gate 3 (Edge schedule) becomes gate 2. The `[gate] welcome:` trace line is removed.

- [ ] **Step 2: Remove welcome-state.json from the Memory section (line 67)**

Delete this line:
```
- **Welcome state:** `memory/welcome-state.json` — `welcomeDeliveredAt`.
```

- [ ] **Step 3: Commit**

```bash
git add packages/agentvillage/workspace/AGENTS.md
git commit -m "feat(agentvillage): harden gate instructions, remove welcome gate and welcome-state"
```

---

### Task 4: Update SKILL.md — remove welcome.md references

**Files:**
- Modify: `packages/agentvillage/skills/index-network/SKILL.md`

- [ ] **Step 1: Update the description in frontmatter (line 3)**

Replace:
```
description: Edge Esmeralda's Index Network bundle. Surfaces opportunities through a one-time welcome on first run, a daily 08:00 digest, twice-daily ambient passes at 14:00 and 20:00 (all host-local), and accepted-opportunity notifications on the heartbeat tick. Prunes stale signals weekly. Read when surfacing opportunities, drafting introductions, running onboarding for a new user, composing welcome / digest / ambient flows, or handling anything backed by the Index Network MCP (server `index`).
```

With:
```
description: Edge Esmeralda's Index Network bundle. Surfaces opportunities through a daily 08:00 digest, twice-daily ambient passes at 14:00 and 20:00 (all host-local), and accepted-opportunity notifications on the heartbeat tick. Prunes stale signals weekly. Read when surfacing opportunities, drafting introductions, running onboarding for a new user, composing digest / ambient flows, or handling anything backed by the Index Network MCP (server `index`).
```

- [ ] **Step 2: Update the "When to read each file" section (lines 15–22)**

Replace the bootstrap bullet (line 19) — change "Six-step" to "Five-step":
```
- **`read_user_profiles().onboardingComplete === false`** → [bootstrap.md](bootstrap.md). Five-step Index Network onboarding ritual and the session-start gate.
```

Replace the cron prompts paragraph (lines 22) — remove `welcome.md` from the list:
```
Cron prompts in `prompts/` (`digest.md`, `ambient.md`) are loaded by the cron runner via `--message`; you do not read them yourself. The crons themselves are Edge infrastructure — toggling them on or off is handled by `workspace/SCHEDULE.md`, not this skill.
```

Remove the exemplars bullet's mention of "welcome" (line 18):
```
- **Composing user-facing opportunity renderings** → [exemplars.md](exemplars.md). Canonical daily digest / ambient discovery voice samples; greeting-draft format for `&msg=`.
```

- [ ] **Step 3: Commit**

```bash
git add packages/agentvillage/skills/index-network/SKILL.md
git commit -m "refactor(agentvillage): update SKILL.md — remove welcome.md references"
```

---

### Task 5: Update exemplars.md — remove Welcome section

**Files:**
- Modify: `packages/agentvillage/skills/index-network/exemplars.md`

- [ ] **Step 1: Remove the Welcome section (lines 1–31)**

Replace the file header (lines 1–3) with:
```markdown
# Index Network — Voice Exemplars

Canonical user-facing renderings for Edge Esmeralda's Index Network flows. Mimic these exactly when composing the daily digest, ambient passes, and greeting drafts. They are the bar for tone, structure, and information density. Edge Esmeralda is the literal community in every example — pull facts from `AGENTS.md` Community context, never invent dates, attendee counts, or programming formats.
```

Delete the entire "Welcome" section (lines 5–31) — everything from `## Welcome (fires once, after onboarding completes)` through the `See you soon ☀️` blockquote.

The file should now start with the header above, followed by `## Good morning digest` (was line 32).

- [ ] **Step 2: Commit**

```bash
git add packages/agentvillage/skills/index-network/exemplars.md
git commit -m "refactor(agentvillage): remove Welcome exemplar — welcome pass deleted"
```

---

### Task 6: Clean up installer — remove welcome-state.json from wipe list

**Files:**
- Modify: `packages/agentvillage/install/install.ts`

- [ ] **Step 1: Remove welcome-state.json from the filesToWipe array (line 113)**

In the `copyWorkspaceFiles` function, change the `filesToWipe` array from:
```typescript
    const filesToWipe = [
      join(TARGET_HOME, "MEMORY.md"),
      join(TARGET_HOME, "memory", "edge-state.json"),
      join(TARGET_HOME, "memory", "welcome-state.json"),
    ];
```

To:
```typescript
    const filesToWipe = [
      join(TARGET_HOME, "MEMORY.md"),
      join(TARGET_HOME, "memory", "edge-state.json"),
    ];
```

- [ ] **Step 2: Commit**

```bash
git add packages/agentvillage/install/install.ts
git commit -m "chore(agentvillage): remove welcome-state.json from installer wipe list"
```

---

### Task 7: Test the full flow

**Files:** None (verification only)

- [ ] **Step 1: Reinstall to Hermes**

```bash
cd packages/agentvillage
bun install/install.ts --index-api-key <KEY> --wipe-user --no-restart
```

- [ ] **Step 2: Reset server-side onboarding**

Using Neon MCP or direct SQL, set the test user's `onboarding` column to `'{}'::jsonb`.

- [ ] **Step 3: Clear local state**

```bash
rm -f ~/.hermes/memory/welcome-state.json ~/.hermes/memory/edge-state.json
```

- [ ] **Step 4: Run `hermes chat` and send any message**

Verify:
1. Agent runs the welcome + onboarding ritual WITHOUT asking permission
2. Welcome message mentions Edge Esmeralda community context (dates, attendee count)
3. No opportunity cards in the welcome
4. After onboarding completes, Edge schedule gate fires
5. No mention of `welcome-state.json` errors

- [ ] **Step 5: Squash into final commit if needed**

If all verifications pass, optionally squash the per-task commits into a single feature commit:

```bash
git commit -m "feat(agentvillage): EDG-9 — Edge welcome, remove welcome pass, harden onboarding gates"
```
