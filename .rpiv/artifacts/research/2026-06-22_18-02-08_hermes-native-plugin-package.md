---
date: 2026-06-22T18:02:08+0300
author: Yanek Yuk
commit: 2f13f40814
branch: dev
repository: index
topic: "Hermes-native plugin package conventions for a new hermes-plugin package"
tags: [research, codebase, hermes, agentvillage, plugins]
status: ready
last_updated: 2026-06-22T18:02:08+0300
last_updated_by: Yanek Yuk
---

# Research: Hermes-native plugin package conventions

## Research Question
How do Hermes plugins look and act in this repository/ecosystem, and what conventions should shape a new Hermes-native package named `hermes-plugin`?

## Summary
Hermes does not currently use a plugin manifest in this codebase. The Hermes-native pattern is an installable package with a Bun `bin` that copies skill directories into `$HERMES_HOME/skills`, writes or mutates `$HERMES_HOME/config.yaml`, persists secrets in `$HERMES_HOME/.env`, and reconciles any Hermes cron runtime state. Claude, Codex, and OpenClaw plugin descriptors are useful comparison points, but for `hermes-plugin` the primary implementation model should be AgentVillage's installer/runtime path, not static manifest metadata.

Key implication: a Hermes-compatible package is stateful. Checked-in `SKILL.md` and prompt files are only source material; installer code must materialize them into Hermes home, MCP config, env files, and cron jobs.

## Detailed Findings

### Hermes package shape is installer-first, not manifest-first
- AgentVillage exposes a package-level executable: `packages/edge-city/agentvillage/package.json:7-13` maps the `agentvillage` bin to `./install/install.ts` and publishes installer files, workspace markdown, and `skills/`.
- The installer entry point is `main()` in `packages/edge-city/agentvillage/install/install.ts:185-220`; it performs Hermes availability checks, copies workspace/skills, mutates config, installs Index/EdgeOS/Geo wiring, and optionally restarts the gateway.
- Hermes paths are centralized in `packages/edge-city/agentvillage/install/paths.ts:5-24`: `HERMES_HOME` defaults to `~/.hermes`, `targetWorkspace()` is the Hermes home itself, `skillsDir()` is `$HERMES_HOME/skills`, and `EDGE_SKILL_NAMES` is the explicit skill-copy allowlist.
- The skills README describes Hermes as “skills only” at `packages/edge-city/agentvillage/skills/README.md:69-109`: install skills, write `.env`, merge MCP YAML into `config.yaml`, or run the full installer. It explicitly says installation is flat under `~/.hermes/`, not under a plugin subfolder.

### Existing plugin manifests are host adapters around skills
- AgentVillage Claude plugin metadata lives at `packages/edge-city/agentvillage/skills/.claude-plugin/plugin.json:2-44`; it includes `name`, `skills`, `userConfig`, a `SessionStart` hook, and `mcpServers.index` with `${user_config.indexApiKey}`.
- AgentVillage OpenClaw metadata at `packages/edge-city/agentvillage/skills/openclaw.plugin.json:2-6` is minimal: `id`, `name`, `description`, `version`, and `skills`.
- The standalone Index Claude plugin at `packages/claude-plugin/.claude-plugin/plugin.json:2-19` focuses on `userConfig.apiKey` and `mcpServers.index-network`; its Codex descriptor at `packages/claude-plugin/.codex-plugin/plugin.json:13-14` points to `./skills/` and `./mcp.json`.
- These descriptors demonstrate cross-host packaging conventions, but they are not Hermes-native. For Hermes, equivalent concerns move into install docs, installer code, `.env`, and `config.yaml`.

### Hermes config and env responsibilities are split
- `packages/edge-city/agentvillage/install/config.ts:9-16` reads/writes `$HERMES_HOME/config.yaml`; `setTerminalCwd()` at `config.ts:25-35` sets `terminal.cwd` to `$HERMES_HOME` so Hermes loads flat workspace files like `AGENTS.md`.
- `capModelMaxTokens()` at `packages/edge-city/agentvillage/install/config.ts:64-85` normalizes and caps model token settings, while `configureStt()` at `config.ts:48-60` enables STT provider configuration.
- Secrets go to `$HERMES_HOME/.env`: `packages/edge-city/agentvillage/install/env.ts:7-13` upserts env vars, `packages/edge-city/agentvillage/install/install_edgeos.ts:13-24` persists EdgeOS credentials, and `packages/edge-city/agentvillage/install/install_index.ts:435-449` persists Index credentials and writes MCP config.
- Claude handles comparable secret projection via plugin config and hooks: `packages/edge-city/agentvillage/skills/.claude-plugin/plugin.json:30-36` declares a `SessionStart` hook, and `packages/edge-city/agentvillage/skills/hooks/export-edgeos-env.sh:2-8` writes configured EdgeOS secrets into Claude's session env file.

