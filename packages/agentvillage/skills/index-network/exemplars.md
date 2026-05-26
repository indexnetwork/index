# Index Network — Voice Exemplars

Canonical user-facing renderings for Edge Esmeralda's Index Network flows. Mimic these exactly when composing the welcome message, daily digest, ambient passes, and greeting drafts. They are the bar for tone, structure, and information density. Edge Esmeralda is the literal community in every example — pull facts from `AGENTS.md` Community context, never invent dates, attendee counts, or programming formats.

## Welcome (fires once, after onboarding completes)

The welcome opener is a **single line** — `Welcome to Edge Esmeralda`. Do NOT repeat the agent intro from `bootstrap.md` Step 1 ("I'm Edge, your agent. I help the right people find you, help you find them, and answer anything you need about the village") — the user already met you minutes ago, repeating it reads as filler. Go straight from the welcome line to the community context paragraph.

> Welcome to Edge Esmeralda
>
> Four weeks in Healdsburg, May 30 to June 27, 2026 — 500+ residents across the month, ~150 on-site at any given time, building at the frontiers of tech, science, culture, and policy. Tracks, residencies, and applied experiments run in parallel; the village is engineered for cross-pollination. Your agent is already finding out what exactly brought each of them here, and how it could matter to you.
>
> While you unpack, it's been working with other residents' agents in the background, surfacing the people who need what you're building, build adjacent to it, or want to fund it. Here's what landed in the first pass.
>
> **3 conversations waiting**
> - [Maya]({profileUrl}) — Talk to them about agent memory for long-running workflows. Direct overlap with how Index handles persistent context, [message Maya]({acceptUrl})
> - [Theo]({profileUrl}) — How information surfaces in decentralized networks. The kind of thinking that sharpens protocol design — [see what you can learn from them]({acceptUrl})
> - [Priya]({profileUrl}) — Community-owned data infrastructure. Aligned on ownership, complementary on discovery, could be interesting to [explore your overlap]({acceptUrl})
>
> **Help your community**
> A few residents are looking for something specific. If you know someone who fits, a quick nudge goes a long way.
> - [Remi]({profileUrl}) — Looking for a technical co-founder for his regenerative education platform. Know a systems thinker who's shipped infra, make intro
> - [Kai]({profileUrl}) — Needs people deep in decentralized discovery — agent tooling, knowledge graphs, semantic search. Bring one to his 3pm, make intro
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
> - [Maya]({profileUrl}) — Talk to them about agent memory layer for long-running workflows. Direct overlap with how Index handles persistent context, [message Maya]({acceptUrl})
> - [Theo]({profileUrl}) — Researching how information surfaces in decentralized networks. That's the type of thinking that sharpens protocol design, [see what you can learn from them]({acceptUrl})
> - [Priya]({profileUrl}) — Building community-owned data infrastructure. Aligned on the ownership layer and complementary on discovery, could be interesting to [explore overlaps]({acceptUrl})
>
> **Help your community find their opportunities**
> A few residents are looking for something specific. If you know someone who fits, a quick nudge goes a long way.
> - [Remi]({profileUrl}) — Looking for a technical co-founder for his regenerative education platform. Needs someone who thinks in systems and has shipped infra. Know anyone, make intro
> - [Kai]({profileUrl}) — Needs people deep in decentralized discovery — agent tooling, knowledge graphs, semantic search. Bring one to his 3pm open conversation, make intro
> - [Celia]({profileUrl}) — Designing governance tooling for popup communities. Coordination, consent, collective decision-making. Point her at the right people, make intro

## Ambient update (fires twice daily at 14:00 and 20:00 host-local)

Two sections are possible: direct (the user is a party — link the name to `profileUrl`, embed `acceptUrl` + `&msg=` greeting) and introducer (the user is the introducer — render community intents, still link the name to `profileUrl`, but no `acceptUrl` and no `&msg=`). Skip a section that has no qualifying candidates. Per-pass cap: max 3 direct + 3 introducer.

> **New conversations worth starting**
> - [Erik Leibner]({profileUrl}) — Senior software engineer focused on AI systems. There's a clear overlap with how you're thinking about decentralized search + agents. Feels like a "build together" type conversation, [message Erik]({acceptUrl})
> - [Tiina]({profileUrl}) — Co-founder at Hopscotch Labs and Sane. Working on creativity and knowledge organization. Different entry point, same underlying problem space — could spark something interesting, [message Tiina]({acceptUrl})
> - [Xavier Meegan]({profileUrl}) — Founder & CIO at Frachtis. Deep in decentralized infrastructure and AI. Good person to pressure-test ideas and explore where things could connect, [message Xavier]({acceptUrl})
>
> **Help your community find their opportunities**
> A few residents are looking for something specific. If you know someone who fits, a quick nudge goes a long way.
> - [Remi]({profileUrl}) — Looking for a technical co-founder for his regenerative education platform. Needs someone who thinks in systems and has shipped infra. Know anyone, make intro
> - [Kai]({profileUrl}) — Needs people deep in decentralized discovery — agent tooling, knowledge graphs, semantic search. Bring one to his 3pm, make intro
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
