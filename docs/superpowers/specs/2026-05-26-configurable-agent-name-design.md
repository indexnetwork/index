# Configurable Agent Name in edge-hermes

**Issue:** IND-344
**Date:** 2026-05-26
**Scope:** Agent display name only. Community name ("Edge Esmeralda"), organization ("Edge City"), and popup-specific content are out of scope.

## Problem

The agent name "Edge" is hardcoded across workspace files, cron prompts, exemplars, bootstrap, and installer code in `packages/edge-hermes/`. This couples the package to one deployment. A different community reusing the same workspace would need to fork and find-replace across 10+ files.

## Design

### Config surface: `IDENTITY.md`

A new `workspace/IDENTITY.md` file holds the agent's display name, following the established pattern in `packages/edgeclaw/workspace/IDENTITY.md`. The file has a `Display name:` field that defaults to empty.

```markdown
# Agent Identity

Display name: 

You are a personal agent for one attendee of **Edge Esmeralda 2026**. You keep their signals current and surface opportunities worth interrupting them for. Edge Esmeralda is the only community in scope.

You are paired with one human. You know what they care about (from onboarding), and you have access to the village's shared knowledge layer (calendar, directory, governance via skills).

**You do:** navigate schedule, wiki, and directory; suggest sessions and people; answer village questions; RSVP with confirmation; surface community decisions; coordinate intros via Index.

**You do not:** send messages without confirmation; spend beyond their token limit; share private info without opt-in; pretend to be the human (always identify as their agent).
```

The "You do / You do not" and role description content moves here from AGENTS.md lines 3-9. AGENTS.md keeps workspace config (skills, gates, memory, crons). SOUL.md keeps voice and personality.

### Name gate (first-message gate 0)

A new gate runs before all existing gates in AGENTS.md. It reads `IDENTITY.md` and checks the `Display name:` field:

- **If empty:** ask the user what they'd like to call the agent. Suggest "Edge" as the default. Write the chosen name to `Display name:` in `IDENTITY.md`. Log `[gate] identity: triggered, name set to <name>` to `memory/YYYY-MM-DD.md`.
- **If already set:** skip. Log `[gate] identity: skipped (name present)`.

The gate runs once — after the user picks a name, subsequent sessions skip it. The user can rename the agent later by editing `IDENTITY.md` directly.

Gate text (when the name is not yet set and no other gate has provided framing):

> "Before we get started — what would you like to call me? Something like 'Edge' works, or pick whatever feels right."

### File changes

Every file that hardcodes "Edge" as the agent name changes to reference `IDENTITY.md` instead. The specific changes:

#### `workspace/IDENTITY.md` (new file)

Created with the content above. The `Display name:` field starts empty. Role description and "you do / you do not" move here from AGENTS.md.

#### `workspace/AGENTS.md`

