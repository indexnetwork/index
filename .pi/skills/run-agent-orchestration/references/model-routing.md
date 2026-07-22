# Model routing (launch-time, OpenAI-first, no GPT-5.5)

Models are chosen **at child launch time** and never switched mid-implementation.
A child that needs a stronger model is stopped and relaunched with a fresh handoff,
not hot-swapped.

Before **every** child launch, the root orchestrator re-reads the visible Pi footer
quota state and routes by the table and quota bands below. Routing is deterministic
skill logic based on that visible footer; do not parse quota UI with a brittle
extension. A preset/model-routing extension is a later option only if a stable quota
API becomes available.

**GPT-5.5 is banned.** Use the GPT-5.6 Sol/Terra/Luna variants instead.

## Launch syntax and focus safety

Open worktrees without stealing the user's active `index` workspace, then launch Pi
through the exact, non-focusing pane ID:

```bash
herdr worktree open --path WORKTREE_PATH --label LABEL --no-focus --json
herdr pane send-text PANE_ID "pi --model provider/model:thinking"
herdr pane send-keys PANE_ID enter
```

All direct pane reads, text, and keys must target the exact pane ID and must not
focus it. Do not use `--focus`; the `index` workspace remains the user's active
workspace. `herdr agent start` is not the normal launch path. If it is unavoidable as
a fallback, capture the current active workspace first and immediately restore
`index` afterward; never leave the user's focus changed.

## Coordination wait safety

This reference's launch rules do not make the user-facing main session wait. In the
`index` (`wX`) workspace, main → root submissions use `herdr agent prompt NAME "..."`
without `--wait` and return immediately; main only inspects root state on a later
natural user turn or explicit orchestration tick. No polling, sleeps, watcher
processes, or timeout loops are allowed on that path.

Dedicated root orchestrators and implementation children run outside `index`. For
root → child coordination, use exactly one server-owned
`herdr agent prompt NAME "..." --wait` with no timeout. Children signal via a
structured question (`blocked`) or final `RESULT`; do not sleep-poll, run watchers,
or use timeout loops.

## Default OpenAI-first routing

| Agent / role | Model | Fallback / escalation |
|---|---|---|
| Root orchestrator | `openai-codex/gpt-5.6-terra:high` | `openai-codex/gpt-5.6-sol:high` |
| Protocol specialist / privacy-critical | `openai-codex/gpt-5.6-sol:high` | `anthropic/claude-opus-4-8:high` for quota-aware independent review |
| API backend implementation (normal) | `openai-codex/gpt-5.6-terra:high` | Sol only for cross-cutting, concurrency, or rebase escalation |
| Web implementation (normal) | `openai-codex/gpt-5.6-terra:high` (`:medium` for tightly scoped changes) | Sol only for cross-cutting, concurrency, or rebase escalation |
| Mechanical UI / tests / docs / recon | `openai-codex/gpt-5.6-luna:medium` or `openai-codex/gpt-5.6-luna:high` | Use the appropriate Luna thinking level for scope |
| Release / review / rebase | `openai-codex/gpt-5.6-terra:high` | `openai-codex/gpt-5.6-sol:high` for critical review |

`anthropic/claude-sonnet-5` and `anthropic/claude-haiku-4-5` are secondary Claude
alternatives only when Claude global headroom is healthy; they are never ordinary
defaults. `anthropic/claude-fable-5` and `kimi-coding/k3` are reserve/emergency
models, not normal routing rows.

Sol is an escalation model rather than the normal default, except for the
protocol/privacy-critical primary route above. Luna is only for low-risk mechanical
work, never protocol, auth, or data-mutation code.

## Quota bands

Measure the bands as the **consumed percentage shown in the visible Pi footer**:

| Consumed | Band | Routing rule |
|---|---|---|
| `<70%` | Healthy | Normal routing is permitted. |
| `70–79%` | Conservation | Do not choose that provider/model when a suitable Sol/Terra/Luna route exists. |
| `80–89%` | Reserve | No ordinary new launches. Allow only an explicit high-risk exception and document it to the user with the quota reading. |
| `>=90%` | Exhausted / hold | No new launches without explicit user override. |

Apply these bands to both provider-wide meters and model-specific meters; the
**stricter band wins**. For example, Fable-specific consumption of 93% is hold even
when the Anthropic global meter is healthier.

Before every child launch, re-read the footer. If the selected model has crossed a
band, cycle deterministically to the next suitable OpenAI model for the role: Terra
→ Sol for risk/escalation paths, and Luna for low-risk work. Never hot-swap a running
implementation session; stop it and relaunch it with a fresh handoff when it needs a
stronger model. If no suitable route remains under the bands, hold and request the
user's explicit override rather than launching a reserve/emergency model by default.

## Overrides

A user model override always wins — record it in the wave handoff so the root
orchestrator and all children honor it for the whole wave.