### Index MCP wiring is literal YAML in Hermes
- `buildIndexMcpHeaders()` at `packages/edge-city/agentvillage/install/install_index.ts:80-87` always writes `x-api-key` and `x-index-surface: telegram`, and conditionally writes normalized `x-index-telegram-username`.
- `writeMcpServerEntry()` at `packages/edge-city/agentvillage/install/install_index.ts:90-103` writes the Hermes YAML path `mcp_servers.index` in `$HERMES_HOME/config.yaml`, preserving other MCP servers.
- `installIndex()` at `packages/edge-city/agentvillage/install/install_index.ts:435-449` reads API key/Telegram handle from flags/env/persisted `.env`, persists them, writes MCP config, and reconciles cron jobs unless skipped.
- Control-plane hosted tenants also generate `mcp_servers.index` at `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:223-270`; `/provision` writes that YAML directly at `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:232-284`.

### Background prompts are durable Hermes cron state
- `DIGEST_CRON_SPECS` at `packages/edge-city/agentvillage/install/install_index.ts:200-243` defines owned background jobs, their schedules, prompt files, delivery mode, and override vars.
- `cronCreateArgs()` at `packages/edge-city/agentvillage/install/install_index.ts:274-278` creates Hermes cron jobs with prompt bodies and optional `--deliver telegram`; `cronEditArgs()` at `install_index.ts:282-288` updates schedule and/or prompt.
- `reconcileDigestCronJobs()` at `packages/edge-city/agentvillage/install/install_index.ts:340-429` removes retired jobs, reads current prompt files from installed skills, preserves tenant-custom schedules where appropriate, and updates stale prompt bodies.
- The README caveat at `packages/edge-city/agentvillage/README.md:348` is load-bearing: Hermes stores copies of cron prompts, so changing a prompt file requires rerunning the installer/reconciler.
- There is a doc/code drift to fix eventually: `packages/edge-city/agentvillage/README.md:219` describes three cron jobs, while code currently defines five at `install_index.ts:200-243`.

### Hosted Hermes lifecycle depends on rerunning the installer
- Sidecar Hermes commands run with tenant-local `HOME` and `HERMES_HOME`: `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:93-99`.
- Provisioning writes `.env`, optional `USER.md`, generated `config.yaml`, and `.provisioned` under `/opt/data`: `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:232-302`.
- Hosted defaults are generated in `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:68-99`, including `HERMES_HOME: /opt/data` and a provision body carrying secrets/config.
- `/update` fetches the configured ref, resets the tenant repo, runs `bun install`, and reruns `bun install/install.ts --index-api-key <key> --no-restart`: `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:417-457`.
- That update path is what propagates changed skills/prompts/config logic into existing hosted tenants; without it, stored Hermes runtime state remains stale.

### Skill behavior conventions separate prose from deterministic scripts
- Host-specific silence is defined centrally at `packages/edge-city/agentvillage/skills/README.md:16-26`: Hermes uses `[SILENT]`, OpenClaw uses `NO_REPLY`, and shared skill prose should say “reply silently” rather than hardcoding every host's marker.
- The Index skill repeats this host contract at `packages/edge-city/agentvillage/skills/index-network/SKILL.md:24-26`.
- Judgment-heavy behavior belongs in skill prose, such as memory graph diffing in `packages/edge-city/agentvillage/skills/edge-esmeralda/prompts/memory-signals.md:11-27`.
- Deterministic side effects belong in scripts. The daily brief send prompt delegates to `send-daily-brief.ts` and forbids MCP calls in the model pass at `packages/edge-city/agentvillage/skills/edge-esmeralda/prompts/send.md:9-36`; the script handles state, Kanban, delivery confirmation, and sanitization at `packages/edge-city/agentvillage/skills/index-network/scripts/send-daily-brief.ts:201-308`.

