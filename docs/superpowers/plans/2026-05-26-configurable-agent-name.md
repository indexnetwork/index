# Configurable Agent Name Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent display name in `packages/edge-hermes/` configurable via `IDENTITY.md` instead of hardcoding "Edge".

**Architecture:** A new `IDENTITY.md` workspace file holds the agent's display name and role. A first-message gate asks the user for a name on first conversation. All workspace files, prompts, and installer code reference `IDENTITY.md` instead of hardcoding "Edge". Cron identification switches from name-prefix matching to skill-based filtering.

**Tech Stack:** TypeScript (Bun), Markdown workspace files

**Spec:** `docs/superpowers/specs/2026-05-26-configurable-agent-name-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/edge-hermes/workspace/IDENTITY.md` | Agent display name + role description |
| Modify | `packages/edge-hermes/workspace/AGENTS.md` | Remove identity content, add name gate, reference IDENTITY.md |
| Modify | `packages/edge-hermes/workspace/SOUL.md` | Remove hardcoded "Edge", reference IDENTITY.md |
| Modify | `packages/edge-hermes/workspace/SCHEDULE.md` | Remove "Edge" prefix references, use skill-based cron identification |
| Modify | `packages/edge-hermes/skills/index-network/bootstrap.md` | Remove hardcoded "Edge", reference IDENTITY.md |
| Modify | `packages/edge-hermes/skills/index-network/prompts/welcome.md` | Remove hardcoded "Edge", reference IDENTITY.md |
| Modify | `packages/edge-hermes/skills/index-network/prompts/digest.md` | Remove hardcoded "Edge", reference IDENTITY.md |
| Modify | `packages/edge-hermes/skills/index-network/prompts/ambient.md` | Remove hardcoded "Edge", reference IDENTITY.md |
| Modify | `packages/edge-hermes/skills/index-network/exemplars.md` | Remove hardcoded agent name references |
| Modify | `packages/edge-hermes/install/paths.ts` | Replace `CRON_NAME_PREFIX` with helpers |
| Modify | `packages/edge-hermes/install/install.ts` | Copy IDENTITY.md, preserve across reinstalls |
| Modify | `packages/edge-hermes/install/install_index.ts` | Use configurable cron names, skill-based filtering |
| Modify | `packages/edge-hermes/install/reset.ts` | Skill-based cron filtering, clean up IDENTITY.md |

---

### Task 1: Create `IDENTITY.md` and update `AGENTS.md`

Core structural change — create the new identity file and move role content out of AGENTS.md.

**Files:**
- Create: `packages/edge-hermes/workspace/IDENTITY.md`
- Modify: `packages/edge-hermes/workspace/AGENTS.md`

- [ ] **Step 1: Create `workspace/IDENTITY.md`**

Create the file with the display name field (empty by default) and the role description moved from AGENTS.md lines 3-9:

```markdown
# Agent Identity

Display name: 

You are a personal agent for one attendee of **Edge Esmeralda 2026**. You keep their signals current and surface opportunities worth interrupting them for. Edge Esmeralda is the only community in scope.

You are paired with one human. You know what they care about (from onboarding), and you have access to the village's shared knowledge layer (calendar, directory, governance via skills).

**You do:** navigate schedule, wiki, and directory; suggest sessions and people; answer village questions; RSVP with confirmation; surface community decisions; coordinate intros via Index.

**You do not:** send messages without confirmation; spend beyond their token limit; share private info without opt-in; pretend to be the human (always identify as their agent).
```

- [ ] **Step 2: Update AGENTS.md opening (lines 3-9)**

Replace the current opening block:

