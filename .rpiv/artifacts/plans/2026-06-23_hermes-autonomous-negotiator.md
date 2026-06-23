# Plan: Hermes Autonomous Negotiator

## Status
ready

## Git Context
- Branch: `feat/hermes-autonomous-negotiator`
- Worktree: `.worktrees/feat-hermes-autonomous-negotiator`
- Base: `dev` at `0fddd3a917`

## Summary
Add enough native Hermes plugin surface for two separate modes:

1. **Interactive Index orchestrator** — user messages about Index/signals/intents/opportunities nudge Hermes to load the namespaced plugin skill `index-network:index-orchestrator` and use the existing `index_read_intents` tool.
2. **Autonomous Hermes negotiator** — Hermes can act as the user's personal Index negotiator by polling the existing personal-agent HTTP endpoints and responding to claimed negotiation turns through native Hermes tools.

The negotiator should use the backend personal-agent polling contract, not generic human-review MCP negotiation tooling. Polling is what updates `agents.last_seen_at`; the Index dispatcher uses that heartbeat to decide whether to park turns for a personal agent or fall back to the system negotiator.

## Decisions

- **Use HTTP personal-agent endpoints for autonomous negotiation.** Evidence: `services/api/src/controllers/agent.controller.ts` exposes `GET /api/agents/me`, `POST /api/agents/:id/negotiations/pickup`, and `POST /api/agents/:id/negotiations/:negotiationId/respond`. `negotiation-polling.service.ts` implements claim/respond semantics and heartbeat side effects.
- **Keep MCP for `index_read_intents` only for now.** The current plugin already wraps MCP `read_intents`; negotiation replacement needs backend polling behavior, not just read/review tools.
- **Add a `pre_llm_call` hook for orchestrator discovery.** Hermes docs say plugin skills are not listed in `skills_list`; a hook can inject ephemeral context instructing the model to load `skill_view("index-network:index-orchestrator")`.
- **Use explicit native tool names prefixed with `index_`.** Avoid collisions with MCP/built-in tools and match existing `index_read_intents`.
- **Document simple cron first.** A Hermes cron/gateway job every minute is the first operational way to keep the agent fresh. A lower-cost script-only/poller optimization can come later.

## Scope

### In
- Hermes plugin hook for interactive Index/orchestrator prompts.
- Native Hermes tools:
  - `index_agent_me`
  - `index_pickup_negotiation`
  - `index_respond_negotiation`
- HTTP helpers for Index API requests with `INDEX_API_KEY`.
- Negotiator skill rewrite for autonomous scheduled execution.
- README/plugin manifest/test updates.
- Regenerated generated Hermes `SKILL.md` outputs.
- Version bump for `packages/hermes-plugin`.

### Out
- Backend API changes.
- New database schema or migrations.
- Full UI/dashboard tab.
- Efficient daemon/poller that bypasses the LLM when no work exists; document as future optimization.
- New Claude plugin behavior.

## Phase 1 — HTTP helper foundation and agent identity tool

### Changes
- In `packages/hermes-plugin/tools.py`:
  - Add `_DEFAULT_INDEX_API_URL = "https://protocol.index.network/api"`.
  - Add `_api_url()` reading `INDEX_API_URL`.
  - Add shared `_api_request(method, path, body=None)` using `urllib.request` with `x-api-key` and existing `x-index-surface` / optional Telegram header behavior.
  - Normalize non-2xx HTTP errors into JSON error payloads.
  - Handle 204 responses as `{ success: true, pending: false }` for pickup-like calls.
  - Add `index_agent_me(args, **kwargs)` that calls `GET /agents/me` with no required args.
- In `packages/hermes-plugin/schemas.py`, add `INDEX_AGENT_ME` with empty parameters.
- In `packages/hermes-plugin/__init__.py`, register `index_agent_me` after `index_read_intents`.
- In `packages/hermes-plugin/plugin.yaml`, add `index_agent_me` to `provides_tools`.

### Success Criteria
- `packages/hermes-plugin/tests/smoke.py` asserts `index_agent_me` is registered and maps to `GET /api/agents/me`.
- Missing `INDEX_API_KEY` returns a JSON error, not an exception.
- Existing `index_read_intents` behavior is unchanged.

## Phase 2 — Negotiation pickup/respond tools

