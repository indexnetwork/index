# Role profiles (path-triggered, not personas)

Do **not** create separate persistent frontend/backend/protocol personas. A role is
selected per child task by the paths it will change, and the role-specific checklist
below is injected into that child's handoff. The same child keeps its role for its
whole session (including fix rounds); a new task with different paths gets a new role
selection.

## Selecting a role

1. List the paths the task will touch.
2. If all paths fall under one trigger, that role is primary.
3. Mixed-path tasks use **one primary role** (the riskiest/most architectural area)
   and explicitly attach the secondary roles' checklists to the same handoff.
4. Split into multiple children only when ownership is genuinely independent
   (disjoint files, separable verification, no shared migration/lockfile). Otherwise
   one child with attached checklists beats two writers racing one checkout.

## protocol-specialist

Trigger: `packages/protocol/**` (and protocol-adjacent evals/skills under it).

Highest architectural scrutiny. Checklist for the handoff:

- Protocol layer stays fully self-contained — zero imports from the app; adapters
  arrive via constructor injection through interfaces.
- Graph/interface/schema/prompt purity: agents keep pure (no direct DB access), Zod
  schemas for all agent I/O, `createModel()` from `model.config.ts`.
- Privacy and provenance: no user-data leaks across scopes, no fabricated
  attendance/membership inference in prompts, provenance metadata preserved.
- Prompt-injection awareness for any text that crosses trust boundaries.
- `@indexnetwork/protocol` package semver: bump `packages/protocol/package.json` per
  SemVer when the package is touched; flag breaking changes explicitly.
- Run the relevant `packages/protocol` eval harness or focused tests as verification.

## api-backend

Trigger: `services/api/**`.

- Strict layering: controllers → services → adapters; controllers never import
  adapters, services never import other services (use events, queues, shared lib).
- Queues/events: BullMQ dedup/JobId semantics, retry/backoff, event emission after
  DB transactions.
- DB safety: migrations renamed + `_journal.json` tag updated, locking/idempotency on
  write paths, soft deletes over hard deletes.
- Tests: guarded, isolated, targeted files only (`bun test path/to/test.ts`); clean up
  in `afterAll`; mock externals.
- Consult the layer template files before adding controller/service/queue code.
- API surface changes mean API semver and `docs/specs/` updates.

## web-frontend

Trigger: `apps/web/**`.

- React 19 state/hydration correctness; no server-only assumptions in client bundles.
- Auth expiry and session handling on every new fetch path.
- Lazy routes stay lazy; question/chat surfaces (`InjectedQuestions`, SSE) keep their
  conversation-scoping invariants.
- Accessibility on new interactive elements.
- Verification: focused tests plus `bun run build` (catches route/type regressions).
- Web package semver when the package is versioned.

## release-review

Trigger: release prep, rebase/conflict resolution, cross-package compatibility,
deploy verification. This role does **no source implementation** unless a fix handoff
is explicitly issued.

- Rebase/conflict review: every conflict resolution re-verified against intent.
- Root `bun.lock` freshness (`--frozen-lockfile` parity with prod builds) and Drizzle
  migration safety (destructive migrations need the operational backfill verified).
- Cross-package compatibility: protocol/cli version bumps coherent with consumers.
- GitHub checks green; Railway terminal/deployment verification per `finish-pr` and
  `verify-production-release`.

## Attaching secondary checklists

When attaching, copy only the checklist bullets of the secondary role into the
handoff under an "Also applies:" heading, and state which role is primary and why.
The primary role owns architectural judgment calls.
