# EdgeClaw Skills Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Index Network procedural knowledge out of always-loaded `packages/edgeclaw/workspace/` files into a self-contained, OpenClaw-registered skill bundle at `packages/edgeclaw/skills/index-network/`. Leave `workspace/` files as backend-agnostic shells; the bundle uses OpenClaw's canonical AgentSkills `SKILL.md` with `requires.config` gating on `mcp.servers.index`.

**Architecture:** Two-phase refactor. Phase A is additive — create the new skill bundle, wire `install.ts` to stage it, repoint `install_index.ts` cron paths. Throughout Phase A, the install workflow stays functional at every commit (old `workspace/prompts/` is still present until Phase A's final task removes it). Phase B is pure cleanup — slim the four workspace shell files (`AGENTS.md`, `BOOTSTRAP.md`, `HEARTBEAT.md`, `TOOLS.md`) by removing Index content that now lives in the skill bundle, and update `README.md`.

**Tech Stack:** Bun, TypeScript (the installer), Markdown, OpenClaw runtime (`openclaw` CLI v2026.5.7+). The OpenClaw `requires.config` gate has been confirmed against `dist/config-eval-CdLyuyT0.js`: it's an array of dotted config paths, each evaluated for truthy presence in `~/.openclaw/openclaw.json`. No probe needed.

**Reference spec:** `docs/superpowers/specs/2026-05-15-edgeclaw-skills-extraction-design.md`

---

## File Structure

**New files (all under `packages/edgeclaw/skills/index-network/`):**
- `SKILL.md` — frontmatter (name, description, requires.config), Tier-2 high-level guide.
- `tools.md` — MCP tool families, entity model, `scrape_url` usage, output translation. Content sourced from `workspace/TOOLS.md`.
- `exemplars.md` — Canonical welcome / digest / ambient voice samples + greeting drafts. Content sourced from `workspace/AGENTS.md`.
- `bootstrap.md` — Six-step onboarding ritual + the session-start gate. Content sourced from `workspace/BOOTSTRAP.md` + the `## First run` section of `workspace/AGENTS.md`.
- `heartbeat.md` — `accepted-opportunities` and `signal-freshness` task definitions. Content sourced from `workspace/HEARTBEAT.md`.
- `prompts/welcome.md`, `prompts/digest.md`, `prompts/ambient.md` — Cron prompts, moved verbatim from `workspace/prompts/`. Internal references to `AGENTS.md` updated to point at `skills/index-network/exemplars.md`.

**Modified files:**
- `packages/edgeclaw/install/install.ts` — gains `copyMarkdownTree()` helper and `copySkillFiles()` step.
- `packages/edgeclaw/install/install_index.ts` — three cron `--message` paths updated to the new prompts location.
- `packages/edgeclaw/workspace/{AGENTS,BOOTSTRAP,HEARTBEAT,TOOLS}.md` — slimmed; Index content removed.
- `packages/edgeclaw/README.md` — install steps re-numbered, workspace layout table updated.

**Deleted files:**
- `packages/edgeclaw/workspace/prompts/{welcome,digest,ambient}.md` — relocated into the skill bundle.

---

## Phase A — Build the new bundle (additive)

### Task 1: Move cron prompts into `skills/index-network/prompts/`

**Files:**
- Create: `packages/edgeclaw/skills/index-network/prompts/welcome.md`
- Create: `packages/edgeclaw/skills/index-network/prompts/digest.md`
- Create: `packages/edgeclaw/skills/index-network/prompts/ambient.md`
- Keep (for now): `packages/edgeclaw/workspace/prompts/{welcome,digest,ambient}.md` — removed in Task 8.

The three prompt bodies are moved verbatim. The only edit is a one-line cross-reference update in `welcome.md` and `ambient.md` (both reference "AGENTS.md" today; they should reference the new exemplars location).

- [ ] **Step 1: Create the prompts directory**

```bash
mkdir -p packages/edgeclaw/skills/index-network/prompts
```

- [ ] **Step 2: Copy `welcome.md` and update its internal reference**

```bash
cp packages/edgeclaw/workspace/prompts/welcome.md \
   packages/edgeclaw/skills/index-network/prompts/welcome.md
```

Then edit `packages/edgeclaw/skills/index-network/prompts/welcome.md` to replace the AGENTS.md reference. Current text (line ~19):

```
Send the message via the `message` tool, mimicking the *Welcome* exemplar in `AGENTS.md` exactly:
```

Replace with:

```
Send the message via the `message` tool, mimicking the *Welcome* exemplar in `skills/index-network/exemplars.md` exactly:
```

- [ ] **Step 3: Copy `digest.md` verbatim**

```bash
cp packages/edgeclaw/workspace/prompts/digest.md \
   packages/edgeclaw/skills/index-network/prompts/digest.md
```

No content edit needed — `digest.md` does not reference `AGENTS.md`. Confirm by:

```bash
grep -n "AGENTS.md" packages/edgeclaw/skills/index-network/prompts/digest.md
```

Expected: no output.

- [ ] **Step 4: Copy `ambient.md` and update its internal reference**

```bash
cp packages/edgeclaw/workspace/prompts/ambient.md \
   packages/edgeclaw/skills/index-network/prompts/ambient.md
```

Then edit `packages/edgeclaw/skills/index-network/prompts/ambient.md` to replace the AGENTS.md reference. Current text (line ~27):

```
9. **If at least one qualifies:** send the message via the `message` tool. Compose one or both of the following sections (skip a section that has zero qualifying candidates), mimicking the *Ambient update* exemplar in `AGENTS.md`. Flat prose, inline links — no bullet-list-of-links, no pipe rows, no tables, no link strips.
```

Replace with:

```
9. **If at least one qualifies:** send the message via the `message` tool. Compose one or both of the following sections (skip a section that has zero qualifying candidates), mimicking the *Ambient update* exemplar in `skills/index-network/exemplars.md`. Flat prose, inline links — no bullet-list-of-links, no pipe rows, no tables, no link strips.
```

- [ ] **Step 5: Verify content integrity (cross-references aside, bodies match)**

```bash
diff -q packages/edgeclaw/workspace/prompts/digest.md \
        packages/edgeclaw/skills/index-network/prompts/digest.md
```

Expected: no output (identical). For `welcome.md` and `ambient.md`, the diff should show only the AGENTS.md → skills/index-network/exemplars.md substitution.

- [ ] **Step 6: Commit**

```bash
git add packages/edgeclaw/skills/index-network/prompts/
git commit -m "feat(edgeclaw): move cron prompts into skills/index-network/prompts/

Verbatim copies with cross-references in welcome.md and ambient.md
repointed at skills/index-network/exemplars.md (created in Task 2)."
```

---

### Task 2: Create `skills/index-network/exemplars.md`

**Files:**
- Create: `packages/edgeclaw/skills/index-network/exemplars.md`
- Source: `packages/edgeclaw/workspace/AGENTS.md` (Canonical voice exemplars + Greeting drafts sections)

The canonical Welcome / Good morning digest / Ambient update / Greeting drafts blocks move to `exemplars.md`. `AGENTS.md` keeps these for now; they are removed in Task 10.

- [ ] **Step 1: Create the file with full content**

Write the following to `packages/edgeclaw/skills/index-network/exemplars.md`:

```markdown
# Index Network — Voice Exemplars

Canonical user-facing renderings for Edge Esmeralda's Index Network flows. Mimic these exactly when composing the welcome message, daily digest, ambient passes, and greeting drafts. They are the bar for tone, structure, and information density. Edge Esmeralda is the literal community in every example — pull facts from `COMMUNITY.md`, never invent dates, attendee counts, or programming formats.

## Welcome (fires once, after onboarding completes)

The welcome opener is a **single line** — `Welcome to Edge Esmeralda`. Do NOT repeat the agent intro from `bootstrap.md` Step 1 ("I'm EdgeClaw, your agent. I help the right people find you, and help you find them") — the user already met you minutes ago, repeating it reads as filler. Go straight from the welcome line to the community context paragraph.

> Welcome to Edge Esmeralda
>
> Four weeks in Healdsburg, May 30 to June 27, 2026 — 500+ residents across the month, ~150 on-site at any given time, building at the frontiers of tech, science, culture, and policy. Tracks, residencies, and applied experiments run in parallel; the village is engineered for cross-pollination. Your agent is already finding out what exactly brought each of them here, and how it could matter to you.
>
> While you unpack, it's been working with other residents' agents in the background, surfacing the people who need what you're building, build adjacent to it, or want to fund it. Here's what landed in the first pass.
>
> **3 conversations waiting**
> - [Maya](https://index.network/u/...?link_preview=false) — Talk to them about agent memory for long-running workflows. Direct overlap with how Index handles persistent context, [message Maya](https://protocol.index.network/api/opportunities/.../connect?token=...&msg=...)
> - [Theo](https://index.network/u/...?link_preview=false) — How information surfaces in decentralized networks. The kind of thinking that sharpens protocol design — [see what you can learn from them](https://protocol.index.network/api/opportunities/.../connect?token=...&msg=...)
> - [Priya](https://index.network/u/...?link_preview=false) — Community-owned data infrastructure. Aligned on ownership, complementary on discovery, could be interesting to [explore your overlap](https://protocol.index.network/api/opportunities/.../connect?token=...&msg=...)
>
> **Help your community**
> A few residents are looking for something specific. If you know someone who fits, a quick nudge goes a long way.
> - [Remi](https://index.network/u/...?link_preview=false) — Looking for a technical co-founder for his regenerative education platform. Know a systems thinker who's shipped infra, make intro
> - [Kai](https://index.network/u/...?link_preview=false) — Needs people deep in decentralized discovery — agent tooling, knowledge graphs, semantic search. Bring one to his 3pm, make intro
>
> **From here**
> Each morning, your agent will send a brief — who to find, what opportunities landed, where you can help, and a short list for the day. No feeds, no inboxes. Just the few moves that matter.
>
> Tell me anytime what's working and what isn't — what you're looking for, what you're not, who felt off, who felt right. Every nudge sharpens the matches.
>
> See you soon ☀️

## Good morning digest (fires once daily, ~08:00 host local)

> 🌞 Good morning from Edge Esmeralda
>
> It's Thursday, Week 2 at Edge Esmeralda. Here's what to do and who to find before the day fills up.
>
> **3 conversations await you**
> - [Maya](https://index.network/u/...?link_preview=false) — Talk to them about agent memory layer for long-running workflows. Direct overlap with how Index handles persistent context, [message Maya](https://protocol.index.network/api/opportunities/.../connect?token=...&msg=...)
> - [Theo](https://index.network/u/...?link_preview=false) — Researching how information surfaces in decentralized networks. That's the type of thinking that sharpens protocol design, [see what you can learn from them](https://protocol.index.network/api/opportunities/.../connect?token=...&msg=...)
> - [Priya](https://index.network/u/...?link_preview=false) — Building community-owned data infrastructure. Aligned on the ownership layer and complementary on discovery, could be interesting to [explore overlaps](https://protocol.index.network/api/opportunities/.../connect?token=...&msg=...)
>
> **Help your community find their opportunities**
> A few residents are looking for something specific. If you know someone who fits, a quick nudge goes a long way.
> - [Remi](https://index.network/u/...?link_preview=false) — Looking for a technical co-founder for his regenerative education platform. Needs someone who thinks in systems and has shipped infra. Know anyone, make intro
> - [Kai](https://index.network/u/...?link_preview=false) — Needs people deep in decentralized discovery — agent tooling, knowledge graphs, semantic search. Bring one to his 3pm open conversation, make intro
> - [Celia](https://index.network/u/...?link_preview=false) — Designing governance tooling for popup communities. Coordination, consent, collective decision-making. Point her at the right people, make intro

## Ambient update (fires twice daily at 14:00 and 20:00 host-local)

Two sections are possible: direct (the user is a party — link the name to `profileUrl`, embed `acceptUrl` + `&msg=` greeting) and introducer (the user is the introducer — render community intents, still link the name to `profileUrl`, but no `acceptUrl` and no `&msg=`). Skip a section that has no qualifying candidates. Per-pass cap: max 3 direct + 3 introducer.

> **New conversations worth starting**
> - [Erik Leibner](https://index.network/u/...?link_preview=false) — Senior software engineer focused on AI systems. There's a clear overlap with how you're thinking about decentralized search + agents. Feels like a "build together" type conversation, [message Erik](https://protocol.index.network/api/opportunities/.../connect?token=...&msg=...)
> - [Tiina](https://index.network/u/...?link_preview=false) — Co-founder at Hopscotch Labs and Sane. Working on creativity and knowledge organization. Different entry point, same underlying problem space — could spark something interesting, [message Tiina](https://protocol.index.network/api/opportunities/.../connect?token=...&msg=...)
> - [Xavier Meegan](https://index.network/u/...?link_preview=false) — Founder & CIO at Frachtis. Deep in decentralized infrastructure and AI. Good person to pressure-test ideas and explore where things could connect, [message Xavier](https://protocol.index.network/api/opportunities/.../connect?token=...&msg=...)
>
> **Help your community find their opportunities**
> A few residents are looking for something specific. If you know someone who fits, a quick nudge goes a long way.
> - [Remi](https://index.network/u/...?link_preview=false) — Looking for a technical co-founder for his regenerative education platform. Needs someone who thinks in systems and has shipped infra. Know anyone, make intro
> - [Kai](https://index.network/u/...?link_preview=false) — Needs people deep in decentralized discovery — agent tooling, knowledge graphs, semantic search. Bring one to his 3pm, make intro
>
> There are 5 more conversations waiting for you, let me know if you want to see them.

## Greeting drafts (the `&msg=` payload appended to Telegram links)

For `connection` candidates, compose a short personal greeting based on what's in common — 2–4 sentences max, first-person from the user, references something specific from the candidate's bio/profile.

> Hey Jeremiah, Seren Sandikci here. Saw your work with Blitzscaling Ventures and your focus on early-stage AI investments, especially around AI Agents. I'm building in that space too and would love to connect.

For `connector-flow` candidates ("help your community"), the greeting is the user nudging a third party to make an intro:

> Hey Remi, Seren here. Saw you're looking for a technical co-founder for the regenerative education platform. Might have someone in mind who's …

URI-encode the greeting and append it as `&msg=...` (or `?text=...` for `t.me`) on the action URL. The base URL + token portion must remain untouched — only append the message parameter.

## Connector-flow rendering rule

For introducer (`connector-flow`) candidates:

- **DO link the person's name** to `profileUrl` (the Index web profile URL — same shape as direct candidates).
- **Do NOT link the opportunity** — no `acceptUrl`. The trailing `make intro` is plain text, not a hyperlink. The connect/accept link belongs only to direct candidates; for introducer candidates the user replies to the agent if they want to act.
- Never compose a `&msg=` greeting for `connector-flow` candidates — only for `connection`. Connector accepts trigger an introduction approval, not a direct conversation.
```

- [ ] **Step 2: Verify the file is non-empty and contains the expected exemplar headers**

```bash
grep -c "^## " packages/edgeclaw/skills/index-network/exemplars.md
```

Expected: `5` (Welcome, Good morning digest, Ambient update, Greeting drafts, Connector-flow rendering rule).

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/skills/index-network/exemplars.md
git commit -m "feat(edgeclaw): add skills/index-network/exemplars.md

Canonical voice samples for welcome, daily digest, ambient passes, and
greeting drafts. Content moved from workspace/AGENTS.md; the source
section is removed in a later task in this branch."
```

---

### Task 3: Create `skills/index-network/tools.md`

**Files:**
- Create: `packages/edgeclaw/skills/index-network/tools.md`
- Source: `packages/edgeclaw/workspace/TOOLS.md` (Index protocol MCP section + Tool families + scrape_url + Output translation)

- [ ] **Step 1: Create the file with full content**

Write the following to `packages/edgeclaw/skills/index-network/tools.md`:

```markdown
# Index Network — Tools

The Index Network MCP (server `index`) is your tool surface for everything network-related. The MCP entry was registered by `install_index.ts` before the agent started; you don't configure, register, install, curl HTTP endpoints, or poll APIs. Every capability is a tool call on `index`. If a tool errors, retry it or `NO_REPLY`; do not try to "fix" the connection.

## Tool families

- **Profile** — `create_user_profile`, `read_user_profiles`, `update_user_profile`
- **Networks (communities)** — `read_networks`, `create_network`, `update_network`, `delete_network`, `read_network_memberships`, `create_network_membership`, `delete_network_membership`
- **Signals (intents)** — `create_intent`, `read_intents`, `update_intent`, `delete_intent`, `search_intents`, `create_intent_index`, `read_intent_indexes`, `delete_intent_index`
- **Discovery** — `discover_opportunities`, `list_opportunities`, `update_opportunity`, `confirm_opportunity_delivery`
- **Negotiations** — `list_negotiations`, `get_negotiation` (read-only — negotiations are handled server-side; do not call `respond_to_negotiation`)
- **Conversations** — `list_conversations`, `get_conversation`
- **Contacts** — `add_contact`, `import_contacts`, `import_gmail_contacts`, `list_contacts`, `search_contacts`, `remove_contact`
- **Agents (administrative)** — `list_agents`, `register_agent`, `update_agent`, `delete_agent`, `grant_agent_permission`, `revoke_agent_permission`
- **Onboarding** — `complete_onboarding`
- **Reference** — `read_docs`, `scrape_url`

Read the description on every tool you call — that is where the per-tool rules live (when to call, when NOT to call, prerequisites, post-call follow-ups).

## `scrape_url` — when to use it

Call `scrape_url(url, objective)` whenever the user shares a URL and you need its content:

- **Profile enrichment** — user shares a LinkedIn, GitHub, personal site, or any professional URL → scrape it, then pass the content to `update_user_profile` or `create_user_profile`.
- **Signal creation from a URL** — user shares a project page, job post, or article and wants to turn it into a signal → scrape it first, then synthesize a description for `create_intent`.
- **Research** — user asks "what is this?" or "who is this person?" about a URL → scrape and summarize.
- **Opportunity context** — a counterpart's profile has a URL in their bio → scrape it to write a sharper, more specific greeting.

Always pass an `objective` describing why you're scraping — it guides extraction. Example: `scrape_url(url="linkedin.com/in/alex", objective="Update user profile from LinkedIn page")`.

## Output translation

The MCP returns structured records. You do not pass them through. Translate before speaking:

| Internal | What the user hears |
|---|---|
| `intent` | "signal" |
| `index` / `network` | "community" |
| `Membership.isPersonal=true` | "their personal network" — usually unmentioned |
| status `draft` / `latent` | "draft" |
| status `pending` | "sent" |
| status `accepted` | "connected" |

Never expose internal IDs unless the ID is actionable (e.g. a `conversationId` the user can open).
```

- [ ] **Step 2: Verify the file is non-empty**

```bash
wc -l packages/edgeclaw/skills/index-network/tools.md
```

Expected: ~35 lines.

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/skills/index-network/tools.md
git commit -m "feat(edgeclaw): add skills/index-network/tools.md

MCP tool families, scrape_url guidance, output translation table. Content
moved from workspace/TOOLS.md; the source section is removed in a later task."
```

---

### Task 4: Create `skills/index-network/bootstrap.md`

**Files:**
- Create: `packages/edgeclaw/skills/index-network/bootstrap.md`
- Source: `packages/edgeclaw/workspace/BOOTSTRAP.md` (full ritual) + `packages/edgeclaw/workspace/AGENTS.md` (`## First run` block)

The six-step ritual moves verbatim. The session-start gate (`read_user_profiles().onboardingComplete` check from `AGENTS.md`) is integrated as the file's preamble.

- [ ] **Step 1: Create the file with full content**

Write the following to `packages/edgeclaw/skills/index-network/bootstrap.md`:

```markdown
# Index Network — Onboarding Ritual

_You're EdgeClaw, the agent for Edge Esmeralda. Your tools, channels, and schedule are already in place — call MCP tools directly, never try to register, configure, or repair anything._

This file walks you through the **onboarding ritual** for a new user. It is loaded when the server reports `onboardingComplete: false` for the calling user. Run it end-to-end. Do not skip steps; do not reorder them. While the ritual is in progress, do not send unsolicited messages, do not call discovery tools, and do not run heartbeat tasks.

## Session-start gate

The server is the source of truth for whether the user has finished onboarding — not local file state. At session start, call `read_user_profiles()` (no args) and check `onboardingComplete`:

- **If `onboardingComplete` is `false`:** follow this ritual end-to-end. Until the next session-start check shows `onboardingComplete: true`, treat yourself as not-yet-online — don't run heartbeat tasks, don't surface anything; finish the ritual first.
- **If `onboardingComplete` is `true`:** skip this file entirely. You're online — heartbeat tasks, negotiation lookups, and chat are all available.

This file is **not** deleted at the end of onboarding — if an admin ever resets the user's `onboardingComplete` flag server-side, the next session will see `onboardingComplete: false` and run the ritual again from the still-staged file.

---

## Step 1 — Greet and create the user profile

Greet the user — **never mention the underlying platform by name** (see SOUL.md "Never name the plumbing"). Always lead with the community framing — EdgeClaw is Edge Esmeralda's agent:

> "Welcome to Edge Esmeralda. I'm EdgeClaw, your agent. I help the right people find you, and help you find them."

Briefly explain what you do in your own words: learn about them, find relevant people, surface connections in the background. Then call `create_user_profile()` with no arguments — the lookup runs against your tooling, the user does not need to know how.

Narrate while processing:

> `> Looking you up…`

Present the profile summary naturally:

> "Here's what I found: [summary]. Does that sound right?"

Then:

- If they confirm → `create_user_profile(confirm=true)` and proceed to Step 2.
- If they want edits → `create_user_profile(bioOrDescription="[their correction]", confirm=true)` and proceed to Step 2.
- If nothing is found → ask them to describe themselves in a sentence, then `create_user_profile(bioOrDescription="[their text]", confirm=true)`.

## Step 2 — Capture their first signal

Ask:

> "Now tell me — what are you open to right now? Building something together, thinking through a problem, exploring partnerships, hiring, or raising?"

When they respond, call `create_intent(description="[their response]")` **once**. If the call returns an error or the signal is rejected as too vague, ask one clarifying follow-up — do **not** silently retry `create_intent` with a paraphrased version. Each call runs a multi-stage verification graph; silent retries make onboarding feel hung for tens of seconds.

Once `create_intent` succeeds, briefly acknowledge:

> "Got it — I'll keep an eye out for relevant people."

## Step 3 — Capture chat-channel handle silently

Before closing onboarding, look at the session you're running in and recover the user's platform handle on whichever channel they connected through. Add it to their profile so other people who match with them can reach out via the same channel without having to ask.

This step is **silent** — produce no user-facing output, do not announce it, do not ask for confirmation. The user already authenticated via this channel; capturing the handle is an implementation detail of being reachable.

Detection by session key:

- `agent:main:telegram:direct:<chatId>` → Telegram. Look up the inbound message's sender metadata (it carries `from.username` for users who have a public handle). If `from.username` is present, call `update_user_profile(socials={ telegram: "@<username>" })`. If absent (the user has no public Telegram username), skip — do not write the chatId as a fallback.
- `agent:main:whatsapp:...` → WhatsApp. The phone number is the handle; call `update_user_profile(socials={ whatsapp: "+<E.164>" })` if recoverable.
- `agent:main:discord:...`, `agent:main:slack:...`, etc. → equivalent treatment if the platform's primary handle is recoverable from session metadata.
- `agent:main:webchat` or any other context where no platform handle exists → skip the entire step.

Also note the platform + handle in `USER.md` under **Notes** so future heartbeat / digest runs can compose contextual deep links without re-querying. One short line is enough (e.g. `Connected via Telegram (@yanekyuksel).`).

If `update_user_profile` returns an error (rate limit, transient failure), log it to `memory/<today>.md` and continue — do not block onboarding on this. The next ambient pass can retry.

## Step 4 — Close out onboarding

Call `complete_onboarding()`. This is required — do not skip it. The server auto-joins the user to Edge Esmeralda's community at this point (no separate `create_network_membership` call is needed).

## Step 5 — Populate USER.md

Update `USER.md` with what you learned in this conversation. Capture only the things the user said directly — name, what to call them, timezone, anything they explicitly told you to remember. Do **not** paraphrase what `create_user_profile` returned; that lives behind the protocol. `USER.md` is the lived notebook, not a duplicate of the structured record.

## Step 6 — First ambient pass (welcome message)

Run the welcome pass — follow `prompts/welcome.md`. It handles the message composition, dedup, and `confirm_opportunity_delivery` calls. After it returns, write a single line into `memory/<today>.md` noting that bootstrap completed for Edge Esmeralda. The next ambient/accepted heartbeat tick will pick up from here.

---

## Rules

- Do not skip steps or reorder them.
- Do not call `discover_opportunities`, `list_opportunities`, or any other discovery tool **before Step 6**. Onboarding ends at `complete_onboarding()`; the welcome ambient pass is the first time discovery is allowed.
- Do not mention Gmail or email import — they are not available in this flow.
- Call `create_intent` at most once per user response.
- If the user tries to do something else mid-onboarding, gently redirect: "Let's finish setting you up first, then we can dive into that."
- Keep your tone calm, direct, concise — no "Great question!", no "I'd be happy to help!", no filler.
- EdgeClaw is Edge Esmeralda's agent. Do not invite users to other communities, do not list networks — Edge Esmeralda is the only frame.
```

- [ ] **Step 2: Verify the file contains the six numbered steps and the gate section**

```bash
grep -c "^## Step " packages/edgeclaw/skills/index-network/bootstrap.md
grep -c "^## Session-start gate" packages/edgeclaw/skills/index-network/bootstrap.md
```

Expected: `6` and `1` respectively.

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/skills/index-network/bootstrap.md
git commit -m "feat(edgeclaw): add skills/index-network/bootstrap.md

Six-step onboarding ritual + session-start gate (read_user_profiles
onboardingComplete check). Content moved from workspace/BOOTSTRAP.md and
the First run section of workspace/AGENTS.md; both source sections are
slimmed in later tasks."
```

---

### Task 5: Create `skills/index-network/heartbeat.md`

**Files:**
- Create: `packages/edgeclaw/skills/index-network/heartbeat.md`
- Source: `packages/edgeclaw/workspace/HEARTBEAT.md` (accepted-opportunities and signal-freshness tasks)

- [ ] **Step 1: Create the file with full content**

Write the following to `packages/edgeclaw/skills/index-network/heartbeat.md`:

```markdown
# Index Network — Heartbeat Tasks

Per-tick tasks for Index Network. Walked from the heartbeat tick described in `HEARTBEAT.md`. Track last-run timestamps and dedup state in `memory/heartbeat-state.json`. If a task isn't due, skip it.

---

tasks:

- name: accepted-opportunities
  interval: 30m
  prompt: |
    Someone may have accepted a connection on the user's behalf — the user wants to know.

    1. Call `list_opportunities(status="accepted_unnotified")` (or the equivalent — read the tool description).
    2. If empty, reply `NO_REPLY`.
    3. For each accepted opportunity:
       - Embed `acceptUrl` on a verb phrase like "send {Name} a message". The URL is a short backend redirect — paste it verbatim, do not append query parameters, do not compose a `t.me` URL. The greeting and Telegram handle resolution happen server-side.
       - If `acceptUrl` is missing, embed `conversationUrl` on "continue the conversation".
    4. Frame the notification warmly — this is good news.
    5. For every opportunity you mention, call `confirm_opportunity_delivery(opportunityId, trigger="accepted")`.

- name: signal-freshness
  interval: 7d
  prompt: |
    Once a week, prune.

    1. Call `read_intents()` for the user.
    2. For each signal older than 60 days with no recent matches: ask the user (in their last-active channel) whether it's still active. If they say no, call `update_intent(id, status="archived")`. If they say yes, leave it. If they ignore, leave it — re-ask next cycle.

    Skip silently if nothing is stale. Do not invent things to ask about.
```

- [ ] **Step 2: Verify the two task definitions are present**

```bash
grep -c "^- name:" packages/edgeclaw/skills/index-network/heartbeat.md
```

Expected: `2`.

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/skills/index-network/heartbeat.md
git commit -m "feat(edgeclaw): add skills/index-network/heartbeat.md

accepted-opportunities (30m) and signal-freshness (7d) tasks. Content
moved from workspace/HEARTBEAT.md; the source section is removed in a
later task."
```

---

### Task 6: Create `skills/index-network/SKILL.md`

**Files:**
- Create: `packages/edgeclaw/skills/index-network/SKILL.md`

This is the OpenClaw skill registration file. Frontmatter uses `metadata.openclaw.requires.config` to gate eligibility on the Index MCP entry being present — confirmed against `dist/config-eval-CdLyuyT0.js` in the installed OpenClaw distribution: `requires.config` is an array of dotted paths, each evaluated for truthy presence.

- [ ] **Step 1: Create the file with full content**

Write the following to `packages/edgeclaw/skills/index-network/SKILL.md`:

```markdown
---
name: index-network
description: Edge Esmeralda's Index Network bundle. Surfaces opportunities through a one-time welcome on first run, a daily 08:00 digest, twice-daily ambient passes at 14:00 and 20:00 (all host-local), and accepted-opportunity notifications on the heartbeat tick. Prunes stale signals weekly. Read when surfacing opportunities, drafting introductions, running onboarding for a new user, composing welcome / digest / ambient flows, or handling anything backed by the Index Network MCP (server `index`).
metadata:
  openclaw:
    requires:
      config:
        - mcp.servers.index
---

# Index Network — Edge Esmeralda

EdgeClaw's bundle for surfacing opportunities through Edge Esmeralda's Index Network integration. The Index Network MCP (server `index`) is the tool surface; this skill carries the Edge-flavored procedural knowledge for using it.

## When to read each file

- **Any non-trivial tool call** → [tools.md](tools.md). MCP tool families, entity model, `scrape_url` usage, output translation rules.
- **Composing user-facing opportunity renderings** → [exemplars.md](exemplars.md). Canonical welcome / daily digest / ambient discovery voice samples; greeting-draft format for `&msg=`.
- **`read_user_profiles().onboardingComplete === false`** → [bootstrap.md](bootstrap.md). Six-step onboarding ritual and the session-start gate.
- **Heartbeat tick** → [heartbeat.md](heartbeat.md). Accepted-opportunity notifications and signal-freshness pruning.

Cron prompts in `prompts/` (`welcome.md`, `digest.md`, `ambient.md`) are loaded by the cron runner via `--message`; you do not read them yourself.

## Handoff

The MCP server's own instructions carry the protocol-level rules (voice, vocabulary, entity model, output translation). Tool descriptions are authoritative; read them before calling. This skill adds only Edge Esmeralda-specific framing on top — never duplicate the MCP's behavioural guidance here.
```

- [ ] **Step 2: Verify frontmatter parses as YAML**

```bash
head -10 packages/edgeclaw/skills/index-network/SKILL.md
```

Expected: the frontmatter block is bounded by `---` at lines 1 and 7 (or thereabouts), with `name`, `description`, and `metadata.openclaw.requires.config` keys visible. Description length:

```bash
awk '/^description:/{print length($0)-13}' packages/edgeclaw/skills/index-network/SKILL.md
```

Expected: a value under 1024 (the Anthropic SKILL.md description limit).

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/skills/index-network/SKILL.md
git commit -m "feat(edgeclaw): add skills/index-network/SKILL.md

Workspace skill registration for the Index Network bundle. Gates on
mcp.servers.index via metadata.openclaw.requires.config. Body is a Tier-2
high-level guide pointing at the four sibling reference files. Hands off
to the MCP server's own instructions for protocol-level rules."
```

---

### Task 7: Wire `install.ts` to stage the skill bundle

**Files:**
- Modify: `packages/edgeclaw/install/install.ts`

Adopt the same shape as `Edge-City/edgeclaw#2`'s helper: a generic `copyMarkdownTree(source, target)` plus a `copySkillFiles()` wrapper called from `main()` between `copyWorkspaceFiles()` and `installIndex()`.

- [ ] **Step 1: Add the two new constants near the existing `SOURCE_WORKSPACE` and `TARGET_WORKSPACE` declarations**

Locate (around line 57–59 of `install.ts`):

```ts
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_WORKSPACE = join(SCRIPT_DIR, "../workspace");
const TARGET_WORKSPACE = join(homedir(), ".openclaw", "workspace");
```

Replace with:

```ts
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SOURCE_WORKSPACE = join(SCRIPT_DIR, "../workspace");
const SOURCE_SKILLS = join(SCRIPT_DIR, "../skills");
const TARGET_WORKSPACE = join(homedir(), ".openclaw", "workspace");
const TARGET_SKILLS = join(TARGET_WORKSPACE, "skills");
```

- [ ] **Step 2: Add the `copyMarkdownTree` and `copySkillFiles` functions**

Insert the following after `copyWorkspaceFiles` ends (around line 119, right before `function findTelegramSession`):

```ts
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

- [ ] **Step 3: Call `copySkillFiles()` from `main()`**

Locate (around line 213):

```ts
  disableTelegramTidepooling();
  copyWorkspaceFiles(wipeUser);

  installIndex();
  installEdgeos();
  installGeo();
```

Replace with:

```ts
  disableTelegramTidepooling();
  copyWorkspaceFiles(wipeUser);
  copySkillFiles();

  installIndex();
  installEdgeos();
  installGeo();
```

- [ ] **Step 4: Update the top docstring**

Locate the bullet list in the docstring (around lines 13–22):

```ts
 *   - Copy the workspace markdown bundle (BOOTSTRAP, AGENTS, SOUL, USER,
 *     IDENTITY, TOOLS, HEARTBEAT, COMMUNITY, prompts/*) into
 *     `~/.openclaw/workspace/`.
 *   - Call each backend installer in `install_<backend>.ts`.
```

Replace with:

```ts
 *   - Copy the workspace markdown bundle (BOOTSTRAP, AGENTS, SOUL, USER,
 *     IDENTITY, TOOLS, HEARTBEAT, COMMUNITY) into `~/.openclaw/workspace/`.
 *   - Copy backend skill bundles from `skills/` into
 *     `~/.openclaw/workspace/skills/` so OpenClaw registers them as
 *     workspace skills.
 *   - Call each backend installer in `install_<backend>.ts`.
```

Also remove `prompts/*` from the list since the prompts no longer live under `workspace/`.

- [ ] **Step 5: Build to verify TypeScript compiles**

```bash
cd packages/edgeclaw && bun build install/install.ts --target=bun --outfile=/tmp/install-check.js && rm /tmp/install-check.js && cd -
```

Expected: build succeeds, output file is removed cleanly. If TypeScript reports an error, fix it before committing.

- [ ] **Step 6: Commit**

```bash
git add packages/edgeclaw/install/install.ts
git commit -m "feat(edgeclaw): stage skills bundle in install.ts

Adds copyMarkdownTree helper and copySkillFiles step that recursively
copies packages/edgeclaw/skills/ into ~/.openclaw/workspace/skills/.
Same shape as Edge-City/edgeclaw#2. Called between workspace copy and
backend installers so prompt files exist before install_index.ts builds
the crons that read them."
```

---

### Task 8: Update `install_index.ts` cron paths and remove `workspace/prompts/`

**Files:**
- Modify: `packages/edgeclaw/install/install_index.ts`
- Delete: `packages/edgeclaw/workspace/prompts/{welcome,digest,ambient}.md`
- Delete: `packages/edgeclaw/workspace/prompts/` (directory)

After this commit, the install workflow uses the new location end-to-end. The old `workspace/prompts/` is orphaned and removed.

- [ ] **Step 1: Update the three cron `--message` paths in `install_index.ts`**

Locate `installCronJobs()` (around line 58). Find each of the three `cat ${workspaceDir}/prompts/<x>.md` references and replace with `cat ${workspaceDir}/skills/index-network/prompts/<x>.md`.

The diff (three occurrences, in the digest, ambient-afternoon, and ambient-evening cron entries):

```diff
-      --message "$(cat ${workspaceDir}/prompts/digest.md)"`,
+      --message "$(cat ${workspaceDir}/skills/index-network/prompts/digest.md)"`,
```

```diff
-      --message "$(cat ${workspaceDir}/prompts/ambient.md)"`,
+      --message "$(cat ${workspaceDir}/skills/index-network/prompts/ambient.md)"`,
```

(The third is another `ambient.md` occurrence — the evening cron — same substitution.)

After editing, verify no `workspace/prompts/` references remain:

```bash
grep -n "/prompts/" packages/edgeclaw/install/install_index.ts
```

Expected output: three lines, all containing `skills/index-network/prompts/`.

- [ ] **Step 2: Build to verify TypeScript compiles**

```bash
cd packages/edgeclaw && bun build install/install_index.ts --target=bun --outfile=/tmp/install-index-check.js && rm /tmp/install-index-check.js && cd -
```

Expected: build succeeds.

- [ ] **Step 3: Remove the old `workspace/prompts/` directory**

```bash
git rm -r packages/edgeclaw/workspace/prompts/
```

This stages the deletion of all three files plus the directory.

- [ ] **Step 4: Verify the directory is gone and the new location has the same files**

```bash
test ! -d packages/edgeclaw/workspace/prompts && echo "OK: old prompts removed"
ls packages/edgeclaw/skills/index-network/prompts/
```

Expected: `OK: old prompts removed`, then `ambient.md  digest.md  welcome.md`.

- [ ] **Step 5: Commit**

```bash
git add packages/edgeclaw/install/install_index.ts
git commit -m "fix(edgeclaw): point crons at skills/index-network/prompts/

Update install_index.ts cron --message paths and remove the orphaned
workspace/prompts/ directory. Prompts now live inside the Index Network
skill bundle, staged by install.ts copySkillFiles before cron install."
```

---

### Task 9: End-to-end install smoke test (Phase A acceptance)

**Files:** None modified — verification only.

This task verifies Phase A works before slimming workspace files in Phase B.

- [ ] **Step 1: Run a clean reset and re-install against the dev environment**

If you have an Index Network dev API key available, run:

```bash
cd packages/edgeclaw && bun install/reset.ts && cd -
cd packages/edgeclaw && bun install/install.ts <YOUR_DEV_API_KEY> --dev && cd -
```

If you do not have a dev API key, skip the live install and instead verify file staging by manually invoking `copySkillFiles`:

```bash
mkdir -p /tmp/edgeclaw-skills-check
bun -e 'import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs"; import { join } from "node:path"; const src = "packages/edgeclaw/skills"; const dst = "/tmp/edgeclaw-skills-check"; function walk(s, d){ if(!existsSync(s))return 0; if(!existsSync(d))mkdirSync(d,{recursive:true}); let n=0; for(const e of readdirSync(s)){ const sp=join(s,e), dp=join(d,e); const st=statSync(sp); if(st.isDirectory()) n+=walk(sp,dp); else if(e.endsWith(".md")){ copyFileSync(sp,dp); n++; } } return n; } console.log(walk(src,dst));'
```

Expected: a single line of output `7` (SKILL.md + tools.md + exemplars.md + bootstrap.md + heartbeat.md + 3 prompt files = 7 files; adjust expected count if you add more skill files).

- [ ] **Step 2: Verify the staged tree structure**

If you ran the live install:

```bash
ls ~/.openclaw/workspace/skills/index-network/
ls ~/.openclaw/workspace/skills/index-network/prompts/
test ! -d ~/.openclaw/workspace/prompts && echo "OK: old prompts/ absent"
```

Expected: the first `ls` shows `SKILL.md bootstrap.md exemplars.md heartbeat.md prompts tools.md`; the second `ls` shows `ambient.md digest.md welcome.md`; the third prints `OK: old prompts/ absent`.

- [ ] **Step 3: Verify OpenClaw registers the skill**

If you ran the live install:

```bash
openclaw skills list 2>&1 | grep -i "index-network"
```

Expected: a line mentioning `index-network` with the description starting "Edge Esmeralda's Index Network bundle".

```bash
openclaw skills info index-network 2>&1
```

Expected: detailed output including the SKILL.md path under `~/.openclaw/workspace/skills/index-network/`.

If the live install was skipped, this verification waits for Task 13's final smoke test.

- [ ] **Step 4: Verify the three EdgeClaw cron jobs have non-empty `--message` bodies**

If you ran the live install:

```bash
openclaw cron list --json | python3 -c 'import json,sys; jobs=json.load(sys.stdin).get("jobs",[]); [print(j["name"],"OK" if (j.get("message") or "").strip() else "EMPTY") for j in jobs if j["name"].startswith("EdgeClaw")]'
```

Expected: three lines, each ending in `OK`. (The cron `--message` was built by `cat $(...)/skills/index-network/prompts/<x>.md` at install time, so the body should be the full prompt text.)

- [ ] **Step 5: Tag the Phase A checkpoint commit**

No code change — just a checkpoint marker for clarity:

```bash
git commit --allow-empty -m "chore(edgeclaw): phase A checkpoint — bundle staged, crons repointed

End-to-end install produces the new skill bundle at
~/.openclaw/workspace/skills/index-network/, OpenClaw registers it, and
the three EdgeClaw cron jobs read prompts from the new location."
```

---

## Phase B — Slim workspace shells

### Task 10: Slim `workspace/TOOLS.md`

**Files:**
- Modify: `packages/edgeclaw/workspace/TOOLS.md`

Remove the Index protocol MCP section, tool families, scrape_url, and output translation (now in `skills/index-network/tools.md`). Keep channel formatting, URL preservation, and the Local files index. No pointer bullets to `skills/index-network/*` — OpenClaw's skill manifest is the discovery surface.

- [ ] **Step 1: Replace the file contents**

Overwrite `packages/edgeclaw/workspace/TOOLS.md` with:

```markdown
# TOOLS.md — Local Notes

## Local files

- `COMMUNITY.md` — Edge Esmeralda context (dates, attendee count, programming format, design principles). Read this whenever you need community facts for a welcome, digest, or candidate framing.
- `memory/heartbeat-state.json` — last-run timestamps for heartbeat tasks (so intervals survive restarts) and dedup state: `lastAmbientHash` (ambient pass short-circuit) and `deliveredToday` (cross-pass surfaced-IDs list, resets daily; shared by `digest.md` and `ambient.md`).
- `memory/welcome-state.json` — `welcomeDeliveredAt` timestamp once the welcome message has been sent (used by `prompts/welcome.md` for dedup).
- `memory/YYYY-MM-DD.md` — daily memory log.
- `MEMORY.md` — curated long-term memory; **main session only**.

## Channel formatting

- **Discord / WhatsApp:** no markdown tables; use bullet lists.
- **Discord:** wrap multiple links in `<>` to suppress embeds: `<https://example.com>`.
- **WhatsApp:** no headers — use **bold** or CAPS for emphasis.
- **Telegram:** Markdown rendering is on; the deep-link format `https://t.me/{handle}?text={uri-encoded-message}` pre-fills a draft when the user clicks.

## URL preservation

For any opportunity you surface, weave its URLs into the flow of your prose. The links must be **secondary** to the prose: a reader should be able to strip every URL and still have a coherent sentence about the person. If the visible text is just link labels glued together with punctuation, you have already lost.

Do **not** render links as a separate "buttons" line, a bullet list of links, a pipe-separated row, a markdown table, a blockquote whose body is link labels, or a short standalone paragraph whose only content is link labels. These all read as a UI control strip in chat.

- Link the person's name to their `profileUrl` the first time you mention them.
- Embed `acceptUrl` on a short verb phrase inside a sentence (e.g. "message Alex", "make intro", "reach out to them").
- The URL strings themselves must appear verbatim — do not edit, shorten, proxy, or drop them. Anchor text is up to you.
- If you decide not to mention an opportunity, leave it out — do not output its data without an inline action link.
```

- [ ] **Step 2: Verify the file no longer references the Index protocol**

```bash
grep -i "index protocol\|Tool families\|scrape_url\|Output translation" packages/edgeclaw/workspace/TOOLS.md
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/workspace/TOOLS.md
git commit -m "refactor(edgeclaw): slim workspace/TOOLS.md to cross-backend rules

Index MCP entity model, tool families, scrape_url, and output
translation moved to skills/index-network/tools.md. TOOLS.md keeps
Local files, Channel formatting (Discord/WhatsApp/Telegram), and URL
preservation — all backend-agnostic. No pointer bullets to skill
files; OpenClaw's skill manifest is the discovery surface."
```

---

### Task 11: Slim `workspace/AGENTS.md`

**Files:**
- Modify: `packages/edgeclaw/workspace/AGENTS.md`

Remove the canonical voice exemplars, greeting drafts, and Index-specific red lines (now in `skills/index-network/exemplars.md`). Remove `## First run` (now in `skills/index-network/bootstrap.md`). Rephrase `## How you talk to the protocol` to be backend-agnostic. Keep generic operating rules, memory section, surfacing-opportunities quality bar, generic red lines, group chats, and "Make it yours."

- [ ] **Step 1: Replace the file contents**

Overwrite `packages/edgeclaw/workspace/AGENTS.md` with:

```markdown
# AGENTS.md — Your Workspace

You are **EdgeClaw**, the agent for **Edge Esmeralda**. Your job is to keep the user's signals current and surface the opportunities worth interrupting them for. Edge Esmeralda is the only community in scope — read `COMMUNITY.md` for the dates, programming, and design principles. If your active skill has a bootstrap ritual, follow it before any other work.

## Session startup

Use the runtime-provided startup context first. Do not re-read `AGENTS.md` / `SOUL.md` / `USER.md` / `IDENTITY.md` unless:

1. The user explicitly asks
2. Something is missing from the provided context
3. You need a deeper follow-up read

Do not pre-fetch network data on startup. Look it up only when you have a reason to (the user asks, a heartbeat task runs, or a cron pass fires).

## Memory

- **Daily notes:** `memory/YYYY-MM-DD.md` — raw log of the day (decisions, context, things to remember).
- **Long-term:** `MEMORY.md` — your curated memories. **Main session only.** Do not load in shared/group sessions; it can contain personal context that shouldn't leak.
- **Heartbeat state:** `memory/heartbeat-state.json` — task last-run timestamps and dedup hashes.
- **Welcome state:** `memory/welcome-state.json` — `welcomeDeliveredAt` timestamp set after the welcome message lands.

Write things down. Mental notes don't survive restarts.

## How you talk to the backends

Each wired backend exposes its tools through MCP. Tool descriptions are authoritative; read them. You do not poll endpoints, you do not call `/api` directly — every capability is a tool call. For per-backend procedural knowledge (tool families, voice exemplars, ritual steps), read the relevant skill from your active skill manifest.

## Surfacing opportunities (visible)

When ambient or accepted opportunities qualify, you write to the user in their last-active channel. **Quality bar:** a candidate qualifies only when you can write a one-sentence reason that wouldn't read identically for any other user. Generic framings — "interesting profile", "might be useful", "works in a related space" — do not qualify; drop them. Anything you skip lands in the daily digest, so silence is correct routing, not a failure.

## Red lines

- Don't expose raw JSON, internal IDs, or internal vocabulary in user-facing replies.
- Don't accept a received opportunity without the user's explicit approval in the current conversation.
- Don't render link strips, action rows, or markdown tables of links in chat replies. Weave URLs into prose; the strip-the-URLs test in `TOOLS.md` is the rule.
- `trash` > `rm`. When in doubt, ask.

## Group chats

You have access to the user's stuff. That doesn't mean you share it. In group sessions, `MEMORY.md` does not load and discovery work does not run — you participate as a guest, not as the user's agent.

## Make it yours

This is a starting point. Add your own conventions, style observations, and rules as you figure out what works with this particular user.
```

- [ ] **Step 2: Verify the file is appropriately slim and Index-specific content is gone**

```bash
wc -l packages/edgeclaw/workspace/AGENTS.md
grep -i "Canonical voice exemplars\|Greeting drafts\|Welcome to Edge Esmeralda\|discover_opportunities\|connector-flow\|First run" packages/edgeclaw/workspace/AGENTS.md
```

Expected: line count ~40 (down from 133); the grep returns no output.

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/workspace/AGENTS.md
git commit -m "refactor(edgeclaw): slim workspace/AGENTS.md to cross-backend shell

Canonical voice exemplars (welcome / digest / ambient / greeting drafts)
moved to skills/index-network/exemplars.md. First run gate and the
Index-specific red lines moved to skills/index-network/bootstrap.md.
AGENTS.md now describes EdgeClaw's cross-backend operating rules,
memory, and surfacing-opportunities quality bar. The 'How you talk to
the protocol' paragraph is rephrased as backend-agnostic."
```

---

### Task 12: Slim `workspace/BOOTSTRAP.md` to a thin shell

**Files:**
- Modify: `packages/edgeclaw/workspace/BOOTSTRAP.md`

The six-step ritual moved to `skills/index-network/bootstrap.md`. The workspace file becomes a thin shell that points the agent at the active skill's ritual.

- [ ] **Step 1: Replace the file contents**

Overwrite `packages/edgeclaw/workspace/BOOTSTRAP.md` with:

```markdown
# BOOTSTRAP.md — Coming online

_You're EdgeClaw, the agent for Edge Esmeralda. Your tools, channels, and schedule are already in place — call MCP tools directly, never try to register, configure, or repair anything._

The server is the source of truth for whether the user has finished onboarding. At session start, call `read_user_profiles()` (no args) and check `onboardingComplete`.

- **If `onboardingComplete` is `false`:** run the onboarding ritual in your active skill's `bootstrap.md`. For Index Network, that is `skills/index-network/bootstrap.md`. Run it end-to-end. While the ritual is in progress, do not send unsolicited messages, do not call discovery tools, and do not run heartbeat tasks.
- **If `onboardingComplete` is `true`:** you're online. Heartbeat tasks, negotiation lookups, and chat are all available.

This file is **not** deleted at the end of onboarding — if an admin ever resets the `onboardingComplete` flag server-side, the next session will see `onboardingComplete: false` and re-enter the ritual from the still-staged skill file.
```

- [ ] **Step 2: Verify the file is ~12 lines and contains no Step definitions**

```bash
wc -l packages/edgeclaw/workspace/BOOTSTRAP.md
grep -i "^## Step\|create_user_profile\|complete_onboarding" packages/edgeclaw/workspace/BOOTSTRAP.md
```

Expected: line count ~12; the grep returns no output.

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/workspace/BOOTSTRAP.md
git commit -m "refactor(edgeclaw): slim workspace/BOOTSTRAP.md to thin shell

Six-step onboarding ritual moved to skills/index-network/bootstrap.md.
The workspace file keeps the session-start gate (onboardingComplete
check) and a pointer to the active skill's ritual. Preserved on
re-install via the existing 'BOOTSTRAP.md is not deleted' contract."
```

---

### Task 13: Slim `workspace/HEARTBEAT.md`

**Files:**
- Modify: `packages/edgeclaw/workspace/HEARTBEAT.md`

Remove `accepted-opportunities` and `signal-freshness` tasks (now in `skills/index-network/heartbeat.md`). Keep generic `memory-curation`, NO_REPLY discipline, cadence note (rephrased), additional instructions (MCP failure handling rephrased to be backend-agnostic).

- [ ] **Step 1: Replace the file contents**

Overwrite `packages/edgeclaw/workspace/HEARTBEAT.md` with:

```markdown
# HEARTBEAT.md — your background rhythm

EdgeClaw, you don't poll. The gateway pings you on a cadence (default 30m), and on each tick you decide: is there anything in the field worth a turn?

The tasks below tell you what to check, how often, and what to do with each result. **If `read_user_profiles()` reports `onboardingComplete: false`, the user is still onboarding — reply `NO_REPLY` and stop.** Otherwise, walk the task list, including any backend-specific tasks defined by your active skills. **If nothing is due and nothing alerts, reply `NO_REPLY`** — that's the entire contract.

> **`NO_REPLY` discipline.** `NO_REPLY` is OpenClaw's sentinel for "deliver nothing this turn." The recognizer accepts only the bare literal `NO_REPLY` (matched by `^\s*NO_REPLY\s*$`, case-insensitive) or the single-key JSON envelope `{"action":"NO_REPLY"}`. Anything else is delivered verbatim. Forbidden shapes that have leaked before — never produce these: `textNO_REPLY` / `replyNO_REPLY` / `_REPLY` (sentinel glued to other text); `{"action":"reply","content":"NO_REPLY"}` or `{"action":"NO_REPLY","reason":"..."}` (multi-key envelopes); `NO_REPLY` wrapped in quotes, code fences, or a `text`/`reply`/`message` tool call. If you call any output tool first, that output WILL be delivered to the user before `NO_REPLY` suppresses the rest. When a task says "reply `NO_REPLY` and stop", the assistant turn must be exactly `NO_REPLY` and nothing else.

Track last-run timestamps and dedup state in `memory/heartbeat-state.json`. If a task isn't due, skip it.

> **Note on cadence.** Heartbeat tasks below fire on the gateway tick (≈30m). Backend-specific fixed-time flows arrive as their own dispatches — they are NOT your responsibility to trigger; their prompt bodies live in the relevant skill's `prompts/` directory.

---

tasks:

- name: memory-curation
  interval: 3d
  prompt: |
    Curate. Do not announce.

    1. Read the last 3 days of `memory/YYYY-MM-DD.md` files.
    2. Identify significant events, decisions, lessons, or preferences worth long-term retention.
    3. Update `MEMORY.md` with distilled learnings (one short line each, indexed by topic).
    4. Remove outdated entries from `MEMORY.md` that are no longer relevant.

    Reply `NO_REPLY` when done — this is internal work; the user does not need a report.

# Additional instructions

- Backend-specific heartbeat tasks live in each active skill's `heartbeat.md`. Walk them on each tick alongside the generic tasks above.
- Keep alerts short. Quality > volume.
- Do not inject "checking in" filler. If nothing is due and nothing alerts, reply `NO_REPLY` and stop.
- Late night (host local 23:00–08:00): unless something is genuinely time-sensitive, defer to the morning digest — that's a cron job at 08:00.
- Heartbeats run in the user's main, private session. Do not run any of these tasks if the active session is shared/group — discovery is private. Reply `NO_REPLY` and stop.
- Tasks that change state (confirms, signal archives) are idempotent at the protocol layer; if a tool call fails, the next tick will pick it up.
- If a backend MCP is unreachable (its tools error out repeatedly), reply `NO_REPLY`, write a one-line note in `memory/<today>.md`, and stop. Do not surface MCP failures to the user from a heartbeat — that's noise. The user will notice when they next chat with you and you can explain then.
```

- [ ] **Step 2: Verify Index-specific task definitions are gone**

```bash
grep -i "accepted-opportunities\|signal-freshness\|list_opportunities\|read_intents" packages/edgeclaw/workspace/HEARTBEAT.md
```

Expected: no output.

```bash
grep -c "^- name:" packages/edgeclaw/workspace/HEARTBEAT.md
```

Expected: `1` (only `memory-curation`).

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/workspace/HEARTBEAT.md
git commit -m "refactor(edgeclaw): slim workspace/HEARTBEAT.md to backend-agnostic shell

accepted-opportunities and signal-freshness tasks moved to
skills/index-network/heartbeat.md. workspace/HEARTBEAT.md keeps the
generic memory-curation task, NO_REPLY discipline, the cadence note
(rephrased to point at skills' prompts/ directories generally), and
additional-instructions. MCP failure handling is rephrased to apply to
any backend, not just Index."
```

---

### Task 14: Update `packages/edgeclaw/README.md`

**Files:**
- Modify: `packages/edgeclaw/README.md`

- [ ] **Step 1: Update `### What's here`**

Locate the bullet list (around lines 27–31):

```markdown
- `workspace/IDENTITY.md` — what an EdgeClaw agent knows about itself and the village
- `workspace/` — the full runtime workspace bundle (prompts, soul, heartbeat, community context)
- `skills/` — directory for backend-specific skill bundles
- `onboarding/` — intent-capture flow for new agents (1 to 2 questions during setup)
- `install/` — bootstrap scripts for plugging EdgeClaw into a runtime
```

Replace with:

```markdown
- `workspace/IDENTITY.md` — what an EdgeClaw agent knows about itself and the village
- `workspace/` — backend-agnostic agent core (identity, voice, community context, generic operating rules)
- `skills/` — backend-specific skill bundles registered with OpenClaw via per-bundle `SKILL.md`. The Index Network bundle is shipped today; EdgeOS and Geo land alongside their backend wiring.
- `onboarding/` — intent-capture flow for new agents (1 to 2 questions during setup)
- `install/` — bootstrap scripts for plugging EdgeClaw into a runtime
```

- [ ] **Step 2: Update the `## Install` numbered list to add the skills-copy step**

Locate the list under "The installer:" (around lines 155–161):

```markdown
The installer:

1. Writes `mcp.servers.index` in `~/.openclaw/openclaw.json`, pointed at `https://protocol.index.network/mcp` with your API key in `x-api-key`.
2. Sets `channels.telegram.streaming.mode = off` so OpenClaw doesn't dump per-tool status drafts into your chat.
3. Copies the workspace markdown bundle into `~/.openclaw/workspace/`. `USER.md` is preserved on re-install (it holds your lived notes from `BOOTSTRAP.md`); pass `--wipe-user` to overwrite it.
4. Installs three cron jobs: daily digest (`0 8 * * *`), ambient discovery afternoon (`0 14 * * *`), ambient discovery evening (`0 20 * * *`).
5. Restarts the gateway so all config changes take effect.
```

Replace with:

```markdown
The installer:

1. Writes `mcp.servers.index` in `~/.openclaw/openclaw.json`, pointed at `https://protocol.index.network/mcp` with your API key in `x-api-key`.
2. Sets `channels.telegram.streaming.mode = off` so OpenClaw doesn't dump per-tool status drafts into your chat.
3. Copies the workspace markdown bundle into `~/.openclaw/workspace/`. `USER.md` is preserved on re-install (it holds your lived notes from `BOOTSTRAP.md`); pass `--wipe-user` to overwrite it.
4. Copies backend skill bundles from `skills/` into `~/.openclaw/workspace/skills/` so OpenClaw registers them as workspace skills.
5. Installs three cron jobs: daily digest (`0 8 * * *`), ambient discovery afternoon (`0 14 * * *`), ambient discovery evening (`0 20 * * *`).
6. Restarts the gateway so all config changes take effect.
```

- [ ] **Step 3: Update the `## Workspace layout` table**

Locate the table (around lines 198–210). Replace the existing rows with:

```markdown
| File | Purpose |
| --- | --- |
| `BOOTSTRAP.md` | Thin shell that checks `onboardingComplete` and dispatches to the active skill's `bootstrap.md`. Backend-agnostic. **Not** deleted at the end of onboarding — the server's `onboardingComplete` flag is the source of truth, so the file stays around in case onboarding ever needs to be re-run. |
| `AGENTS.md` | Cross-backend operating instructions: session startup, memory, surfacing-opportunities quality bar, generic red lines, group-chat rules. Per-backend voice exemplars and ritual steps live in the relevant skill. |
| `COMMUNITY.md` | Edge Esmeralda context — dates, attendee count, programming format, design principles. The agent reads this when composing welcomes and digests. |
| `SOUL.md` | Voice, banned vocabulary, "never name the plumbing", boundaries, continuity. |
| `IDENTITY.md` | EdgeClaw identity — role, context, tone. |
| `USER.md` | Lived notebook — populated by the active skill's bootstrap ritual from the user's onboarding answers. |
| `TOOLS.md` | Cross-backend rules: channel formatting (Discord/WhatsApp/Telegram), URL preservation, Local files index. Per-backend tool families live in the relevant skill. |
| `HEARTBEAT.md` | Generic heartbeat tick rules + the cross-backend `memory-curation` task. Backend-specific tasks live in each active skill's `heartbeat.md`. |
| `skills/index-network/SKILL.md` | Index Network skill bundle entry point. Registered with OpenClaw on install; gates on `mcp.servers.index`. Body points at the bundle's sibling reference files. |
```

- [ ] **Step 4: Verify the README has no stale references**

```bash
grep -i "workspace/prompts/\|prompts/\\*" packages/edgeclaw/README.md
```

Expected: no output. (The cron jobs section can mention the cron schedule but should no longer reference `workspace/prompts/` as a directory.)

- [ ] **Step 5: Commit**

```bash
git add packages/edgeclaw/README.md
git commit -m "docs(edgeclaw): update README for skills-extraction layout

What's here, Install numbered list, and Workspace layout table updated.
skills/ is now described as 'registered with OpenClaw via per-bundle
SKILL.md'. The install list gains a 'Copies backend skill bundles...'
step. The workspace layout table reflects the slim shells: AGENTS,
BOOTSTRAP, HEARTBEAT, TOOLS are described as backend-agnostic; a new
row points at skills/index-network/SKILL.md."
```

---

### Task 15: Final end-to-end verification (Phase B acceptance)

**Files:** None modified — verification only.

This task validates the full acceptance criteria from the spec.

- [ ] **Step 1: Build both installer entry points**

```bash
cd packages/edgeclaw && bun build install/install.ts --target=bun --outfile=/tmp/install-final.js && bun build install/reset.ts --target=bun --outfile=/tmp/reset-final.js && rm /tmp/install-final.js /tmp/reset-final.js && cd -
```

Expected: both builds succeed.

- [ ] **Step 2: Verify `npm pack --dry-run` includes the new skill files**

```bash
cd packages/edgeclaw && npm pack --dry-run 2>&1 | grep "skills/index-network" && cd -
```

Expected: lines listing `skills/index-network/SKILL.md`, `tools.md`, `exemplars.md`, `bootstrap.md`, `heartbeat.md`, and the three `prompts/*.md` files. The package's `files` entry already includes `"skills/"`, so no `package.json` edit is needed.

- [ ] **Step 3: Run a clean reset + install on the dev environment**

If you have a dev API key:

```bash
cd packages/edgeclaw && bun install/reset.ts --wipe-user && cd -
cd packages/edgeclaw && bun install/install.ts <YOUR_DEV_API_KEY> --dev && cd -
```

- [ ] **Step 4: Verify the staged workspace state**

If the live install ran:

```bash
# Skill bundle files present
ls ~/.openclaw/workspace/skills/index-network/
ls ~/.openclaw/workspace/skills/index-network/prompts/

# Slim shells in place
wc -l ~/.openclaw/workspace/AGENTS.md \
      ~/.openclaw/workspace/BOOTSTRAP.md \
      ~/.openclaw/workspace/HEARTBEAT.md \
      ~/.openclaw/workspace/TOOLS.md

# Old prompts directory gone
test ! -d ~/.openclaw/workspace/prompts && echo "OK: old prompts/ absent"
```

Expected: the first two `ls` commands match Task 9 Step 2; `wc` shows each slim shell well under their original sizes (AGENTS ~40 lines vs 133 original, BOOTSTRAP ~12 vs 85, HEARTBEAT ~30 vs 65, TOOLS ~25 vs 73); the test prints `OK: old prompts/ absent`.

- [ ] **Step 5: Verify OpenClaw registers the skill and the crons are bound**

```bash
openclaw skills list | grep index-network
openclaw skills info index-network
openclaw cron list --json | python3 -m json.tool | grep -A1 "EdgeClaw"
```

Expected: the skill appears with the description starting "Edge Esmeralda's Index Network bundle"; the info command shows the SKILL.md path under workspace; each EdgeClaw cron job has a non-empty body.

- [ ] **Step 6: Manual bootstrap walk-through (optional, requires a test user)**

If you can spare a fresh test user (e.g. create a new Index Network dev account), send the agent a message and verify the bootstrap path:

1. Agent reads `~/.openclaw/workspace/BOOTSTRAP.md` (the thin shell).
2. Agent sees `onboardingComplete: false` from `read_user_profiles()`.
3. Agent picks up the `index-network` skill from the manifest (per its description).
4. Agent reads `~/.openclaw/workspace/skills/index-network/bootstrap.md`.
5. Walks Steps 1–6 of the ritual: `create_user_profile` → `create_intent` → silent handle capture → `complete_onboarding` → USER.md update → welcome pass via `prompts/welcome.md`.
6. The welcome message lands on Telegram.

If you cannot perform this walk-through, note it in the merge description as "deferred manual verification."

- [ ] **Step 7: Tag the Phase B checkpoint commit**

```bash
git commit --allow-empty -m "chore(edgeclaw): phase B checkpoint — workspace shells slimmed, README updated

All four workspace shells (AGENTS, BOOTSTRAP, HEARTBEAT, TOOLS) reduced
to backend-agnostic shells; per-backend procedural knowledge lives in
the Index Network skill bundle. README install steps, what's-here
blurb, and workspace layout table reflect the new shape."
```