### Changes
- Add schemas:
  - `INDEX_PICKUP_NEGOTIATION`
    - optional `agentId`; if absent, handler resolves via `/agents/me`.
  - `INDEX_RESPOND_NEGOTIATION`
    - required `negotiationId`
    - `action`: `propose | accept | reject | counter | question`
    - optional `message`
    - required `reasoning`
    - required `suggestedRoles.ownUser`, `suggestedRoles.otherUser`: `agent | patient | peer`
    - optional `agentId`; if absent, handler resolves via `/agents/me`.
- Add handlers:
  - `index_pickup_negotiation(args, **kwargs)`:
    - validate args object
    - resolve agent ID
    - call `POST /agents/:agentId/negotiations/pickup`
    - convert 204 to `{ success: true, pending: false }`
    - convert 200 payload to `{ success: true, pending: true, ...payload }`
  - `index_respond_negotiation(args, **kwargs)`:
    - validate IDs/action/roles
    - require non-empty `message` for `counter` and `question`
    - call `POST /agents/:agentId/negotiations/:negotiationId/respond`
    - send backend body shape: `{ action, message, assessment: { reasoning, suggestedRoles } }`
- Register both tools and add them to `plugin.yaml`.

### Success Criteria
- Smoke tests cover:
  - pickup 204 empty result
  - pickup 200 pending result
  - respond request body shape
  - missing `negotiationId`
  - invalid `action`
  - missing `message` for `counter` / `question`
- No backend code is modified.

## Phase 3 — Orchestrator skill trigger hook and optional slash command

### Changes
- In `packages/hermes-plugin/__init__.py`:
  - Add `_index_context_hint(...)` hook for `pre_llm_call`.
  - Trigger only on user messages containing clear Index-related terms: `index network`, `index.network`, `signal`, `signals`, `intent`, `intents`, `opportunity`, `opportunities`, `discovery`, `discover`.
  - Return a concise context hint telling Hermes to load `skill_view("index-network:index-orchestrator")` when the user is asking about Index signals/intents/opportunities.
  - Register with `ctx.register_hook("pre_llm_call", _index_context_hint)`.
  - Optionally register `/index` via `ctx.register_command` returning the same instruction for explicit use.
- Keep hook defensive: accept `**kwargs`, tolerate missing/empty `user_message`, never throw.

### Success Criteria
- Smoke fake context captures `register_hook("pre_llm_call", ...)`.
- Hook returns context for Index-related prompt and `None` for unrelated prompt.
- If slash command is added, smoke fake context captures it.

## Phase 4 — Rewrite generated Hermes negotiator skill

### Changes
- Edit `packages/protocol/skills/hermes-plugin/index-negotiator.template.md`, not generated output.
- Reframe the skill as autonomous personal-agent negotiation:
  - On scheduled/autonomous run:
    1. call `index_pickup_negotiation()`
    2. if `pending` is false, respond exactly `[SILENT]`
    3. inspect `context`, `opportunity`, `turn.history`, `counterpartyAction`, `deadline`
    4. decide one action
    5. call `index_respond_negotiation(...)`
    6. report only what was submitted/confirmed
  - In human interactive mode, allow explaining what it would do, but do not require user confirmation for scheduled autonomous runs.
  - Prefer cautious counters/questions when context is insufficient; do not fabricate facts.
- Optionally update orchestrator template to mention native negotiation availability only if relevant.
- Run `bun run build:skills` from worktree root.

### Success Criteria
- Generated `packages/hermes-plugin/skills/index-negotiator/SKILL.md` reflects the rewritten template.
- `bun test scripts/tests/build-skills.spec.ts` passes.
- Generated skills are not hand-edited.

## Phase 5 — Docs, version, and verification

### Changes
- Update `packages/hermes-plugin/README.md`:
  - Tool list includes identity/pickup/respond.
  - Env vars include `INDEX_API_URL`.
  - Add autonomous negotiator setup with Hermes cron/gateway requirements.
  - Explain that plugin skills are namespaced and the orchestrator hook nudges loading.
- Update `packages/hermes-plugin/package.json` and `plugin.yaml` version together.
  - Suggested next patch/minor: `0.3.0` because this adds new public native tools.
- Update any guidance/docs that list Hermes plugin capabilities if necessary.

### Verification
Run from worktree root:

```bash
bun run build:skills
bun test scripts/tests/build-skills.spec.ts
cd packages/hermes-plugin && bun run test
git diff --check
```

### Success Criteria
- All verification commands pass.
- `plugin.yaml` `provides_tools` matches registered native tool names.
- Smoke test covers the new hook/tools enough to protect contract regressions.