## Code References
- `packages/edge-city/agentvillage/package.json:7-13` — AgentVillage package bin/files convention for an installer-backed Hermes package.
- `packages/edge-city/agentvillage/install/install.ts:185-220` — top-level installer orchestration.
- `packages/edge-city/agentvillage/install/paths.ts:5-24` — `$HERMES_HOME`, flat workspace, skills dir, and copied skill allowlist.
- `packages/edge-city/agentvillage/install/config.ts:25-85` — Hermes config mutations for terminal cwd, STT, and model token cap.
- `packages/edge-city/agentvillage/install/env.ts:7-13` — `$HERMES_HOME/.env` upsert helper.
- `packages/edge-city/agentvillage/install/install_index.ts:80-103` — Index MCP header builder and Hermes YAML writer.
- `packages/edge-city/agentvillage/install/install_index.ts:200-243` — Edge-owned Hermes cron spec table.
- `packages/edge-city/agentvillage/install/install_index.ts:340-429` — cron reconciliation against stored Hermes runtime state.
- `packages/edge-city/agentvillage/skills/README.md:69-109` — Hermes “skills only” install instructions and flat layout note.
- `packages/edge-city/agentvillage/skills/.claude-plugin/plugin.json:2-44` — richer Claude plugin manifest with skills, user config, hook, and MCP.
- `packages/edge-city/agentvillage/skills/openclaw.plugin.json:2-6` — minimal OpenClaw plugin descriptor.
- `packages/claude-plugin/.claude-plugin/plugin.json:2-19` — minimal Index Claude plugin descriptor.
- `packages/claude-plugin/.codex-plugin/plugin.json:13-14` — Codex descriptor points to skills and MCP JSON files.
- `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:232-302` — hosted tenant provisioning writes config/secrets and launches boot script.
- `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:417-457` — hosted tenant update reruns installer against existing tenant state.

## Integration Points

### Inbound References
- `packages/edge-city/agentvillage/package.json:7-13` — npm/Bun package entry exposes installer command and publishes runtime content.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1197-1211` — control plane updates live tenants by calling sidecar `/update`.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1834-1854` — control plane provisions tenant sidecars with generated config and secrets.
- `packages/edge-city/agentvillage/skills/README.md:99-109` — manual/operator path invokes the full installer for Hermes.

### Outbound Dependencies
- `packages/edge-city/agentvillage/install/install.ts:34-36` — installer composes Index, EdgeOS, and Geo sub-installers.
- `packages/edge-city/agentvillage/install/install_index.ts:344-348` — cron reconciliation depends on the Hermes CLI being available unless container mode skips restart checks.
- `packages/edge-city/agentvillage/install/install_index.ts:366-370` — Index install initializes Hermes Kanban state before digest jobs.
- `packages/edge-city/agentvillage/skills/index-network/scripts/build-daily-brief-context.ts:857-909` — deterministic script performs direct MCP JSON-RPC delivery confirmation.

### Infrastructure Wiring
- `packages/edge-city/agentvillage/install/config.ts:9-16` — shared YAML read/write path for Hermes runtime config.
- `packages/edge-city/agentvillage/install/install_index.ts:90-103` — writes `mcp_servers.index` into Hermes config.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:223-270` — generates initial hosted tenant config YAML.
- `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:128-143` — removes stale Telegram username header while preserving `x-index-surface`.
- `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:444-457` — carries persisted Telegram handle into installer reruns.

## Architecture Insights
- Hermes-native packaging is a runtime installer pattern: package metadata launches installation; installation mutates a tenant/home directory.
- `$HERMES_HOME` is the unit of installation. Avoid nested plugin directories unless Hermes itself introduces such a loader.
- Skills are portable source content; installer allowlists decide what actually lands in `$HERMES_HOME/skills`.
- Host-specific plugin descriptors should be treated as wrappers/adapters, not the canonical Hermes package model.
- MCP config differs by host: Hermes writes literal YAML and headers; Claude manifests interpolate `userConfig`; Codex references a separate MCP JSON file.
- Cron jobs are durable runtime state and require idempotent reconciliation, including prompt-body refresh and careful preservation of operator schedules/pause state.
- Behavioral prose should remain host-neutral when shared across hosts; deterministic reliability-sensitive effects should move into scripts.

## Precedents & Lessons
4 similar past change families analyzed.

### Precedent: AgentVillage skill manifests for Claude Code, Codex, and OpenClaw
**Commit(s)**: `1ef6d11` — "feat(edgeclaw-skills): add Claude Code plugin manifest" (2026-05-21); `ad6bb60` — "feat(edgeclaw-skills): add OpenClaw plugin manifest" (2026-05-21); `5f7d233` — "feat(edgeclaw-skills): add Codex plugin manifest" (2026-05-21); `d8d354a` — "feat(edgeclaw-skills): add Codex marketplace.json for plugin discovery" (2026-05-22)
**Blast radius**: 6 files across 2 layers
  manifest/ — `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `openclaw.plugin.json`, marketplace metadata
  docs/ — install/discovery README updates