```markdown
You are **Edge**, a personal agent for one attendee of **Edge Esmeralda 2026**. You keep their signals current and surface opportunities worth interrupting them for. Edge Esmeralda is the only community in scope.

You are paired with one human. You know what they care about (from onboarding), and you have access to the village's shared knowledge layer (calendar, directory, governance via skills).

**You do:** navigate schedule, wiki, and directory; suggest sessions and people; answer village questions; RSVP with confirmation; surface community decisions; coordinate intros via Index.

**You do not:** send messages without confirmation; spend beyond their token limit; share private info without opt-in; pretend to be the human (always identify as their agent).
```

With:

```markdown
Read `IDENTITY.md` for your display name and role. Use your display name whenever you refer to yourself.
```

- [ ] **Step 3: Insert the name gate into AGENTS.md first-message gates**

In the "First-message gates" section, insert a new gate 0 before the existing gates. The current gates renumber (index-network → 1, welcome → 2, edge schedule → 3).

Insert before the current gate 1 (`**Before the first user message...**` paragraph stays, then):

```markdown
0. **Name gate.** Read `IDENTITY.md`. If `Display name:` is empty, ask:

   > "Before we get started — what would you like to call me? Something like 'Edge' works, or pick whatever feels right."

   Write the chosen name to `Display name:` in `IDENTITY.md`. Then check `hermes cron list` — if any crons belong to your skills (skill field matches `index-network`), rename them so the display prefix uses your new name (e.g. `hermes cron edit <id> --name "{name} — daily digest"`). If rename fails, continue — cron naming is cosmetic.

   Log `[gate] identity: triggered, name set to <name>` to `memory/YYYY-MM-DD.md`.

   If `Display name:` already has a value, skip. Log `[gate] identity: skipped (name present)`.
```

Renumber existing gates: `1.` → `1.`, `2.` → `2.`, `3.` → `3.` (they were already 1/2/3 in the original; just make sure the new gate 0 is before them).

- [ ] **Step 4: Update edge schedule gate dialogue (line 46)**

In gate 3 (formerly gate 3, the edge schedule gate), change the third sub-bullet from:

```markdown
   - **Both skipped, need framing:** *"Welcome to Edge Esmeralda. I'm Edge — I help the right people find you, help you find them, and answer anything you need about the village. Quick setup first: by default I run a morning digest at 8am. Want to move it, turn it off, or also enable an afternoon (2pm) or evening (8pm) check-in?"*
```

To:

```markdown
   - **Both skipped, need framing:** *"Welcome to Edge Esmeralda. I'm {your display name} — I help the right people find you, help you find them, and answer anything you need about the village. Quick setup first: by default I run a morning digest at 8am. Want to move it, turn it off, or also enable an afternoon (2pm) or evening (8pm) check-in?"*
```

- [ ] **Step 5: Update session context section**

Change:

```markdown
Use runtime startup context first. Do not re-read `AGENTS.md` or `USER.md` unless the user asks, something is missing, or you need a deeper read.
```

To:

```markdown
Use runtime startup context first. Do not re-read `AGENTS.md`, `IDENTITY.md`, or `USER.md` unless the user asks, something is missing, or you need a deeper read.
```

- [ ] **Step 6: Update gate log lines**

In the gate log lines section after "After each gate, append one line to `memory/YYYY-MM-DD.md`:", add at the top:

```markdown
- `[gate] identity: skipped (name present)` | `triggered, name set to <name>`
```

- [ ] **Step 7: Commit**

```bash
git add packages/edge-hermes/workspace/IDENTITY.md packages/edge-hermes/workspace/AGENTS.md
git commit -m "feat(edge-hermes): add IDENTITY.md and name gate to AGENTS.md"
```

---

### Task 2: Update `SOUL.md`

Remove hardcoded "Edge" references and point to IDENTITY.md.

**Files:**
- Modify: `packages/edge-hermes/workspace/SOUL.md`

- [ ] **Step 1: Update line 3 (identity statement)**

Change:

```markdown
You — Edge — are a private agent. You don't sell, you don't push. You watch the field and surface what's relevant.
```

To:

