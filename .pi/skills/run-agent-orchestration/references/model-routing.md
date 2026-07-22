# Model routing (launch-time, balanced, no GPT-5.5)

Models are chosen **at child launch time** and never switched mid-implementation —
a child that needs a stronger model is stopped and relaunched with a fresh handoff,
not hot-swapped.

Before every launch, read the visible Pi footer quota/headroom and route by the table
below. Routing is deterministic skill logic based on visible footer state; do not
parse quota UI with a brittle extension. (A preset/model-routing extension is a later
option only if a stable quota API becomes available.)

**GPT-5.5 is banned.** Use the GPT-5.6 Sol/Terra/Luna variants instead.

## Launch syntax

Pass the model as an explicit agent argument after `--`:

```bash
herdr agent start NAME --kind pi --pane ID -- --model provider/model:thinking
```

## Default balanced routing

| Agent / role | Model | Fallback |
|---|---|---|
| Root orchestrator | `anthropic/claude-fable-5:high` | `openai-codex/gpt-5.6-terra:high` |
| Protocol specialist / privacy-critical | `anthropic/claude-opus-4-8:high` | `openai-codex/gpt-5.6-sol:high` |
| API backend implementation | `openai-codex/gpt-5.6-terra:high` | escalate to Sol only for cross-cutting, concurrency, or rebase failures |
| Web implementation (normal) | `openai-codex/gpt-5.6-terra:high` | `:medium` allowed for tightly scoped changes; Sol escalation as above |
| Mechanical UI / tests / docs / recon | `openai-codex/gpt-5.6-luna:medium` or `kimi-coding/k3:high` | Kimi preferred for broad reconnaissance/mechanical work when quality risk is low |
| Release / review / rebase | `anthropic/claude-fable-5:high` | Opus for protocol/privacy review; `openai-codex/gpt-5.6-sol:high` as fallback |

Notes:

- **Sol is escalation, not the normal default.** Reach for it only after a
  Terra/Fable attempt demonstrably fails on cross-cutting, concurrency, or rebase
  work, or for protocol/privacy-critical review where the table says so.
- Luna/Kimi tier is for low-risk mechanical work; never for protocol, auth, or
  data-mutation code.

## Provider headroom reserve

Preserve provider headroom: if a provider's visible weekly remaining quota is below
the documented reserve — **recommend 20%** — route ordinary new work to that row's
fallback instead. Exceptions are allowed only for high-risk work (protocol/privacy,
destructive-adjacent operations); when an exception is taken, report it to the user
with the quota reading that justified it.

## Overrides

A user model override always wins — record it in the wave handoff so the root
orchestrator and all children honor it for the whole wave.