- **Lines 3-9** (identity + role): replaced with a reference to IDENTITY.md. Opening becomes: "Read `IDENTITY.md` for your display name and role. Use your display name whenever you refer to yourself."
- **Line 46** (edge schedule gate dialogue): the line `"I'm Edge — I help the right people find you..."` becomes `"I'm {your display name} — I help the right people find you..."` — the agent reads the name from IDENTITY.md.
- **First-message gates section**: a new gate 0 (name gate) is inserted before the existing gates. Existing gates renumber: index-network becomes gate 1, welcome becomes gate 2, edge schedule becomes gate 3.
- **Session context section**: add `IDENTITY.md` to the list of files not to re-read unless needed (matching edgeclaw's pattern on its line 37).
- **Continuity references** in SOUL.md line 33 style: add `IDENTITY.md` to the list of persistence files.

#### `workspace/SOUL.md`

- **Line 3**: `You — Edge — are a private agent.` → `You are a private agent. Your display name is in IDENTITY.md — use it whenever you refer to yourself.`
- **Line 11**: `you are Edge, the agent for *Edge Esmeralda*` → `you are the user's agent for *Edge Esmeralda*` (the display name comes from IDENTITY.md, no need to repeat it in the plumbing rule).
- **Line 13**: add `IDENTITY.md` to the list of workspace files never to mention to the user.
- **Line 33** (Continuity): add `IDENTITY.md` to the list of persistence files.

#### `workspace/SCHEDULE.md`

- **Line 1**: `Edge installs one cron by default` → `One cron is installed by default`
- **Line 9**: `The Edge crons are the ones whose name starts with Edge —` → cron identification changes to skill-based filtering (see Cron naming below). The table of cron names updates to use a configurable prefix pattern.
- **Lines 19, 69**: references to `Edge —` prefix in cron names update to match the new naming scheme.

#### `skills/index-network/bootstrap.md`

- **Line 3**: `You're Edge, the agent for Edge Esmeralda.` → `You are the agent for Edge Esmeralda. Read your display name from IDENTITY.md.`
- **Line 22** (Step 1 greeting): `"I'm Edge, your agent."` → `"I'm {your display name}, your agent."` — the agent reads the name from IDENTITY.md before composing the greeting.

#### `skills/index-network/prompts/welcome.md`

- **Line 1**: `You are Edge, the user's agent on the Index protocol.` → `You are the user's agent on the Index protocol. Read your display name from IDENTITY.md.`
- **Line 44**: the "never repeat" warning references the display name generically instead of quoting "I'm Edge".

#### `skills/index-network/prompts/digest.md`

- **Line 1**: `You are Edge, the user's agent on the Index protocol.` → `You are the user's agent on the Index protocol. Read your display name from IDENTITY.md.`
- **Lines 13-16**: the greeting table (`Good morning from Edge Esmeralda`) stays as-is — this is the community name, not the agent name.

#### `skills/index-network/prompts/ambient.md`

- **Line 1**: `You are Edge, the user's agent on the Index protocol.` → `You are the user's agent on the Index protocol. Read your display name from IDENTITY.md.`

#### `skills/index-network/exemplars.md`

- **Line 7**: the "do NOT repeat the agent intro" warning updates to reference the display name generically.
- All other "Edge Esmeralda" references stay — those are the community name, not the agent name.

### Cron naming

#### Display names

Cron display names currently hardcode "Edge —" as a prefix. They change to use the configured agent name:

| current | after |
|---------|-------|
| `Edge — daily digest` | `{name} — daily digest` |
| `Edge — ambient discovery (afternoon)` | `{name} — ambient discovery (afternoon)` |
| `Edge — ambient discovery (evening)` | `{name} — ambient discovery (evening)` |

At install time, the installer reads the `Display name:` field from `workspace/IDENTITY.md`. If empty, it falls back to `"Edge"` as the default prefix. The name gate can later rename the crons if the user picks a different name.

#### Cron identification (reset script)

The reset script (`install/reset.ts`) currently filters crons by `CRON_NAME_PREFIX` ("Edge —"). This breaks if the user renames the agent.

The fix: filter by the `--skill` value instead. All edge-hermes crons use `--skill index-network`. The reset script reads `jobs.json` and filters for jobs whose skill matches one of `EDGE_SKILL_NAMES`. This is stable regardless of display name.

`CRON_NAME_PREFIX` in `paths.ts` is replaced with a `cronDisplayPrefix(name: string)` helper that formats `"{name} —"`.

#### Name gate cron rename

When the name gate fires and the user picks a name different from the current cron prefix, the agent renames existing crons. AGENTS.md gate instructions tell the agent to:

1. Run `hermes cron list`
2. Find crons belonging to edge-hermes skills
3. Rename them with the new prefix via `hermes cron edit <id> --name "{name} — ..."`

If rename fails (Hermes doesn't support `--name` on edit), the crons keep working under the old name. This is cosmetic, not functional.

### Installer changes

#### `install/install.ts`

- Add `IDENTITY.md` to the list of workspace files copied to `$HERMES_HOME/`. Same preservation logic as `USER.md`: if it already exists and `--wipe-user` is not passed, keep it (preserves the user's chosen name across re-installs).

#### `install/paths.ts`

- Remove `CRON_NAME_PREFIX` constant.
- Add `cronDisplayPrefix(name: string): string` → returns `"{name} —"`.
- Add `readIdentityName(hermesHome: string): string` → reads `IDENTITY.md` from the target workspace and parses the `Display name:` field. Returns the value or `"Edge"` if empty/missing.

#### `install/install_index.ts`

- Read the display name via `readIdentityName()` when composing cron names.
- `removeEdgeCronJobs()` switches from prefix-based filtering to skill-based filtering.

#### `install/reset.ts`

- `removeCronJobs()` switches from `CRON_NAME_PREFIX` filtering to skill-based filtering (jobs whose skill is in `EDGE_SKILL_NAMES`).
- Add `IDENTITY.md` to `PROJECT_FILES` so it gets cleaned up on reset.

## What does not change

- Community name ("Edge Esmeralda 2026") — hardcoded in AGENTS.md, IDENTITY.md, exemplars, skills. Out of scope.
- Organization name ("Edge City") — plugin metadata. Out of scope.
- Skill directory names (`edge-esmeralda`, `edgeos`, `index-network`) — internal identifiers.
- The `edge-state.json` / `edgeOnboardingCompletedAt` key names — internal state markers.
- Voice and personality in SOUL.md — unchanged except removing the hardcoded name.
- The content and structure of all prompts (welcome, digest, ambient) — only the opening "You are Edge" line changes.

## Default behavior

When no name is configured (fresh install, name gate not yet run):

- The agent has no display name until the gate fires.
- The installer falls back to "Edge" for cron display names.
- The first conversation triggers the name gate before anything else. The user picks a name, and everything downstream uses it.
- If the user accepts the suggested default ("Edge"), behavior is identical to today.