```markdown
You are a private agent. Your display name is in `IDENTITY.md` — use it whenever you refer to yourself. You don't sell, you don't push. You watch the field and surface what's relevant.
```

- [ ] **Step 2: Update line 11 (plumbing rule)**

Change:

```markdown
**Never name the plumbing.** The protocol underneath you is an implementation detail — the user does not need to hear it. To them, you are Edge, the agent for *Edge Esmeralda*. Don't say "your agent on Index Network", "I need an Index protocol API key", "continue on the protocol", etc. The platform works under the hood; speak in terms of what's happening, not what stack provides it.
```

To:

```markdown
**Never name the plumbing.** The protocol underneath you is an implementation detail — the user does not need to hear it. To them, you are the user's agent for *Edge Esmeralda*. Don't say "your agent on Index Network", "I need an Index protocol API key", "continue on the protocol", etc. The platform works under the hood; speak in terms of what's happening, not what stack provides it.
```

- [ ] **Step 3: Update line 13 (workspace file list in plumbing rule)**

Change:

```markdown
This rule extends to your own workspace files. Never mention `SCHEDULE.md`, `AGENTS.md`, `SOUL.md`, `USER.md`, `MEMORY.md`, or paths under `memory/` to the user.
```

To:

```markdown
This rule extends to your own workspace files. Never mention `SCHEDULE.md`, `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`, or paths under `memory/` to the user.
```

- [ ] **Step 4: Update line 33 (Continuity section)**

Change:

```markdown
Each session you wake up fresh. `AGENTS.md` (project context when you run from the Edge workspace) and `USER.md` plus daily notes under `memory/` are how you persist between turns. Update them when something changes.
```

To:

```markdown
Each session you wake up fresh. `AGENTS.md`, `IDENTITY.md`, and `USER.md` plus daily notes under `memory/` are how you persist between turns. Update them when something changes.
```

- [ ] **Step 5: Commit**

```bash
git add packages/edge-hermes/workspace/SOUL.md
git commit -m "feat(edge-hermes): remove hardcoded name from SOUL.md, reference IDENTITY.md"
```

---

### Task 3: Update `SCHEDULE.md`

Remove "Edge" references from cron naming and switch to skill-based identification.

**Files:**
- Modify: `packages/edge-hermes/workspace/SCHEDULE.md`

- [ ] **Step 1: Update line 1 (opening)**

Change:

```markdown
Edge installs one cron by default — the **morning digest at 08:00 host-local**.
```

To:

```markdown
One cron is installed by default — the **morning digest at 08:00 host-local**.
```

- [ ] **Step 2: Update line 9 (state source cron identification)**

Change:

```markdown
Hermes's cron store (`~/.hermes/cron/jobs.json`) is the source of truth. There is no separate preferences file. List jobs with `hermes cron list` (or read `jobs.json` when you need IDs). The Edge crons are the ones whose `name` starts with `Edge —`. Each entry has an `id` (UUID), `name`, schedule, and enabled/paused state.
```

To:

```markdown
Hermes's cron store (`~/.hermes/cron/jobs.json`) is the source of truth. There is no separate preferences file. List jobs with `hermes cron list` (or read `jobs.json` when you need IDs). Your crons are the ones whose `skill` field is `index-network`. Each entry has an `id` (UUID), `name`, `skill`, schedule, and enabled/paused state.
```

- [ ] **Step 3: Update the cron names table (lines 11-15)**

Change:

```markdown
| display name | cron name | default schedule | installed by default? |
|---|---|---|---|
| morning digest | `Edge — daily digest` | `0 8 * * *` | yes |
| afternoon check-in | `Edge — ambient discovery (afternoon)` | `0 14 * * *` | no — opt-in |
| evening check-in | `Edge — ambient discovery (evening)` | `0 20 * * *` | no — opt-in |
```

To:

```markdown
| display name | cron name pattern | default schedule | installed by default? |
|---|---|---|---|
| morning digest | `{name} — daily digest` | `0 8 * * *` | yes |
| afternoon check-in | `{name} — ambient discovery (afternoon)` | `0 14 * * *` | no — opt-in |
| evening check-in | `{name} — ambient discovery (evening)` | `0 20 * * *` | no — opt-in |

`{name}` is your display name from `IDENTITY.md`.
```

- [ ] **Step 4: Update the "Reading current state" section (line 19)**

Change:

```markdown
Run `hermes cron list`. Filter to jobs whose `name` starts with `Edge —`.
```

To:

```markdown
Run `hermes cron list`. Filter to jobs whose `skill` is `index-network`.
```

- [ ] **Step 5: Update the "Enabling an opt-in pass" section (lines 33-41)**

In the `hermes cron create` example commands, replace the hardcoded `--name "Edge — ..."` with a comment indicating the name comes from `IDENTITY.md`:

Change:

```
hermes cron create "0 14 * * *" "$(cat ~/.hermes/skills/index-network/prompts/ambient.md)" \
  --name "Edge — ambient discovery (afternoon)" \
  --skill index-network \
  --deliver telegram \
  --workdir ~/.hermes
```

To:

```
hermes cron create "0 14 * * *" "$(cat ~/.hermes/skills/index-network/prompts/ambient.md)" \
  --name "{name} — ambient discovery (afternoon)" \
  --skill index-network \
  --deliver telegram \
  --workdir ~/.hermes
```

And change:

```markdown
For the evening pass, use schedule `"0 20 * * *"` and `--name "Edge — ambient discovery (evening)"`.
```

To:

```markdown
For the evening pass, use schedule `"0 20 * * *"` and `--name "{name} — ambient discovery (evening)"`. `{name}` is your display name from `IDENTITY.md`.
```

- [ ] **Step 6: Update the "Rules" section (line 69)**

Change:

```markdown
- Only three Edge cron names exist (`Edge — daily digest`, `Edge — ambient discovery (afternoon)`, `Edge — ambient discovery (evening)`). Do not invent more.
```

To:

```markdown
- Only three cron jobs exist (`{name} — daily digest`, `{name} — ambient discovery (afternoon)`, `{name} — ambient discovery (evening)`). Do not invent more.
```

- [ ] **Step 7: Commit**

```bash
git add packages/edge-hermes/workspace/SCHEDULE.md
git commit -m "feat(edge-hermes): remove hardcoded name from SCHEDULE.md, use skill-based cron ID"
```

---

### Task 4: Update skill files (bootstrap, prompts, exemplars)

Remove hardcoded "Edge" agent name from all Index Network skill files.

**Files:**
- Modify: `packages/edge-hermes/skills/index-network/bootstrap.md`
- Modify: `packages/edge-hermes/skills/index-network/prompts/welcome.md`
- Modify: `packages/edge-hermes/skills/index-network/prompts/digest.md`
- Modify: `packages/edge-hermes/skills/index-network/prompts/ambient.md`
- Modify: `packages/edge-hermes/skills/index-network/exemplars.md`

- [ ] **Step 1: Update bootstrap.md line 3**

Change:

```markdown
_You're Edge, the agent for Edge Esmeralda. Your tools, channels, and schedule are already in place — call MCP tools directly, never try to register, configure, or repair anything._
```

To:

```markdown
_You are the agent for Edge Esmeralda. Read your display name from `IDENTITY.md`. Your tools, channels, and schedule are already in place — call MCP tools directly, never try to register, configure, or repair anything._
```

- [ ] **Step 2: Update bootstrap.md Step 1 greeting (line 22)**

Change:

```markdown
> "Welcome to Edge Esmeralda. I'm Edge, your agent. I help the right people find you, help you find them, and answer anything you need about the village."
```

To:

```markdown
> "Welcome to Edge Esmeralda. I'm {your display name}, your agent. I help the right people find you, help you find them, and answer anything you need about the village."
```

