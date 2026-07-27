# Model routing (launch-time, role × harness, no GPT-5.5)

Models are chosen **at child launch time** and never switched mid-implementation.
A child that needs a stronger model is stopped and relaunched with a fresh handoff,
not hot-swapped. The harness (pi, codex, or kimi) is chosen first — recommended by
`main` for the root at wave kickoff, and per child by the root — and determines
which model column applies. Launch lines and focus safety live in
`harness-matrix.md`; all launches go through the exact, non-focusing pane ID, and
`herdr agent start` is not the normal launch path.

Before **every** codex child launch, the root re-reads the visible agent status
quota state and routes by the table and quota bands below. Routing is deterministic
skill logic based on that visible footer; do not parse quota UI with a brittle
extension. A preset/model-routing extension is a later option only if a stable quota
API becomes available.

**GPT-5.5 is banned** on every harness. On codex use the GPT-5.6 Sol/Terra/Luna
variants; on pi, the OpenAI 5.6 variants are not exposed, so pi routes to the Claude
column instead.

## Coordination safety

Model routing does not change coordination. Main, roots, and children all use
fire-and-return prompts without `--wait`; every child receives a parent pane ID and
sends that parent one terminal-state result prompt before stopping. Do not poll, sleep,
create watchers, or infer success from `idle`/`done`. Preserve workspace `index` focus
for every launch and check.

## Role × harness routing

Pick the harness first, then read that harness's column for the role. Codex remains
OpenAI-first; pi's working set is Claude (via API keys); kimi runs the K3 aliases.

| Role | codex | pi | kimi |
|---|---|---|---|
| Root (`root`) | `gpt-5.6-terra:high` (esc. `gpt-5.6-sol:high`) | `anthropic/claude-opus-4-8:high` | `kimi-code/k3` |
| Protocol specialist / privacy-critical | `gpt-5.6-sol:high` | `anthropic/claude-opus-4-8:high` | `kimi-code/k3` (avoid for protocol unless user-chosen) |
| API backend implementation (normal) | `gpt-5.6-terra:high` | `anthropic/claude-sonnet-4-6:high` | `kimi-code/k3` |
| Web implementation (normal) | `gpt-5.6-terra:high` (`:medium` tightly scoped) | `anthropic/claude-sonnet-4-6:medium–high` | `kimi-code/k3` |
| Mechanical UI / tests / docs / recon | `gpt-5.6-luna:medium–high` | `anthropic/claude-haiku-4-5:medium` | `kimi-code/kimi-for-coding-highspeed` |
| Release / review / rebase / integration verification | `gpt-5.6-terra:high` (esc. `gpt-5.6-sol:high`) | `anthropic/claude-opus-4-8:high` | `kimi-code/k3` |

Escalation within a harness: codex Terra → Sol for cross-cutting, concurrency, or
rebase risk; pi Sonnet → Opus for the same; kimi has no stronger tier — escalate by
relaunching the child on codex or pi. On codex, Sol is an escalation model rather
than the normal default (except the protocol/privacy-critical primary route), and
Luna is only for low-risk mechanical work — never protocol, auth, or data-mutation
code; the same low-risk-only rule applies to pi Haiku and kimi highspeed.

`anthropic/claude-fable-5` (on pi) is reserve/emergency capacity, not a normal
routing row. On codex, Claude models are quota-aware alternative capacity only when
Claude global headroom is healthy.

## Quota bands (footer-bearing harnesses — codex)

Quota bands apply to harnesses that show a visible quota footer (codex today). Pi
and kimi run on API-key/subscription billing with no footer: bands are N/A there —
instead, on provider 429s or repeated capacity errors, downgrade deterministically
within the harness column (Opus → Sonnet → Haiku on pi) or relaunch on another
harness, and report the downgrade to `main`.

Measure the bands as the **consumed percentage shown in the visible agent status UI**:

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

A user harness or model override always wins — record it in the wave handoff and the
checkpoint journal so the root and all children honor it for the whole wave.
