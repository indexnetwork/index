# EdgeClaw — Skills Extraction Design

**Date:** 2026-05-15
**Status:** Draft, awaiting review
**Owner:** Yankı

## Context

`packages/edgeclaw/` ships an OpenClaw "flavour" for Edge Esmeralda 2026. Today the `workspace/` bundle that gets staged into `~/.openclaw/workspace/` mixes three concerns:

1. **Cross-backend agent core** — `IDENTITY.md`, `SOUL.md`, `COMMUNITY.md`, `USER.md`, plus the generic skeletons of `AGENTS.md`, `BOOTSTRAP.md`, `HEARTBEAT.md`, `TOOLS.md`.
2. **Index-specific procedural knowledge** — `TOOLS.md`'s tool-family list, the `AGENTS.md` voice exemplars, all six Index-tool steps in `BOOTSTRAP.md`, the two Index-tool heartbeat tasks in `HEARTBEAT.md`.
3. **Index-specific cron prompts** — `workspace/prompts/{welcome,digest,ambient}.md`.

`packages/edgeclaw/skills/` exists in the package layout (declared in `package.json#files`) but is empty (`.gitkeep`). The result: every `workspace/*.md` is implicitly Index-coupled, and there is no home for the equivalent EdgeOS or Geo content once those backends wire up.

Upstream, `Edge-City/edgeclaw#2` (Tim Kosters, draft) establishes a convention by adding the first EdgeOS skill bundle. We adopt that convention here and apply it to the Index content already present in the monorepo subtree.

## Convention (inherited from PR #2)

PR #2 sets four conventions we mirror:

1. **`skills/<backend>/` at the package root** holds flat markdown reference files. **No `SKILL.md` frontmatter.** This is *documentation*, not AgentSkills-mechanism skills.
2. **`install.ts` gains a generic `copyMarkdownTree` helper** plus a `copySkillFiles()` step that recursively copies `packages/edgeclaw/skills/` into `~/.openclaw/workspace/skills/`. Per-backend `install_<x>.ts` files do not stage skill files themselves.
3. **Discovery is via `workspace/TOOLS.md` pointers**, not OpenClaw's skill manifest. `TOOLS.md` is in OpenClaw's always-loaded set, so adding bullets like `- skills/edgeos/auth.md — … Read this before calling protected EdgeOS endpoints.` makes the files reliably findable without depending on description-match heuristics.
4. **Per-backend `install_<x>.ts` placeholders** document expected env vars and credential shape even when the function is a no-op.

The Anthropic AgentSkills/`SKILL.md` route was considered and rejected for this work: PR #2's convention is simpler, equally effective given TOOLS.md's always-loaded status, and aligns with what's about to land upstream. SKILL.md scaffolding may be added later if `openclaw skills list` discoverability becomes useful.

## Target layout

```
packages/edgeclaw/
├── workspace/                          # always-loaded core (cross-backend)
│   ├── IDENTITY.md                     # unchanged
│   ├── SOUL.md                         # unchanged
│   ├── COMMUNITY.md                    # unchanged
│   ├── USER.md                         # unchanged
│   ├── AGENTS.md                       # SLIMMED — voice exemplars and red lines move out
│   ├── BOOTSTRAP.md                    # SLIMMED — onboarding ritual moves out, this becomes a thin shell
│   ├── HEARTBEAT.md                    # SLIMMED — Index tasks move out
│   └── TOOLS.md                        # SLIMMED — Index entity model and tool families move out; channel formatting + URL preservation + new pointers stay
└── skills/
    └── index-network/
        ├── README.md                   # overview, MCP URL, file index
        ├── tools.md                    # MCP tool families, entity model, scrape_url usage, output translation
        ├── exemplars.md                # canonical welcome / digest / ambient voice samples + greeting drafts
        ├── bootstrap.md                # the six-step onboarding ritual (create_user_profile → complete_onboarding → welcome pass)
        ├── heartbeat.md                # accepted-opportunities and signal-freshness task definitions
        └── prompts/                    # cron prompts (read by `cat` from install_index.ts)
            ├── welcome.md
            ├── digest.md
            └── ambient.md
```

Sibling backends (`skills/edgeos/`, `skills/geo/`) land later via PR #2 and a follow-on.

## Per-file content migration

### `workspace/TOOLS.md`