**Follow-up fixes**:
- `8a52f56` — "fix(edgeclaw-skills): add skills field to plugin.json for Claude Code discovery" (2026-05-22) — Claude Code only showed MCP connector without `skills`.
- `935efcb` — "fix: use userConfig instead of configSchema in Claude Code plugin manifests" (2026-05-22) — API keys silently failed to inject into MCP headers.
- `0922171` — "feat(edgeclaw): persist all API keys via userConfig (v1.2.0)" (2026-05-23) — secrets moved to persistent `userConfig`.

**Lessons from docs**:
- No exact `.rpiv/artifacts` docs found for this manifest rollout.

**Takeaway**: Validate each host's manifest semantics separately; Claude Code needs explicit `skills` and persistent `userConfig`.

### Precedent: Standalone Index Claude/Codex plugin package
**Commit(s)**: `34dd4e30ef` — "Add 'packages/claude-plugin/' from commit '8b4a827fdb63ec239e53995f18f347ce857aaf21'" (2026-04-06); `132090648e` — "feat(protocol): add plugin.json template for claude-plugin" (2026-04-14); `37965d072f` — "feat(claude-plugin): add package.json, marketplace.json, and README" (2026-04-14); `631aba964b` — "Add Codex plugin marketplace for index-network" (2026-05-21)
**Blast radius**: 15 files across 4 layers
  package/ — package scaffold, README, package metadata
  manifest/ — Claude/Codex plugin manifests and marketplace metadata
  skills/ — packaged `SKILL.md` files
  registry/ — root marketplace entry

**Follow-up fixes**:
- `afe566906a` — "chore(claude-plugin)!: remove legacy Claude Code plugin" (2026-04-10) — first package shape was removed as legacy.
- `f03fde410e` — "refactor: finish discover_opportunities rename across cli, frontend, plugins, edgeclaw, docs" (2026-05-12) — plugin skills drifted with tool rename.
- `7760a6a53a` — "fix: use userConfig instead of configSchema in Claude Code plugin manifests" (2026-05-22) — auth-injection bug recurred.

**Lessons from docs**:
- No exact `.rpiv/artifacts` docs found for standalone plugin packaging.

**Takeaway**: Static skill packages must track tool-name churn and keep manifest/package/marketplace versions synchronized.

### Precedent: Port installer to Hermes and rebrand to AgentVillage
**Commit(s)**: `f241bd9` — "feat(edgeclaw): add Hermes agent support to BYOA install flow" (2026-05-22); `213e37e` — "Port installer to Hermes; rebrand to AgentVillage" (2026-05-24)
**Blast radius**: 39 files across 5 layers
  package/ — package name, bin, and files changed
  installer/ — Hermes CLI/path/config handling
  manifest/ — Claude/Codex/OpenClaw manifests rebranded
  skills/ — prompts and skill docs updated
  workspace/ — runtime workspace docs reshaped for Hermes

**Follow-up fixes**:
- `33e0088` — "Detect hermes on PATH instead of string-comparing the binary name" (2026-05-29) — Hermes binary resolution was brittle.
- `cc62b62` — "fix(agentvillage): create the digest send cron paused" (2026-05-30) — cron defaults could send prematurely.
- `8d63819` — "Preserve cron schedule/pause and update prompts" (2026-06-06) — updates risked clobbering operator cron state.
- `3896145` — "Fall back to persisted INDEX_API_KEY" (2026-06-06) — install/runtime needed persisted secret fallback.
- `46f0bdb` — "fix(install,digest): identity verification hardening — typed errors, pre-flight, warnings, tests" (2026-06-11) — wrong-key/identity risk required preflight checks.

**Lessons from docs**:
- `.rpiv/artifacts/research/2026-06-11_01-20-31_agentvillage-daily-brief-questions.md` — Hermes cron prompt bodies are stored in cron jobs; prompt changes require per-resident reconciliation.
- `.rpiv/artifacts/plans/2026-06-12_00-07-14_pr-937-brief-questions-remediation.md` — AgentVillage changes live in the Edge-City submodule; commit there, then bump monorepo pointer.

**Takeaway**: Treat Hermes packaging as stateful runtime install work: PATH, cwd, persisted secrets, cron state, and submodule landing are load-bearing.

