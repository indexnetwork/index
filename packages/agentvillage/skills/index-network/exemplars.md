# Index Network — Voice Exemplars

Canonical user-facing renderings for Edge Esmeralda's Index Network flows. Mimic these exactly when composing the daily digest, ambient passes, and greeting drafts. They are the bar for tone, structure, and information density. Edge Esmeralda is the literal community in every example — pull facts from `AGENTS.md` Community context, never invent dates, attendee counts, or programming formats.

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
