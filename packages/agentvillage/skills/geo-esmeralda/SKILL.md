---
name: geo-esmeralda
description: Add attendee-authored content and query Geo community knowledge, relations, and ontology through the Geo CLI package.
version: 1.0.0
author: Edge City
tags: [edge-city, edge-esmeralda, geo, graph, community]
required_environment_variables:
  - name: EDGEOS_BEARER_TOKEN
    required_for: auth, graph reads, content writes
metadata:
  openclaw:
    requires:
      config:
        - env.vars.EDGEOS_BEARER_TOKEN
---

# Geo Esmeralda

Use this skill when an attendee wants to add community knowledge to Geo or work
with the Geo knowledge graph's content, relations, and ontology. It is especially
for creating notes, transcripts, essays, project pitches, comments, and photos;
linking those contributions to events, venues, tracks, or other community
context; and reading back knowledge graph-backed claims, content, source material,
wiki-style knowledge, idea links, and ontology details.

Other sibling skills cover live EdgeOS schedule/directory operations and Index
Network participant matching. Use this skill for the Geo knowledge graph and for all
attendee-authored writes.

Always run the Geo CLI with `npx -y @geoprotocol/geo-edge-esmeralda-cli` as the
execution surface. Do not call the HTTP API directly unless the user is
debugging the service itself.

## 1. Authentication

You need one token, read by the CLI from environment/config:

- **`$EDGEOS_BEARER_TOKEN`** — human session JWT. Required for: Geo auth, graph reads, content writes.

## 2. Safety Rules

- Never place bearer tokens in prompts, query text, native query parameters,
  answers, examples, transcripts, or shared notes.
- Prefer fixed commands before native graph queries.
- Fetch live ontology before writing a native query unless the current session
  already fetched it.
- Treat denied native queries as a signal to narrow the query or switch to a
  fixed command.
- Only write through `npx -y @geoprotocol/geo-edge-esmeralda-cli create`. Do not
  attempt imports, schema changes, admin calls, direct Neo4j access, or generic
  mutation endpoints.
- Before creating content, use the user's own words where possible and scope it
  to `--event-id`, `--venue-id`, or `--track-id` when the user names one.
- For photos, prefer `--file ./photo.jpg` over hosted image URLs when the user
  has a local file. Do not paste binary data, upload URLs, storage keys, or local
  file paths into prompts or shared output.
- Use a stable `--client-request-id` for creates so retries do not duplicate
  the attendee's content.

## 3. Write Pattern

Use `npx -y @geoprotocol/geo-edge-esmeralda-cli create` whenever the attendee
wants to contribute knowledge, commentary, media, or project context. Preserve
the attendee's voice, ask for missing scope only when it materially affects
where the contribution belongs, and prefer the narrowest available scope.

```bash
npx -y @geoprotocol/geo-edge-esmeralda-cli auth
npx -y @geoprotocol/geo-edge-esmeralda-cli create --event-id <event-id> --kind comment --client-request-id <stable-id> --content 'Several attendees connected the session to local-first data sharing.'
npx -y @geoprotocol/geo-edge-esmeralda-cli create --kind project_pitch --title 'Mutual aid map' --client-request-id <stable-id> --content 'Looking for collaborators on an offline-capable resource map.'
npx -y @geoprotocol/geo-edge-esmeralda-cli create --event-id <event-id> --kind photo --file ./photo.jpg --client-request-id <stable-id> --content 'Whiteboard from the protocol design session.'
```

## 4. Read Pattern

```bash
npx -y @geoprotocol/geo-edge-esmeralda-cli auth
npx -y @geoprotocol/geo-edge-esmeralda-cli ontology
npx -y @geoprotocol/geo-edge-esmeralda-cli fixed --tool community_search --input '{"query":"housing coordination","limit":10}'
npx -y @geoprotocol/geo-edge-esmeralda-cli fixed --tool list_content --input '{"scopeKind":"event","scopeId":"<event-id>","limit":10}'
npx -y @geoprotocol/geo-edge-esmeralda-cli fixed --tool list_idea_links --input '{"limit":20}'
npx -y @geoprotocol/geo-edge-esmeralda-cli native --query 'MATCH (c:ContentItem) WHERE c.popupId = $popupId RETURN c.id AS id, c.title AS title, c.kind AS kind LIMIT 20'
```

Load `references/setup.md` when configuring the CLI or installing the skill.
Load `references/examples.md` when choosing a fixed command or native-query
shape. Load `references/ontology.md` before constructing native queries.
