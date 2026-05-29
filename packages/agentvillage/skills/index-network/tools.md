# Index Network — Tools

The Index Network MCP (server `index`) is your tool surface for everything network-related. The MCP entry was registered by `install_index.ts` before the agent started; you don't configure, register, install, curl HTTP endpoints, or poll APIs. Every capability is a tool call on `index`. If a tool errors, retry it or end silently using this host's no-reply marker; do not try to "fix" the connection.

## Tool families

- **Profile** — `read_user_profiles`, `record_onboarding_privacy_consent`, `preview_user_profile`, `confirm_user_profile`, `create_user_profile` (legacy/generic clients), `update_user_profile`
- **Networks (communities)** — `read_networks`, `create_network`, `update_network`, `delete_network`, `read_network_memberships`, `create_network_membership`, `delete_network_membership`
- **Signals (intents)** — `create_intent`, `read_intents`, `update_intent`, `delete_intent`, `search_intents`, `create_intent_index`, `read_intent_indexes`, `delete_intent_index`
- **Discovery** — `discover_opportunities`, `list_opportunities`, `update_opportunity`, `confirm_opportunity_delivery`
- **Negotiations** — `list_negotiations`, `get_negotiation` (read-only — negotiations are handled server-side; do not call `respond_to_negotiation`)
- **Conversations** — `list_conversations`, `get_conversation`
- **Contacts** — `add_contact`, `import_contacts`, `import_gmail_contacts`, `list_contacts`, `search_contacts`, `remove_contact`
- **Agents (administrative)** — `list_agents`, `register_agent`, `update_agent`, `delete_agent`, `grant_agent_permission`, `revoke_agent_permission`
- **Onboarding** — `record_onboarding_privacy_consent`, `preview_user_profile`, `confirm_user_profile`, `complete_onboarding`
- **Reference** — `read_docs`, `scrape_url`

Read the description on every tool you call — that is where the per-tool rules live (when to call, when NOT to call, prerequisites, post-call follow-ups).

## Tool routing — finding people

When the user wants to **find people to connect with, meet, or talk to** ("find AI agent builders", "who should I meet?", "looking for investors"):
→ Use `discover_opportunities` with a `searchQuery`. It is the only tool that *discovers new* connections, and its cards carry actionable `profileUrl` and `acceptUrl` links. Each opportunity gets its own `acceptUrl` — that is how the user acts on it. (`list_opportunities` also returns these links for *already-pending* opportunities; it is the tool the morning digest builds from. Both are the only sources of real `acceptUrl`s — every other path produces none, and a URL you attach without one is fabricated.)

**If `discover_opportunities` returns no results, that is the answer.** Tell the user no connections were found. You may fall back to `list_opportunities` to check for existing pending opportunities — but that is the only fallback. Do NOT fall back to profile, membership, or intent tools to manually find and present people as if they were opportunities. That path has no `profileUrl` or `acceptUrl`, produces no opportunity records, and any URLs you attach would be fabricated.

When the user wants to **look up a specific person** by name or check a known profile:
→ Use `read_user_profiles(query=name)`. Returns profile data but no actionable URLs.

## `scrape_url` — when to use it

Call `scrape_url(url, objective)` whenever the user shares a URL and you need its content:

- **Profile enrichment** — user shares a LinkedIn, GitHub, personal site, or any professional URL → scrape it, then pass the content to `update_user_profile` or `create_user_profile`.
- **Signal creation from a URL** — user shares a project page, job post, or article and wants to turn it into a signal → scrape it first, then synthesize a description for `create_intent`.
- **Research** — user asks "what is this?" or "who is this person?" about a URL → scrape and summarize.
- **Opportunity context** — a counterpart's profile has a URL in their bio → scrape it to write a sharper, more specific greeting.

Always pass an `objective` describing why you're scraping — it guides extraction. Example: `scrape_url(url="linkedin.com/in/alex", objective="Update user profile from LinkedIn page")`.

During AgentVillage onboarding, privacy questions are hard turn boundaries. After asking a consent question, stop and wait for the user's next message; do not record consent in the same turn as the question. Do not scrape or run public profile lookup until the user explicitly answers yes and `record_onboarding_privacy_consent(publicProfileLookupGranted=true)` has succeeded. Do not use EdgeOS/import data until the user explicitly answers yes and `record_onboarding_privacy_consent(edgeosImportGranted=true)` has succeeded. Use `preview_user_profile` for drafts only after both consent questions have explicit answers, and use `confirm_user_profile` only after the user has seen and approved/corrected the draft. Do not use legacy `create_user_profile` for the AgentVillage onboarding ritual.

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
