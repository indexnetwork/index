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

Upstream, `Edge-City/edgeclaw#2` (Tim Kosters, draft) introduces a first EdgeOS skill bundle. We reuse PR #2's per-capability file split and its `copyMarkdownTree` installer helper, but diverge from PR #2 on the discovery mechanism: we use OpenClaw's canonical AgentSkills `SKILL.md` frontmatter instead of flat reference files indexed from `TOOLS.md`.

## Convention (canonical OpenClaw AgentSkills route)

OpenClaw's canonical convention for workspace-staged skills is the AgentSkills-compatible `SKILL.md` per skill directory ([OpenClaw — creating skills](https://docs.openclaw.ai/tools/creating-skills), [OpenClaw — agent workspace](https://docs.openclaw.ai/concepts/agent-workspace), [OpenClaw — system prompt](https://docs.openclaw.ai/concepts/system-prompt)). Adopting it gives us four things PR #2's flat-files structure forfeits:

1. **Auto-discovery via the skill manifest.** OpenClaw injects every eligible skill's `name + description + path` into the system prompt at session start. The agent learns the skill exists from the manifest, not from a hand-maintained `TOOLS.md` pointer list.
2. **`metadata.openclaw.requires.config` self-gating.** The skill is automatically eligible *only when `mcp.servers.index` is configured in `~/.openclaw/openclaw.json`*. If a user hasn't run `install_index.ts`, the skill silently absents. No conditional logic to maintain.
3. **Workspace-precedence override.** `<workspace>/skills/index-network/` is the highest-precedence skill location ([OpenClaw — agent workspace](https://docs.openclaw.ai/concepts/agent-workspace)) and supersedes the bundled `packages/openclaw-plugin/skills/index-network/SKILL.md` by name — exactly the "flavour overrides plugin default" semantics we want.
4. **First-class skill commands.** `openclaw skills list`, `openclaw skills info index-network`, agent-level allowlists via `agents.list[].skills` all work without extra plumbing.

What we keep from PR #2:

- **Per-capability file split** inside each skill directory (`tools.md`, `exemplars.md`, `bootstrap.md`, `heartbeat.md`, `prompts/`). This is Anthropic's Pattern 1 progressive disclosure ([Anthropic — best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)): `SKILL.md` is the Tier 2 high-level guide, the sibling files are Tier 3 references loaded on demand.
- **`copyMarkdownTree` helper in `install.ts`** — recursive `.md` copy of the whole `skills/` tree. The helper works unchanged: `SKILL.md` is just another `.md` file from `copyMarkdownTree`'s perspective.
- **Per-backend `install_<x>.ts` placeholders** that document expected env vars and credential shape even when the function is a no-op.

What we diverge on from PR #2:

- **`SKILL.md` per backend bundle** instead of `README.md`. `README.md` does not register with OpenClaw's skill loader; `SKILL.md` does.
- **No `TOOLS.md` pointer bullets** to `skills/<backend>/*.md`. The skill manifest is the discovery surface; pointer bullets would be redundant and would diverge from canonical conventions.

We may upstream a follow-up to PR #2 (after it merges) adding `SKILL.md` to `skills/edgeos/` to align EdgeOS with the same canonical convention. That's a separate concern, out of scope for this spec.

## Target layout

```
packages/edgeclaw/
├── workspace/                          # always-loaded core (cross-backend)
│   ├── IDENTITY.md                     # unchanged
│   ├── SOUL.md                         # unchanged
│   ├── COMMUNITY.md                    # unchanged
│   ├── USER.md                         # unchanged
│   ├── AGENTS.md                       # SLIMMED — voice exemplars and Index-specific red lines move out
│   ├── BOOTSTRAP.md                    # SLIMMED — onboarding ritual moves out, this becomes a thin shell
│   ├── HEARTBEAT.md                    # SLIMMED — Index tasks move out
│   └── TOOLS.md                        # SLIMMED — Index entity model and tool families move out; channel formatting + URL preservation + Local-files index stay
└── skills/
    └── index-network/                  # OpenClaw workspace skill bundle
        ├── SKILL.md                    # frontmatter (name, description, requires.config) + Tier-2 high-level guide
        ├── tools.md                    # MCP tool families, entity model, scrape_url usage, output translation
        ├── exemplars.md                # canonical welcome / digest / ambient voice samples + greeting drafts
        ├── bootstrap.md                # the six-step onboarding ritual (create_user_profile → complete_onboarding → welcome pass)
        ├── heartbeat.md                # accepted-opportunities and signal-freshness task definitions
        └── prompts/                    # cron prompts (read by `cat` from install_index.ts, not by the agent in chat)
            ├── welcome.md
            ├── digest.md
            └── ambient.md
```

Sibling backends (`skills/edgeos/`, `skills/geo/`) land later — EdgeOS via PR #2's merge, Geo when its backend wires up. The `copyMarkdownTree` helper handles them automatically; whether they ship with `SKILL.md` is a separate upstream coordination question.

## `skills/index-network/SKILL.md` — shape

Frontmatter:

```yaml
---
name: index-network
description: Edge Esmeralda's Index Network bundle. Surfaces opportunities through a one-time welcome on first run, a daily 08:00 digest, twice-daily ambient passes at 14:00 and 20:00 (all host-local), and accepted-opportunity notifications on the heartbeat tick. Prunes stale signals weekly. Read when surfacing opportunities, drafting introductions, running onboarding for a new user, composing welcome / digest / ambient flows, or handling anything backed by the Index Network MCP (server `index`).
metadata:
  openclaw:
    requires:
      config:
        - mcp.servers.index
---
```

Notes:

- `name: index-network` deliberately matches `packages/openclaw-plugin/skills/index-network/SKILL.md`. Workspace-skill precedence ensures the EdgeClaw version wins on machines where both are installed — the "flavour overrides default" semantics OpenClaw's precedence model is built for.
- `description` is third-person, single line, ≤1024 chars (currently ~520). Includes what + when triggers as required by [Anthropic's best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices).
- `requires.config: mcp.servers.index` gates eligibility. Exact syntax (array of dotted paths vs. single string vs. object) is verified during implementation against OpenClaw's source or live behaviour — see Risks.

Body, ~25–30 lines, following Anthropic's Pattern 1 high-level guide:

```markdown
# Index Network — Edge Esmeralda

EdgeClaw's bundle for surfacing opportunities through Edge Esmeralda's Index Network integration. The Index Network MCP (server `index`) is the tool surface; this skill carries the Edge-flavored procedural knowledge for using it.

## When to read each file

- **Any non-trivial tool call** → [tools.md](tools.md). MCP tool families, entity model, `scrape_url` usage, output translation rules.
- **Composing user-facing opportunity renderings** → [exemplars.md](exemplars.md). Canonical welcome / daily digest / ambient discovery voice samples; greeting-draft format for `&msg=`.
- **`read_user_profiles().onboardingComplete === false`** → [bootstrap.md](bootstrap.md). Six-step onboarding ritual.
- **Heartbeat tick** → [heartbeat.md](heartbeat.md). Accepted-opportunity notifications and signal-freshness pruning.

Cron prompts in `prompts/` (`welcome.md`, `digest.md`, `ambient.md`) are loaded by the cron runner via `--message`; you do not read them yourself.

## Handoff

The MCP server's own instructions carry the protocol-level rules (voice, vocabulary, entity model, output translation). Tool descriptions are authoritative; read them before calling. This skill adds only Edge Esmeralda-specific framing on top — never duplicate the MCP's behavioural guidance here.
```

This mirrors the openclaw-plugin's `SKILL.md` handoff pattern: "Once the MCP is registered… do NOT duplicate or restate the MCP server's behavioural guidance here."

## Per-file content migration

### `workspace/TOOLS.md`

| Section | Action | Destination |
|---|---|---|
| `# TOOLS.md — Local Notes` preamble | Keep | — |
| `## Index protocol MCP` (overview + "preinstalled, your only tool surface") | **Move** | `skills/index-network/tools.md` |
| `### Tool families` (all 10 tool family bullets) | **Move** | `skills/index-network/tools.md` |
| `### scrape_url — when to use it` (4 bullets + example) | **Move** | `skills/index-network/tools.md` |
| `### Output translation` (table + "Never expose internal IDs" rule) | **Move** | `skills/index-network/tools.md` |
| `## Local files` bullets (COMMUNITY.md, memory/*, MEMORY.md) | Keep | — |
| `## Channel formatting` (Discord / WhatsApp / Telegram rules) | Keep | — |
| `## URL preservation` (strip-the-URLs test, button-strip prohibition) | Keep | — |

**No pointer bullets to `skills/index-network/*.md`** — OpenClaw's skill manifest carries discovery. Result: TOOLS.md ~25 lines (channel formatting + URL preservation + Local files).

### `workspace/AGENTS.md`

| Section | Action | Destination |
|---|---|---|
| `# AGENTS.md — Your Workspace` preamble | Keep, reword | drop "on the Index protocol" framing → backend-agnostic |
| `## First run` (onboardingComplete gate via `read_user_profiles()`) | **Move** | `skills/index-network/bootstrap.md`. AGENTS.md keeps a one-line generic pointer: "If your active skill has a bootstrap ritual, follow it before any other work." |
| `## Session startup` (runtime context, no pre-fetch rule) | Keep | — |
| `## Memory` (daily notes, MEMORY.md scope, heartbeat-state.json, welcome-state.json) | Keep | — |
| `## How you talk to the protocol` (Index-MCP-shaped) | Keep, generic rephrase | "Each wired backend exposes its tools via MCP. Tool descriptions are authoritative; read them." |
| `## Surfacing opportunities (visible)` quality-bar paragraph | Keep | — |
| `### Canonical voice exemplars` heading + Welcome / Digest / Ambient blocks (~75 lines) | **Move** | `skills/index-network/exemplars.md` |
| `#### Greeting drafts` subsection (~12 lines) | **Move** | `skills/index-network/exemplars.md` |
| `## Red lines` bullets — generic (no raw JSON, no accept without approval, trash > rm, no link strips) | Keep | — |
| `## Red lines` bullets — Index-specific (`discover_opportunities` during bootstrap, `connector-flow` greeting rule) | **Move** | `skills/index-network/{bootstrap,exemplars}.md` respectively |
| `## Group chats` (no MEMORY.md, no discovery in shared sessions) | Keep | — |
| `## Make it yours` (3 lines) | Keep | — |

Result: AGENTS.md ~30–40 lines.

### `workspace/BOOTSTRAP.md`

The current file is ~85 lines and almost entirely Index-tool-shaped (Steps 1, 2, 4, 6 call Index tools; Step 3 calls `update_user_profile`; Step 5 references `create_user_profile`).

- **`workspace/BOOTSTRAP.md`** (~10 lines) becomes a thin shell: "When `read_user_profiles().onboardingComplete === false`, run the bootstrap ritual in your active skill (for Index Network: `skills/index-network/bootstrap.md`). Do not invent your own ritual. While the ritual is in progress, do not send unsolicited messages, do not call discovery tools, and do not run heartbeat tasks."
- **`skills/index-network/bootstrap.md`** holds the full Step 1–6 ritual unchanged, plus the migrated `## First run` block from AGENTS.md.

### `workspace/HEARTBEAT.md`

| Section | Action | Destination |
|---|---|---|
| Intro paragraph (gateway tick, NO_REPLY contract) | Keep | — |
| `> NO_REPLY discipline.` blockquote (sentinel matching rules) | Keep | — |
| Cadence note about morning digest / ambient passes | Keep, generic rephrase | "Backend-specific fixed-time flows arrive as their own dispatches; their prompt bodies live in the relevant skill's `prompts/` directory." |
| `accepted-opportunities` task | **Move** | `skills/index-network/heartbeat.md` |
| `signal-freshness` task | **Move** | `skills/index-network/heartbeat.md` |
| `memory-curation` task | Keep | — |
| `# Additional instructions` (quality, no filler, late-night defer, group-chat skip, idempotency, MCP failure handling) | Keep | — |
| MCP failure handling line (mentions `index` tools specifically) | Reword | "If a backend MCP is unreachable, reply `NO_REPLY`, write a one-line note in `memory/<today>.md`, and stop." |

Result: HEARTBEAT.md ~30–35 lines. **No explicit pointer to `skills/index-network/heartbeat.md`** — OpenClaw's skill manifest handles discovery; the slimmed HEARTBEAT.md frames the agent's job in backend-agnostic terms and lets the skill manifest surface per-backend task definitions.

### `workspace/prompts/`

Move all three files (`welcome.md`, `digest.md`, `ambient.md`) wholesale to `skills/index-network/prompts/`. Bodies unchanged. `install_index.ts` updates the cron `--message` paths from `${workspaceDir}/prompts/<x>.md` to `${workspaceDir}/skills/index-network/prompts/<x>.md`.

Inside the cron prompt bodies, internal references update to the new locations: e.g. `welcome.md`'s "mimic the *Welcome* exemplar in `AGENTS.md` exactly" becomes "mimic the *Welcome* exemplar in `skills/index-network/exemplars.md` exactly."

## Installer changes

### `install/install.ts`

Adopt PR #2's helper (its naming and shape, but the SKILL.md decision is independent — the helper just copies `.md` files):

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

Untouched in this spec. EdgeOS receives its skill files via PR #2's merge (without `SKILL.md`, unless we upstream the addition); the placeholder install function changes alongside that. Geo waits for backend wiring.

## README updates

`packages/edgeclaw/README.md`:

- `### What's here` — replace `- \`skills/\` — directory for backend-specific skill bundles` with `- \`skills/\`: backend-specific skill bundles registered with OpenClaw via per-bundle \`SKILL.md\`. The Index Network bundle is shipped today; EdgeOS and Geo land alongside their backend wiring.`
- `## Install` numbered list — insert "Copies backend skill bundles into `~/.openclaw/workspace/skills/`." between the current "Copies the workspace markdown bundle..." step and the cron step. Re-number subsequent steps. (Same position as PR #2.)
- `## Workspace layout` table — drop the rows for the three `prompts/*.md` files (they live under `skills/index-network/prompts/` now). Update the `AGENTS.md`, `BOOTSTRAP.md`, `HEARTBEAT.md`, `TOOLS.md` row descriptions to reflect their slimmed scope. Add a `skills/index-network/` row pointing at the bundle's `SKILL.md`.

## Sequencing with PR #2

PR #2 is draft on `Edge-City/edgeclaw`; its merge is blocked on EdgeOS auth contract finalization, not on the structural convention. We ship the `install.ts` helper and the Index extraction in this monorepo on its own branch.

We **diverge** from PR #2 by adding `SKILL.md` per bundle. The `copyMarkdownTree` helper is identical, the per-backend folder layout is identical, the install order is identical. The only structural difference is the entry-point filename inside each bundle (`SKILL.md` vs. `README.md`) and the absence of TOOLS.md pointer bullets.

When PR #2 lands upstream and the monorepo pulls the fork:

- Incoming files: `skills/edgeos/{README,auth,calendar,rsvp,directory}.md` plus EdgeOS-related TOOLS.md additions and the `install_edgeos.ts` docstring update.
- Potential conflict: TOOLS.md. PR #2 adds bullets pointing at `skills/edgeos/*.md`; our slim TOOLS.md has neither those bullets nor any skill pointers. Resolution: take PR #2's bullets verbatim for EdgeOS (interim), then later either upstream `SKILL.md` to PR #2's structure and drop the bullets, or accept that EdgeOS uses a different discovery mechanism until upstreamed. **Surface this as a follow-up to upstream**: add `SKILL.md` to `skills/edgeos/` once PR #2 merges, so EdgeOS reaches the same canonical convention.
- The `install.ts` helper itself: no conflict expected. Same function shape, same call site.

If PR #2 evolves before merge (e.g. helper renamed, install order changed), the monorepo branch updates to match before the subtree pull.

## Out of scope

- Adding `SKILL.md` to EdgeOS bundles. EdgeOS files come from PR #2's merge; upstreaming `SKILL.md` to that directory is a separate follow-up.
- Authoring EdgeOS or Geo skill files in this monorepo.
- Changing the cron schedule, the Telegram session-binding logic, or the gateway-restart sequence.
- Touching `~/.openclaw/openclaw.json` config schema beyond what `install_index.ts` already writes.
- Changes to `@indexnetwork/protocol`, `backend/`, or anything outside `packages/edgeclaw/`.
- Bumping package versions — release-time concern handled by the finishing-a-branch workflow.

## Risks

1. **`metadata.openclaw.requires.config` syntax unverified.** [OpenClaw — creating skills](https://docs.openclaw.ai/tools/creating-skills) and [OpenClaw — skills](https://docs.openclaw.ai/tools/skills) describe the field as "Required openclaw.json config paths" without specifying whether nested dotted paths (`mcp.servers.index`) are supported, whether the value is a single string vs. an array, or whether absent values fall back to "always eligible." Verified during implementation against either OpenClaw source (`openclaw --version` shows 2026.5.7) or live behaviour: install with and without the MCP entry, observe whether `openclaw skills list` shows the bundle. **Fallback if the gate doesn't work as expected:** drop the `requires.config` block; the skill is then always eligible, and the agent ignores it when no Index tools are callable. No correctness impact; only a minor UX regression (skill appears in `openclaw skills list` even before `install_index.ts` runs).
2. **Lazy-loaded voice exemplars.** Today the canonical Welcome/Digest/Ambient exemplars are in always-loaded `AGENTS.md`; after extraction they live in `skills/index-network/exemplars.md` and the agent loads them only when activating the skill. Cron prompts reference them explicitly (`mimic the Welcome exemplar in skills/index-network/exemplars.md`), so the cron path is safe. Free-form chat asking for a digest-style summary depends on the agent picking up the skill from the manifest, which carries the description triggering on "opportunities, connections, signals." Mitigation: tune the description's "when to use" clause to be broad enough that any opportunity-related chat activates the skill.
3. **In-flight `BOOTSTRAP.md` ritual.** Users mid-onboarding when this ships have a `~/.openclaw/workspace/BOOTSTRAP.md` referencing Step 1–6. After re-install, the workspace file is the new thin shell and the steps live in `skills/index-network/bootstrap.md`. The session-start gate (`onboardingComplete: false` triggers ritual) and the staged-but-not-deleted file convention both survive intact. Verify by walking the install → first-message path.
4. **Workspace-precedence collision with `packages/openclaw-plugin/`.** If a user has both EdgeClaw and openclaw-plugin installed, two `index-network` skills exist — workspace (EdgeClaw flavour) wins by precedence. This is *intended*. Confirm no warning/error from OpenClaw's loader on the collision; if it does warn, rename to `index-network-edge` for the workspace bundle (loses precedence benefit but avoids noise).
5. **Cron `cat` path breakage.** The cron `--message` is built at install time via `cat`. `copySkillFiles()` runs *before* `installIndex()` in `install.ts`, so the prompts directory exists before the cron is built. Verified in install-order check.
6. **Divergence from PR #2 invites duplicate work.** Both this branch and PR #2 will reach `Edge-City/edgeclaw` eventually (via the fork). If PR #2 merges before us, we need to apply our `SKILL.md` addition cleanly on top of its flat-files EdgeOS bundle. If we merge first, PR #2 lands and Tim's PR will not have `SKILL.md`. Mitigation: track PR #2 status; offer to upstream `SKILL.md` additions to EdgeOS after PR #2 merges (separate follow-up PR upstream).

## Acceptance criteria

- `bun build install/install.ts --target=bun` and `bun build install/reset.ts --target=bun` succeed.
- `npm pack --dry-run` (from `packages/edgeclaw/`) shows the new `skills/index-network/**/*.md` files included via the existing `"files": ["skills/", ...]` entry in `package.json`.
- Fresh install on a clean `~/.openclaw/` produces:
  - `~/.openclaw/workspace/skills/index-network/SKILL.md` present with the planned frontmatter.
  - `~/.openclaw/workspace/skills/index-network/{tools,exemplars,bootstrap,heartbeat}.md` present.
  - `~/.openclaw/workspace/skills/index-network/prompts/{welcome,digest,ambient}.md` present.
  - `~/.openclaw/workspace/prompts/` absent.
  - Three EdgeClaw cron jobs registered, each with a non-empty `--message` body (verifiable via `openclaw cron list --json`).
  - `~/.openclaw/workspace/AGENTS.md`, `BOOTSTRAP.md`, `HEARTBEAT.md`, `TOOLS.md` shrunk to their slimmed forms.
- `openclaw skills list` shows `index-network` with description starting "Edge Esmeralda's Index Network bundle".
- `openclaw skills info index-network` shows the source path under `~/.openclaw/workspace/skills/index-network/`.
- Re-running `install.ts` is idempotent: same final state, EdgeClaw cron jobs are pruned and re-added (existing behaviour preserved).
- `reset.ts` removes the skills directory it staged (currently removes `~/.openclaw/workspace/`; subdirectory inheritance is automatic).
- Manual bootstrap walk-through on a fresh user account: agent gates on `onboardingComplete: false`, picks up `index-network` from the skill manifest, reads `bootstrap.md`, walks Steps 1–6, calls `complete_onboarding`, triggers the welcome pass, the welcome message lands on Telegram.

## Open question deferred to implementation

`requires.config` exact syntax. Three plausible shapes from skimming OpenClaw's existing skills (none of which I've yet confirmed against source):

```yaml
# (a) Array of dotted paths
metadata:
  openclaw:
    requires:
      config:
        - mcp.servers.index

# (b) Single string
metadata:
  openclaw:
    requires:
      config: mcp.servers.index

# (c) Object with truthy presence check
metadata:
  openclaw:
    requires:
      config:
        mcp.servers.index: present
```

Default during implementation: try (a) first (most common in YAML-frontmatter configs), check `openclaw skills check` output, fall back to (b) or (c) if (a) doesn't gate. If none of the shapes gate correctly, drop the field — per Risk #1, this is a minor UX regression, not a correctness issue.