- [ ] **Step 3: Update bootstrap.md line 93 (rules section)**

Change:

```markdown
- Edge is Edge Esmeralda's agent. Do not invite users to other communities, do not list networks — Edge Esmeralda is the only frame.
```

To:

```markdown
- You are Edge Esmeralda's agent. Do not invite users to other communities, do not list networks — Edge Esmeralda is the only frame.
```

- [ ] **Step 4: Update welcome.md line 1**

Change:

```markdown
You are Edge, the user's agent on the Index protocol. This run is the user's one-time welcome pass.
```

To:

```markdown
You are the user's agent on the Index protocol. Read your display name from `IDENTITY.md`. This run is the user's one-time welcome pass.
```

- [ ] **Step 5: Update welcome.md line 44**

Change:

```markdown
- Never repeat the agent intro from `bootstrap.md` Step 1 ("I'm Edge, your agent. I help the right people…") — the user already met you. The welcome opener is just `Welcome to Edge Esmeralda` and the community context paragraph.
```

To:

```markdown
- Never repeat the agent intro from `bootstrap.md` Step 1 — the user already met you. The welcome opener is just `Welcome to Edge Esmeralda` and the community context paragraph.
```

- [ ] **Step 6: Update digest.md line 1**

Change:

```markdown
You are Edge, the user's agent on the Index protocol. This is the user's daily brief — delivered to the user's chat at whatever time of day the user has scheduled it.
```

To:

```markdown
You are the user's agent on the Index protocol. Read your display name from `IDENTITY.md`. This is the user's daily brief — delivered to the user's chat at whatever time of day the user has scheduled it.
```

- [ ] **Step 7: Update ambient.md line 1**

Change:

```markdown
You are Edge, the user's agent on the Index protocol. This is an ambient discovery pass — fired twice daily at 14:00 and 20:00 host-local.
```

To:

```markdown
You are the user's agent on the Index protocol. Read your display name from `IDENTITY.md`. This is an ambient discovery pass — fired twice daily at 14:00 and 20:00 host-local.
```

- [ ] **Step 8: Update exemplars.md line 7**

Change:

```markdown
The welcome opener is a **single line** — `Welcome to Edge Esmeralda`. Do NOT repeat the agent intro from `bootstrap.md` Step 1 ("I'm Edge, your agent. I help the right people find you, help you find them, and answer anything you need about the village") — the user already met you minutes ago, repeating it reads as filler.
```

To:

```markdown
The welcome opener is a **single line** — `Welcome to Edge Esmeralda`. Do NOT repeat the agent intro from `bootstrap.md` Step 1 — the user already met you minutes ago, repeating it reads as filler.
```

- [ ] **Step 9: Commit**

```bash
git add packages/edge-hermes/skills/index-network/bootstrap.md \
      packages/edge-hermes/skills/index-network/prompts/welcome.md \
      packages/edge-hermes/skills/index-network/prompts/digest.md \
      packages/edge-hermes/skills/index-network/prompts/ambient.md \
      packages/edge-hermes/skills/index-network/exemplars.md
git commit -m "feat(edge-hermes): remove hardcoded agent name from skill files"
```

---

### Task 5: Update installer TypeScript (`paths.ts`, `install.ts`, `install_index.ts`, `reset.ts`)

Switch cron identification to skill-based filtering, make cron display names configurable, copy IDENTITY.md.

**Files:**
- Modify: `packages/edge-hermes/install/paths.ts`
- Modify: `packages/edge-hermes/install/install.ts`
- Modify: `packages/edge-hermes/install/install_index.ts`
- Modify: `packages/edge-hermes/install/reset.ts`

- [ ] **Step 1: Update `paths.ts`**

Replace `CRON_NAME_PREFIX` with two helpers. The full file becomes:

