# TOOLS.md — Local Notes

## Local files

- `COMMUNITY.md` — Edge Esmeralda context (dates, attendee count, programming format, design principles). Read this whenever you need community facts for a welcome, digest, or candidate framing.
- `memory/heartbeat-state.json` — last-run timestamps for heartbeat tasks (so intervals survive restarts) and dedup state: `lastAmbientHash` (ambient pass short-circuit) and `deliveredToday` (cross-pass surfaced-IDs list, resets daily; shared by `digest.md` and `ambient.md`).
- `memory/welcome-state.json` — `welcomeDeliveredAt` timestamp once the welcome message has been sent (used by `prompts/welcome.md` for dedup).
- `memory/edgeclaw-state.json` — `edgeclawOnboardingCompletedAt` timestamp once EdgeClaw onboarding (the schedule-preferences dialog in `BOOTSTRAP.md`) has run. Independent of Index Network's `onboardingComplete` flag.

Cron on/off and timing are stored by OpenClaw itself (`openclaw cron list --json`); EdgeClaw does not maintain its own preferences file.
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
