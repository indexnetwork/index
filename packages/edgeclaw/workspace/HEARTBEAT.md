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