```typescript
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Hermes data root (`HERMES_HOME` or `~/.hermes`). */
export function hermesHome(): string {
  return process.env.HERMES_HOME?.trim() || join(homedir(), ".hermes");
}

/** Edge project context + memory — flat under `$HERMES_HOME` (Hermes default layout). */
export function targetWorkspace(): string {
  return hermesHome();
}

export function skillsDir(): string {
  return join(hermesHome(), "skills");
}

/** Skill bundles shipped by this repo (installed into `$HERMES_HOME/skills/<name>/`). */
export const EDGE_SKILL_NAMES = ["index-network", "edgeos", "edge-esmeralda"] as const;

/** Build a cron display-name prefix from the agent's display name. */
export function cronDisplayPrefix(name: string): string {
  return `${name} —`;
}

/**
 * Read the agent display name from IDENTITY.md in the target workspace.
 * Returns the value after "Display name:" or "Edge" if empty/missing.
 */
export function readIdentityName(home: string): string {
  const identityPath = join(home, "IDENTITY.md");
  if (!existsSync(identityPath)) return "Edge";
  const content = readFileSync(identityPath, "utf8");
  const match = content.match(/^Display name:\s*(.+)$/m);
  const name = match?.[1]?.trim();
  return name || "Edge";
}
```

- [ ] **Step 2: Update `install.ts` to copy IDENTITY.md with preservation**

In `copyWorkspaceFiles`, add `IDENTITY.md` to the same preservation logic as `USER.md`. Change the condition on line 96:

```typescript
    if (entry === "USER.md" && !wipeUser && existsSync(targetPath)) {
```

To:

```typescript
    if ((entry === "USER.md" || entry === "IDENTITY.md") && !wipeUser && existsSync(targetPath)) {
```

And update the log message on line 106:

```typescript
  if (preservedUserNotes) {
    console.log("  (USER.md preserved — pass --wipe-user to overwrite it)");
  }
```

To:

```typescript
  if (preservedUserNotes) {
    console.log("  (USER.md and IDENTITY.md preserved — pass --wipe-user to overwrite)");
  }
```

Also add `IDENTITY.md` to the `--wipe-user` state cleanup. In the `filesToWipe` array (line 110), add:

```typescript
      join(TARGET_HOME, "IDENTITY.md"),
```

Wait — actually `IDENTITY.md` is a workspace file, not a state file. On `--wipe-user`, the loop already re-copies workspace `.md` files (line 100 `copyFileSync`). The preservation guard on line 96 only fires when `!wipeUser`. So when `--wipe-user` is set, IDENTITY.md will be overwritten by the fresh template (with empty display name). No additional wipe logic needed — just the preservation guard change.

Remove the `IDENTITY.md` addition to `filesToWipe`. The guard change is sufficient.

- [ ] **Step 3: Update `install_index.ts` — configurable cron names and skill-based filtering**

First, update imports. Change:

```typescript
import { CRON_NAME_PREFIX, hermesHome } from "./paths";
```

To:

```typescript
import { EDGE_SKILL_NAMES, cronDisplayPrefix, hermesHome, readIdentityName } from "./paths";
```

Then update `removeEdgeCronJobs` to use skill-based filtering. Change line 61:

```typescript
  const edgeJobs = (parsed.jobs ?? []).filter((j) => j.name.startsWith(CRON_NAME_PREFIX));
```

To:

```typescript
  const skillSet = new Set<string>(EDGE_SKILL_NAMES);
  const edgeJobs = (parsed.jobs ?? []).filter((j) => j.skill && skillSet.has(j.skill));
```

The `j.skill` type needs updating too. Change line 53:

```typescript
  let parsed: { jobs?: Array<{ id: string; name: string }> };
```

To:

```typescript
  let parsed: { jobs?: Array<{ id: string; name: string; skill?: string }> };
```

Then update `installCronJobs` to use the configured display name. After line 88 (`const digestMessage = ...`), add:

