# Edge Esmeralda 2026 — Agent Skill

A skill that gives AI agents popup-specific knowledge for Edge Esmeralda 2026: popup constants (popup id, week dates, themes), attendee-directory field semantics, and the curated wiki / website / newsletter knowledge base.

For backend-agnostic EdgeOS API recipes (events, RSVPs, venues, the directory endpoint itself, your own profile), pair this with the sibling `../edgeos/` skill. For Index Network discovery, pair with `../index-network/`.

## For Users (Attendees)

**Download [`SKILL.md`](./SKILL.md)** and add it to your agent's skill/context alongside `../edgeos/SKILL.md`:

- **Claude Code**: copy both files to `~/.claude/skills/edge-esmeralda/SKILL.md` and `~/.claude/skills/edgeos/SKILL.md` respectively.
- **OpenClaw / Hermes / NanoClaw**: add to your agent's skill directory.

Set environment variables (the `edgeos` skill needs both; this skill needs none):
```bash
export EDGEOS_API_KEY="eos_live_..."      # Long-lived automation key for events, RSVPs, venues
export EDGEOS_BEARER_TOKEN="..."          # Human session JWT for directory, own profile
```

## For Maintainers

This repo contains the indexer that keeps the skill's reference content fresh.

### Setup
```bash
bun install
```

### Run indexer
```bash
bun run scripts/index.ts
```

This fetches and preprocesses content from:
- **Notion wiki** (Edge Esmeralda 2026 Wiki) → `references/wiki-content.md`
- **Edge City website** (edgecity.live) → `references/website-content.md`
- **Substack newsletter** (edgeesmeralda2026.substack.com) → `references/newsletter-digest.md`

A GitHub Action in `Edge-City/agentvillage` runs the indexer every 15 minutes and commits any changes; local runs are only needed when iterating on the indexer code itself.

### Data Sources

| Source | Type | Auth | Status |
|--------|------|------|--------|
| Notion Wiki | Preprocessed | None (public) | Live |
| Edge City Website | Preprocessed | None | Live |
| Substack Newsletter | Preprocessed | None | Live |

For live EdgeOS API data sources (events, attendees, venues), see the `edgeos` skill's `SKILL.md` and its accompanying recipes.

## When updating `SKILL.md`

- Bump the `version` field in `SKILL.md` frontmatter (semver: patch for content tweaks, minor for new sections, major for breaking the cross-skill contract with `edgeos`/`index-network`).
- Keep additions scoped to popup-specific content. EdgeOS API recipes belong in `../edgeos/`; semantic discovery belongs in `../index-network/`.
- If your update touches an env var the user must set, update the Setup section in this README too.