| Section | Action | Destination |
|---|---|---|
| `# TOOLS.md — Local Notes` preamble | Keep | — |
| `## Index protocol MCP` (overview + "preinstalled, your only tool surface" framing) | **Move** | `skills/index-network/tools.md` |
| `### Tool families` (all 10 tool family bullets) | **Move** | `skills/index-network/tools.md` |
| `### scrape_url — when to use it` (4 bullets + example) | **Move** | `skills/index-network/tools.md` |
| `### Output translation` (table + "Never expose internal IDs" rule) | **Move** | `skills/index-network/tools.md` |
| `## Local files` bullets (COMMUNITY, memory/*, MEMORY.md) | Keep, expand | — |
| New bullets pointing at `skills/index-network/{tools,exemplars,bootstrap,heartbeat}.md` | **Add** | TOOLS.md |
| `## Channel formatting` (Discord / WhatsApp / Telegram rules) | Keep | — |
| `## URL preservation` (strip-the-URLs test, button-strip prohibition) | Keep | — |

Result: TOOLS.md ~25–30 lines (channel formatting + URL preservation + Local files + skill pointers).

### `workspace/AGENTS.md`

| Section | Action | Destination |
|---|---|---|
| `# AGENTS.md — Your Workspace` preamble | Keep, reword | drop "on the Index protocol" framing → backend-agnostic |
| `## First run` (onboardingComplete gate via `read_user_profiles()`) | **Move** | `skills/index-network/bootstrap.md` (this is part of the Index onboarding ritual). `AGENTS.md` keeps a one-line pointer: "If your active skill has a bootstrap ritual, follow it before any other work." |
| `## Session startup` (runtime context, no pre-fetch rule) | Keep | — |
| `## Memory` (daily notes, MEMORY.md scope, heartbeat-state.json, welcome-state.json) | Keep | — |
| `## How you talk to the protocol` (3 lines, MCP-shaped) | Keep, reword | "Each wired backend exposes its tools via MCP. Tool descriptions are authoritative; read them." |
| `## Surfacing opportunities (visible)` quality-bar paragraph | Keep | — |
| `### Canonical voice exemplars` heading + Welcome / Digest / Ambient blocks (~75 lines) | **Move** | `skills/index-network/exemplars.md` |
| `#### Greeting drafts` subsection (~12 lines) | **Move** | `skills/index-network/exemplars.md` |
| `## Red lines` bullets — generic (no raw JSON, no accept without approval, trash > rm, no link strips) | Keep | — |
| `## Red lines` bullets — Index-specific (`discover_opportunities` during bootstrap, `connector-flow` greeting rule) | **Move** | `skills/index-network/exemplars.md` and `skills/index-network/bootstrap.md` respectively |
| `## Group chats` (no MEMORY.md, no discovery in shared sessions) | Keep | — |
| `## Make it yours` (3 lines) | Keep | — |

Result: AGENTS.md ~30–40 lines.

### `workspace/BOOTSTRAP.md`

The current file is ~85 lines and almost entirely Index-tool-shaped (Steps 1, 2, 4, 6 directly call Index tools; Step 3 calls `update_user_profile`; Step 5 references `create_user_profile`). The right shape is:

- **`workspace/BOOTSTRAP.md`** (~10 lines) becomes a thin shell: "When `read_user_profiles().onboardingComplete === false`, run the bootstrap ritual in your active skill. For Index Network, that is `skills/index-network/bootstrap.md`. Do not invent your own ritual. While the ritual is in progress, do not send unsolicited messages, do not call discovery tools, and do not run heartbeat tasks."
- **`skills/index-network/bootstrap.md`** holds the full Step 1–6 ritual unchanged. It is also where the `## First run` block from `AGENTS.md` migrates.

### `workspace/HEARTBEAT.md`

| Section | Action | Destination |
|---|---|---|
| Intro paragraph (gateway tick, NO_REPLY contract) | Keep | — |
| `> NO_REPLY discipline.` blockquote (sentinel matching rules) | Keep | — |
| Cadence note about morning digest / ambient passes | Keep, reword | "Backend-specific fixed-time flows arrive as their own dispatches. For Index Network they are documented in `skills/index-network/prompts/{digest,ambient}.md`." |
| `accepted-opportunities` task | **Move** | `skills/index-network/heartbeat.md` |
| `signal-freshness` task | **Move** | `skills/index-network/heartbeat.md` |
| `memory-curation` task | Keep | — |
| `# Additional instructions` (quality, no filler, late-night defer, group-chat skip, idempotency, MCP failure handling) | Keep | — |
| MCP failure handling line (mentions `index` tools specifically) | Reword | "If a backend MCP is unreachable, reply `NO_REPLY`, write a one-line note in `memory/<today>.md`, and stop." |
| Pointer "for backend-specific heartbeat tasks, read your skills" | **Add** | HEARTBEAT.md |

Result: HEARTBEAT.md ~30–35 lines.

### `workspace/prompts/`

Move all three files (`welcome.md`, `digest.md`, `ambient.md`) wholesale to `skills/index-network/prompts/`. Bodies unchanged. `install_index.ts` updates the cron `--message` paths from `${workspaceDir}/prompts/<x>.md` to `${workspaceDir}/skills/index-network/prompts/<x>.md`.

Inside the cron prompt bodies themselves, any internal references (e.g. `welcome.md`'s "mimic the Welcome exemplar in AGENTS.md exactly") update to point at the new location: `mimic the Welcome exemplar in skills/index-network/exemplars.md exactly`.

## Installer changes

### `install/install.ts`

Adopt PR #2's helper verbatim:

```ts
const SOURCE_SKILLS = join(SCRIPT_DIR, "../skills");
const TARGET_SKILLS = join(TARGET_WORKSPACE, "skills");

function copyMarkdownTree(sourceDir: string, targetDir: string): number {
  if (!existsSync(sourceDir)) return 0;
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
  let copied = 0;
  for (const entry of readdirSync(sourceDir)) {
    const sourcePath = join(sourceDir, entry);
    const targetPath = join(targetDir, entry);
    const stat = statSync(sourcePath);
    if (stat.isDirectory()) {
      copied += copyMarkdownTree(sourcePath, targetPath);
    } else if (entry.endsWith(".md")) {
      copyFileSync(sourcePath, targetPath);
      copied++;
    }
  }
  return copied;
}

function copySkillFiles(): void {
  const copied = copyMarkdownTree(SOURCE_SKILLS, TARGET_SKILLS);
  if (copied > 0) {
    console.log(`→ staged ${copied} skill files into ${TARGET_SKILLS}`);
  }
}
```

In `main()`, call `copySkillFiles()` between `copyWorkspaceFiles(wipeUser)` and `installIndex()` — same position as PR #2.

The top docstring gains a `Copy backend skill docs from skills/ into ~/.openclaw/workspace/skills/` bullet between the existing workspace-copy bullet and the backend-installer-call bullet.

### `install/install_index.ts`

Cron `--message` paths change from `${workspaceDir}/prompts/<x>.md` to `${workspaceDir}/skills/index-network/prompts/<x>.md`. Three replacements (digest, ambient afternoon, ambient evening). No other changes — `installCronJobs()` stays otherwise identical; MCP entry, env handling, idempotency-prune behaviour all unchanged.

### `install/install_edgeos.ts`, `install/install_geo.ts`

Untouched in this spec. EdgeOS receives its skill files via PR #2's merge; the placeholder install function changes alongside that. Geo waits for its backend wiring.

## README updates

`packages/edgeclaw/README.md`:

- `### What's here` — replace `- \`skills/\` — directory for backend-specific skill bundles` with `- \`skills/\`: backend-specific skill bundles. The Index Network bundle is shipped today; EdgeOS and Geo land alongside their backend wiring.`
- `## Install` numbered list — insert "Copies backend skill docs into `~/.openclaw/workspace/skills/`." between the current "Copies the workspace markdown bundle..." step and the cron step. Re-number the subsequent steps. (Identical to PR #2.)
- `## Workspace layout` table — drop the rows for the three `prompts/*.md` files (they live under `skills/index-network/prompts/` now). Update the `AGENTS.md`, `BOOTSTRAP.md`, `HEARTBEAT.md` row descriptions to reflect their slimmed scope. Add a `skills/index-network/` row pointing at its README.

## Sequencing with PR #2 (chosen path: parallel)

PR #2 is draft on `Edge-City/edgeclaw`; its merge is blocked on EdgeOS auth contract finalization, not on the structural convention. We ship the `install.ts` helper and the Index extraction in this monorepo on its own branch, structured identically to PR #2 so the subtree merges remain conflict-free.

When PR #2 lands upstream and the monorepo pulls the fork (`.github/workflows/pull-edgeclaw-subtree.yml`), the incoming diff is exactly the EdgeOS skill files (`skills/edgeos/{README,auth,calendar,rsvp,directory}.md`) plus README/AGENTS/HEARTBEAT additions that reference them — content we don't author. The `copyMarkdownTree`/`copySkillFiles` machinery is already in place, so no merge resolution beyond accepting new files.

If conflicts arise because PR #2 evolves before merge (e.g. helper renamed, install order changed), we update the monorepo branch to match the upstream shape before the subtree pull.

## Out of scope

- Adding `SKILL.md` frontmatter or registering bundles via OpenClaw's official skill manifest. Reconsidered later if `openclaw skills list` discoverability matters.
- Authoring EdgeOS or Geo skill files. EdgeOS comes from PR #2; Geo waits for backend wiring.
- Changing the cron schedule, the Telegram session-binding logic, or the gateway-restart sequence.
- Touching `~/.openclaw/openclaw.json` config schema beyond what `install_index.ts` already writes.
- Changes to `@indexnetwork/protocol`, `backend/`, or anything outside `packages/edgeclaw/`.
- Bumping package versions — that's a release-time concern handled by the finishing-a-branch workflow, not this spec.

## Risks

1. **Lazy-loaded voice exemplars.** Today the canonical Welcome/Digest/Ambient exemplars are in always-loaded `AGENTS.md`; after extraction they live in `skills/index-network/exemplars.md` and the agent only reads them when guided by AGENTS.md's pointer or by the cron prompts' explicit references. Cron prompts already reference them explicitly, so the cron path is safe. Free-form chat asking for a digest-style summary depends on the agent following the TOOLS.md pointer. Mitigation: make the TOOLS.md pointer phrasing strong enough to compel the read ("Read this whenever composing welcome / digest / ambient framing").
2. **Workspace-skills directory naming overlap.** `~/.openclaw/workspace/skills/` is OpenClaw's reserved workspace-skills location, but we're populating it with reference docs that lack `SKILL.md` frontmatter. OpenClaw's skill loader will scan the directory and find no `SKILL.md` per subdirectory. Expected behaviour: silent skip. We verify this in baseline testing — if OpenClaw warns or errors, we either rename the package directory (e.g. `references/` instead of `skills/`) or add a minimal `SKILL.md` stub per backend. PR #2 hasn't reported issues with this overlap upstream.
3. **In-flight `BOOTSTRAP.md` ritual.** Users mid-onboarding when this ships have a `~/.openclaw/workspace/BOOTSTRAP.md` referencing Step 1–6. After re-install, the workspace file is the new thin shell and the steps live in `skills/index-network/bootstrap.md`. The session-start gate (`onboardingComplete: false` triggers ritual) and the staged-but-not-deleted file convention both survive intact. We verify by walking through the install → first-message path.
4. **PR #2 evolves before merge.** If Tim renames `copyMarkdownTree` or moves the call site before merging upstream, the monorepo branch needs a small follow-up to realign. Low risk: the helper is small and the call site is one line.
5. **Cron `cat` path breakage.** The cron `--message` is built at install time via `cat`. If `install_index.ts` ships a path update but the user runs an old `reset.ts` + new `install.ts` and the workspace skills directory is missing, `cat` fails silently and the cron emits an empty message. Mitigation: `copySkillFiles()` runs *before* `installIndex()` in `install.ts`, so the prompts directory exists before the cron is built. Verified in the install order section above.

## Acceptance criteria

- `bun build install/install.ts --target=bun` and `bun build install/reset.ts --target=bun` succeed.
- `npm pack --dry-run` (from `packages/edgeclaw/`) shows the new `skills/index-network/**/*.md` files included via the existing `"files": ["skills/", ...]` entry in `package.json`.
- Fresh install on a clean `~/.openclaw/` produces:
  - `~/.openclaw/workspace/skills/index-network/{README,tools,exemplars,bootstrap,heartbeat}.md` present.
  - `~/.openclaw/workspace/skills/index-network/prompts/{welcome,digest,ambient}.md` present.
  - `~/.openclaw/workspace/prompts/` absent.
  - Three EdgeClaw cron jobs registered, each with a non-empty `--message` body (verifiable via `openclaw cron list --json`).
  - `~/.openclaw/workspace/AGENTS.md`, `BOOTSTRAP.md`, `HEARTBEAT.md`, `TOOLS.md` shrunk to their slimmed forms with skill pointers present.
- Re-running `install.ts` is idempotent: same final state, the EdgeClaw cron jobs are pruned and re-added (existing behaviour preserved).
- `reset.ts` removes the skills directory it staged (currently it removes `~/.openclaw/workspace/`; subdirectory inheritance is automatic).
- Manual walk-through of the bootstrap ritual on a fresh user account: agent gates on `onboardingComplete: false`, reads `skills/index-network/bootstrap.md` via the AGENTS.md / BOOTSTRAP.md shell pointers, walks Steps 1–6, calls `complete_onboarding`, triggers the welcome pass, the welcome message lands on Telegram.

## Open question deferred to implementation

How aggressively to slim the `## How you talk to the protocol` paragraph in AGENTS.md. The current phrasing is Index-specific ("The Index protocol MCP is your only interface..."). Two options:

- **Generic rephrase**: "Each wired backend exposes its tools via MCP. Tool descriptions are authoritative; read them." — short, neutral, no per-backend assumptions.
- **Drop the paragraph entirely** and let the per-backend skill files carry the framing.

Resolve during implementation review — depends on how the EdgeOS skill ends up framing the same point. Default: generic rephrase.