### Precedent: AgentVillage control-plane sidecar packaging/provisioning
**Commit(s)**: `5b5ebb9` — "Serve bootstrap scripts and sidecar provisioning" (2026-06-02); `693b726` — "feat: report tenant Hermes intent count via MCP read_intents (EDG-53) (#28)" (2026-06-20)
**Blast radius**: 8 files across 4 layers
  container/ — sidecar and boot scripts
  service/ — tenant lifecycle/stat code
  API/ — bootstrap/provisioning routes
  MCP/ — scoped Hermes count client

**Follow-up fixes**:
- `7cde1b4` — "Gate provisioned/gateway on a real tenant secret, not just config.yaml" (2026-06-03) — config-file presence was a false readiness signal.
- `506f050` — "Supervise tenant gateway across restarts; gate pairing on gateway readiness" (2026-06-03) — pairing raced gateway readiness.
- `5177f78` — "fix: reinstall crons during tenant updates" (2026-06-04) — updates dropped cron wiring.
- `ae5b8bc` — "fix: restore tenant file ownership after updates" (2026-06-04) — update path damaged ownership.
- `e45ad98` — "fix(sidecar): read INDEX_API_KEY from .env in /update handler" (2026-06-11) — update handler missed persisted key.
- `688f79c` — "Run gateway as child and add pid liveness check" (2026-06-19) — process liveness needed explicit supervision.

**Lessons from docs**:
- `.rpiv/artifacts/plans/2026-06-19_19-57-03_intent-count-consistency.md` — Hermes control-plane should use scoped MCP and degrade safely on failure.
- `.rpiv/artifacts/validation/2026-06-20_01-02-16_intent-count-consistency.md` — Edge-City submodule delivery is out-of-tree; PRs and pointer bumps are required.

**Takeaway**: Sidecar/package integration must be readiness- and secret-aware; do not assume config files, env vars, or child processes imply a healthy Hermes tenant.

### Composite Lessons
- Use host-native persistent config for secrets; previous env/config-schema approaches caused auth failures.
- Include explicit skill discovery fields for manifest-based hosts, but do not mistake those for Hermes-native packaging.
- Keep package, manifest, marketplace, and skill versions synchronized if cross-host wrappers are later added.
- For Hermes, preserve tenant runtime state: cron schedules, pause state, prompt copies, persisted `.env` values, cwd, PATH, and ownership.
- Hosted Hermes updates must rerun installer/reconciliation logic; copying source files alone is insufficient.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/research/2026-06-11_01-20-31_agentvillage-daily-brief-questions.md` — AgentVillage daily brief and Hermes cron behavior research.
- `.rpiv/artifacts/plans/2026-06-12_00-07-14_pr-937-brief-questions-remediation.md` — Daily brief remediation implementation plan.
- `.rpiv/artifacts/research/2026-06-19_19-16-39_intent-count-consistency.md` — Tenant intent-count consistency research.
- `.rpiv/artifacts/plans/2026-06-19_19-57-03_intent-count-consistency.md` — Intent count consistency implementation plan.
- `.rpiv/artifacts/validation/2026-06-20_01-02-16_intent-count-consistency.md` — Post-implementation validation for intent-count consistency.

## Developer Context
**Q (`packages/edge-city/agentvillage/skills/README.md:69-109`, `packages/claude-plugin/.codex-plugin/plugin.json:13-14`, `packages/edge-city/agentvillage/skills/openclaw.plugin.json:2-6`): Should the new `hermes-plugin` research assume a Hermes-native package only, or a cross-host package?**
A: Hermes-native. Treat `hermes-plugin` as skills + installer/config/env/cron wiring for Hermes first; mention cross-host manifests only as optional wrappers.

**Q: Scan complete — write the Hermes-native research doc, or adjust first?**
A: Write the doc.

## Related Research
- `.rpiv/artifacts/research/2026-06-11_01-20-31_agentvillage-daily-brief-questions.md`
- `.rpiv/artifacts/research/2026-06-19_19-16-39_intent-count-consistency.md`

## Open Questions
- Should `hermes-plugin` live as a new root workspace package under `packages/`, inside the Edge-City AgentVillage submodule, or as a standalone repo mirrored into this monorepo?
- Should `hermes-plugin` include any scheduled prompts/crons, or only interactive skills plus MCP/env wiring?
- Should cross-host Claude/Codex/OpenClaw descriptors be added later as adapters, or explicitly out of scope for the first version?
