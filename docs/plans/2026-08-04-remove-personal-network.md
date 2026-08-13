# Remove Personal Network Feature — Implementation Plan

> **For agentic workers:** Execute task-by-task using the repo worktree skills
> (`.agents/skills/create-worktree`, `.agents/skills/run-worktree-session`).
> Follow the targeted-validation policy in
> `docs/guides/development-reference.md` and report exact evidence in each PR.

**Goal:** Fully remove the personal-network concept — the auto-created
per-user "My Network", the contacts feature built on it, and introducer
discovery — from protocol, API, database schema, and all frontends.

**Scope decision (confirmed by owner):** Full removal everywhere. No feature
flag, no re-homing of contacts. `CONTACTS_ENABLED` is already `false` by
default.

## What exists today

- Every user gets a personal network via `ensurePersonalNetwork` in
  `services/api/src/adapters/database.shared.ts`, triggered by Better Auth
  user/session hooks in `services/api/src/lib/betterauth/betterauth.ts` and
  lazily from invites/contact writes.
- DB: `networks.is_personal` column, `personal_networks` table, contact rows
  in `network_members` (permission `contact`), ghost users (`users.is_ghost`)
  created by contact import.
- Consumers: contacts modules (`packages/protocol/src/contacts`,
  `packages/protocol/src/contact`, `ContactService`), introducer discovery
  (`packages/protocol/src/opportunity/application/opportunity.introducer.ts`
  + maintenance graph), chat scope policy (`tool.scope.ts`: scoped chats
  allow "focused + personal"), intent assignment
  (`services/api/src/queues/intent.queue.ts`), signal intake
  (`getNonPersonalNetworkIds`), and UI surfaces (web `/mynetwork`, networks
  list, chat scope dropdown; CLI; MCP `read_networks`; mac app).

## Implementation order

### Task 1 — Protocol package (`packages/protocol`)

- [ ] Delete contacts modules (`src/contacts/`, `src/contact/`,
      `src/capabilities/contacts.tools.port.ts`), contact tool registrations
      in `mcp.server.ts`, tool registry aliases, and contact references in
      chat prompt modules/personas.
- [ ] Delete introducer discovery (`opportunity.introducer.ts`) and its
      wiring in `src/maintenance/maintenance.graph.ts`.
- [ ] Simplify scope policy: `deriveAllowedNetworkIds` in `tool.scope.ts`
      and `network-assignment.policy.ts` drop the "plus personal" branch;
      remove `isPersonal` from `network.graph.ts`, `network.tools.ts`,
      `utility.tools.ts`, `database.interface.ts`, and prompts
      (`chat.prompt.ts`, `signal.prompt.ts`, `onboarding.prompt.ts`,
      `reporter.prompt.ts`).
- [ ] Update affected architecture specs and the protocol-atlas export metadata
      if the root export sources change.

### Task 2 — API service (`services/api`)

- [ ] Remove `ensurePersonalNetwork` (database.shared.ts, auth.adapter.ts,
      betterauth hooks, network-invitation.service.ts) and
      `assertNotPersonalNetwork` guards in `network.service.ts` /
      `network.controller.ts`.
- [ ] Delete `ContactService`, `contact.database.adapter.ts`,
      `lib/contacts-feature.ts`, and the `CONTACTS_ENABLED` flag
      (startup.env.ts, .env.example, .env.development, Railway dev vars per
      `.agents/skills/manage-feature-flags`).
- [ ] Strip personal/contact logic from `chat.database.adapter.ts` (largest
      single file, ~60 references), `integration.service.ts` (omitted
      `networkId` no longer defaults to personal — make it an error),
      `intent.queue.ts`, `signal-intake.service.ts`
      (`getNonPersonalNetworkIds` becomes plain network list), and the
      smaller adapters (uptake-question, frame-drift, questioner,
      conversation, user delete path).
- [ ] Delete CLI script `backfill-personal-index-prompts.ts`; update
      `seed-experiment-network.ts` and `db-flush.ts`.
- [ ] Delete/update tests (`personal-network.adapter.spec.ts`, contact
      service specs, and the many specs asserting personal-network behavior).

### Task 3 — Frontends

- [ ] Web: delete `/mynetwork` page and route; remove `isPersonal` handling
      from networks list page, `ChatContent` scope dropdown ("My Network"
      entry), `NetworksPanel`, `SettingsTab`, `AccessTab`, `IntegrationsTab`,
      `FastSignalIntake`, `ClientWrapper`, and services (`networks.ts`,
      `v2/networks.service.ts`, `users.ts`).
- [ ] CLI (`packages/cli`): remove the `!isPersonal` filter and related test
      expectations in `network.command.ts`.
- [ ] Mac app: drop `isPersonal` mapping in
      `apps/mac/IndexApp/src/index-amiga/api.jsx`.

### Task 4 — Docs

- [ ] Light pass over `docs/guides/development-reference.md`,
      `docs/domain/*` (networks, opportunities, agents,
      identity-and-context), `docs/specs/api-reference.md`, and README to
      remove personal-network/contacts sections.

### Task 5 — PR 1: code removal (ship-dark)

- [ ] Open PR 1 with Tasks 1–4: schema columns remain but are unused;
      personal-network creation stops. Verification per targeted-validation
      policy: affected package tests, typecheck, builds, protocol
      static-inventory check.

### Task 6 — PR 2: data cleanup + destructive migration (only after PR 1 is deployed and verified)

- [ ] Prod data cleanup before the drop (per
      `.agents/skills/backfill-production-data` and
      `.agents/skills/verify-production-release`: control-group validation,
      dev-branch dry run, Neon backup branch, transaction, exact counts):
  - Delete `network_members` rows for personal networks (including
    `contact` rows) and the personal `networks` rows.
  - Delete ghost users (`is_ghost = true`) that exist only as imported
    contacts.
  - Intents/signals assigned only to a personal network become
    network-unassigned but stay owned by the user — verify counts and pause
    for owner confirmation if the number is large (prior art:
    `.rpiv/artifacts/designs/intent-network-orphaning-fix.md`).
- [ ] Drizzle migration: drop `personal_networks` table and
      `networks.is_personal`; schema cleanup in
      `services/api/src/schemas/database.schema.ts`.
- [ ] Open PR 2, merged only after cleanup counts are verified.

## Open risk

Intents whose only network assignment is their owner's personal network will
lose that assignment. Check counts on the Neon dev branch first and pause if
the number is large.
