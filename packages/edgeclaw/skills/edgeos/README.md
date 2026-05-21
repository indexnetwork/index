# Edge Esmeralda 2026 — Agent Skill

A single-file skill that gives AI agents access to Edge Esmeralda 2026 data: event schedule, attendee directory, wiki, newsletters, and organization info.

## For Users (Attendees)

**Download [`SKILL.md`](./SKILL.md)** and add it to your agent's skill/context:

- **Claude Code**: Copy to `~/.claude/skills/edgeos/SKILL.md`
- **OpenClaw / Hermes / NanoClaw**: Add to your agent's skill directory

Set environment variables:
```bash
export EDGEOS_API_KEY="eos_live_..."      # Required for the calendar (events, RSVPs, venues)
export EDGEOS_BEARER_TOKEN="your-token"   # Required for attendee directory search
export INDEX_API_KEY="ix_..."             # Required for the Index Network discovery layer (§3)
```

Generate the calendar token from the EdgeOS portal under `/portal/api-keys`. Generate the Index Network key at `index.network/agents` (or a community-branded node).

## For Maintainers

This repo contains backend infrastructure that keeps the skill's reference content fresh.

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

A GitHub Action runs the indexer every 15 minutes and commits any changes.

### Data Sources

| Source | Type | Auth | Status |
|--------|------|------|--------|
| EdgeOS Events (api.edgeos.world) | Live API | Bearer token (eos_live_...) | Live |
| EdgeOS Attendees (api-citizen-portal.simplefi.tech) | Live API | Bearer token | Live |
| Notion Wiki | Preprocessed | None (public) | Live |
| Edge City Website | Preprocessed | None | Live |
| Substack Newsletter | Preprocessed | None | Live |
| Index Network (semantic search) | Live MCP | `x-api-key` (ix_...) | Live |
| Geo Browser (spatial / map) | Live API | TBD | **Placeholder — awaiting PR** |

## Contributing tooling (Geo Browser, others)

One section in `SKILL.md` is still reserved as a stub for an external team to PR concrete tooling into:

- **§4 Spatial Browsing (Geo Browser)** — marker: `<!-- GEO_BROWSER_PLACEHOLDER ... END -->`

(§3 Knowledge Discovery was previously a placeholder; it is now live — see SKILL.md.)

To contribute a section:

1. Open a PR replacing the placeholder block (everything between the marker comments) with:
   - The endpoint(s) or SDK calls the agent should make
   - Auth: env var name, scope, and how a user obtains a token
   - 3–5 curl/SDK examples covering the common flows
   - Expected response shape, including error codes
   - When NOT to use the tool (overlap with EdgeOS or other sections)
2. Remove the `<!-- ..._PLACEHOLDER ... END -->` marker comment.
3. Update the row in the Data Sources table above (`Status: Live`, fill `Auth`).
4. Bump the `version` field in `SKILL.md` frontmatter (e.g. 2.1.0 → 2.2.0).
5. If your section needs env vars, add them to `.env.example`.

Keep additions self-contained — the skill is a single file users download, so external imports / multi-file refactors aren't accepted.
