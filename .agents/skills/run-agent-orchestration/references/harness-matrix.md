# Harness matrix (pi, codex, kimi — equal tiers)

Pi, Codex, and Kimi are equally supported at every tier (`main`, `root`, `child`).
The harness for `root` is recommended by `main` at wave kickoff and confirmed by the
user; children may mix harnesses freely within one wave. This file is the single
source of truth for launch lines and per-harness capabilities. Model choice per role
lives in `model-routing.md`.

## Launch lines

Always launch through the exact, non-focusing pane ID returned by
`herdr worktree open --no-focus --json` (root and standalone sessions) or
`herdr tab create --no-focus` (wave children):

```bash
herdr pane send-text "$PANE_ID" "<launch line>"
herdr pane send-keys "$PANE_ID" enter
```

| Harness | Launch line | Notes |
|---|---|---|
| codex | `codex --model gpt-5.6-terra -c model_reasoning_effort="high"` | Model + effort pinned at launch; never switched mid-session. |
| pi | `pi --model anthropic/claude-opus-4-8:high` | `--model provider/id[:<thinking>]`; thinking levels `off\|minimal\|low\|medium\|high\|xhigh`. |
| kimi | `kimi -m kimi-code/k3` (children add `--auto`) | `-m` takes a config alias; `--auto` = fully autonomous, `--yolo` = auto-approve but may still ask. |

## Capability matrix

| Dimension | codex | pi | kimi |
|---|---|---|---|
| Structured questions | Approval/question UI; Herdr detects `blocked` from the screen | `ask_user_question` selector TUI; pane shows `screen_detection_skipped: true` — do **not** rely on `blocked` detection alone | `--auto` **cannot ask**; it must stop and report `status: blocked` in its `CHILD_RESULT` envelope |
| Blocked-state check | `herdr agent get` state + pane read | `herdr agent explain` + pane read of the visible UI | Envelope-only; tick the pane if no envelope arrives |
| Persistence discipline | Self-driven coordination ticks within long turns | Run the wave under an active `/goal`; mirror wave state in the `todo` tool with `blockedBy` sequencing | Turn-based; the parent must tick it |
| Quota | Visible footer meter — quota bands in `model-routing.md` apply | API-key billing; bands N/A — downgrade deterministically on provider 429/errors and report to `main` | API-key/subscription; same rule as pi |
| Linear operations | `codex_apps.linear.save_issue` | `linear-index` MCP (`save_issue`, `save_comment`) | `gh` CLI + MCP where configured |
| Session identity (resume) | Codex session id (`herdr agent get` → `agent_session.value`) | Session `.jsonl` path; resume with `pi --session <path>` | Kimi session id; resume with `kimi -S <id>` |
| Compaction | `/compact` at a safe idle boundary | `/compact` at a safe idle boundary | No manual compaction contract — the checkpoint journal is the continuity mechanism |

## Handoff capability line (mandatory)

Every child handoff embeds the recipient harness's capability line so the child knows
its escalation rule:

- **pi child**: "You may raise genuine blockers as structured questions; routine
  choices are answered by your parent on a tick."
- **codex child**: "Approvals surface in your UI; your parent answers routine ones on
  a tick. Do not wait silently — finish or report blocked."
- **kimi `--auto` child**: "You cannot ask questions. On a genuine blocker, stop and
  report `status: blocked` in your `CHILD_RESULT` envelope to the parent pane."

## Detection caveats

Pi and Kimi panes report `screen_detection_skipped: true`: Herdr's screen-based
state detection is weaker than for Codex. Treat `idle`/`done`/`working` for those
harnesses as hints, not facts — verify with `herdr agent explain`, a bounded pane
read, and the independent git/PR checks from `coordination-loop.md` before acting.

## Tool-mapping rule

Never send a harness a tool it does not have. When writing a handoff, translate
Linear/GitHub instructions per the capability matrix above (e.g. codex
`codex_apps.linear.save_issue` ↔ pi `linear-index` MCP `save_issue`). If the
recipient has no working route for a required operation, keep that operation at the
tier that has one (usually `root`).