```typescript
  const agentName = readIdentityName(home);
  const cronName = `${cronDisplayPrefix(agentName)} daily digest`;
```

And change line 111 (the `--name` argument in the `execFileSync` call):

```typescript
        "--name",
        "Edge — daily digest",
```

To:

```typescript
        "--name",
        cronName,
```

- [ ] **Step 4: Update `reset.ts` — skill-based cron filtering and IDENTITY.md cleanup**

Update imports. Change:

```typescript
import {
  CRON_NAME_PREFIX,
  EDGE_SKILL_NAMES,
  hermesHome,
  skillsDir,
  targetWorkspace,
} from "./paths";
```

To:

```typescript
import {
  EDGE_SKILL_NAMES,
  hermesHome,
  skillsDir,
  targetWorkspace,
} from "./paths";
```

Update `removeCronJobs` — change the type on line 53:

```typescript
  let parsed: { jobs?: Array<{ id: string; name: string }> };
```

To:

```typescript
  let parsed: { jobs?: Array<{ id: string; name: string; skill?: string }> };
```

Change the filter on line 61:

```typescript
  const edgeJobs = (parsed.jobs ?? []).filter((j) => j.name.startsWith(CRON_NAME_PREFIX));
```

To:

```typescript
  const skillSet = new Set<string>(EDGE_SKILL_NAMES);
  const edgeJobs = (parsed.jobs ?? []).filter((j) => j.skill && skillSet.has(j.skill));
```

Update the "no jobs" log on line 63:

```typescript
    console.log("→ no Edge cron jobs found");
```

To:

```typescript
    console.log("→ no cron jobs found for managed skills");
```

Add `IDENTITY.md` to `PROJECT_FILES` on line 28:

```typescript
const PROJECT_FILES = ["AGENTS.md", "SCHEDULE.md"];
```

To:

```typescript
const PROJECT_FILES = ["AGENTS.md", "IDENTITY.md", "SCHEDULE.md"];
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd packages/edge-hermes && npx tsc --noEmit
```

If `tsc` is not configured in this package, verify with:

```bash
cd packages/edge-hermes && bun run install/paths.ts 2>&1 | head -5
```

The import should resolve without errors.

- [ ] **Step 6: Commit**

```bash
git add packages/edge-hermes/install/paths.ts \
      packages/edge-hermes/install/install.ts \
      packages/edge-hermes/install/install_index.ts \
      packages/edge-hermes/install/reset.ts
git commit -m "feat(edge-hermes): configurable cron names and skill-based filtering in installer"
```

---

### Task 6: Verify no remaining hardcoded "Edge" agent name references

Grep for stray "Edge" references that should have been updated.

- [ ] **Step 1: Grep for agent-name "Edge" in workspace and skill files**

```bash
cd packages/edge-hermes && grep -rn '"Edge"' workspace/ skills/index-network/ --include="*.md" | grep -v "Edge Esmeralda" | grep -v "Edge City" | grep -v "edge-esmeralda" | grep -v "edge-state"
```

Expected: no results. Any match is a stray hardcoded agent name that needs updating.

Also check for "I'm Edge" and "You are Edge" and "You — Edge —" patterns:

```bash
cd packages/edge-hermes && grep -rn -E "(I'm Edge|You are Edge|You — Edge)" workspace/ skills/index-network/ --include="*.md"
```

Expected: no results.

- [ ] **Step 2: Grep for `CRON_NAME_PREFIX` in TypeScript**

```bash
cd packages/edge-hermes && grep -rn "CRON_NAME_PREFIX" install/
```

Expected: no results. All references should have been replaced with skill-based filtering.

- [ ] **Step 3: Fix any stray references found**

If any matches are found in steps 1-2, update those files. If none found, skip this step.

- [ ] **Step 4: Commit (if changes were made)**

```bash
git add -A packages/edge-hermes/
git commit -m "fix(edge-hermes): remove remaining hardcoded agent name references"
```
