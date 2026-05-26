---
applyTo: "**"
---

## Architecture Layering

- Flag any controller that imports directly from an adapter (e.g. `drizzle.ts`, `database.adapter.ts`) — controllers must delegate to services only.
- Flag any service that imports another service — use events, queues, or shared lib for cross-service orchestration.
- Flag any agent file that imports from the database schema or adapters — agents must remain pure and receive dependencies via constructor injection.
- Flag any `@indexnetwork/protocol` package code that imports from the app layer (`backend/src/`) — the protocol package must be fully self-contained.

## TypeScript

- Flag any use of `any` type — use `unknown` and narrow, or a concrete type.
- Flag agent input/output types not validated with Zod schemas.
- Flag manual type definitions where Drizzle inference (`$inferSelect`, `$inferInsert`) would suffice.
- Flag imports from `lib/schema` — always import from `src/schemas/database.schema.ts`.

## Database & Migrations

- Flag any migration file that does not follow the naming pattern `{NNNN}_{action}_{target}[_{detail}].sql` (e.g. `0001_add_chat_session_share_token.sql`).
- Flag hard deletes (`DELETE FROM` or Drizzle `.delete()`) in service code where soft deletes (`deletedAt`) should be used instead.
- Flag schema changes in `database.schema.ts` that lack a corresponding new migration file.

## Version Bumping

- Flag changes to `packages/cli/` or `packages/protocol/` that lack a version bump in their respective `package.json`.

## Review Completion

Always post a review comment, even when no issues are found. If everything looks good, say "LGTM" with a brief note on what was checked. This prevents the PR from being stuck in an "awaiting review" state.

## Commit & PR Conventions

- Flag PR descriptions that do not include the changelog sections: New Features, Bug Fixes, Refactors, Documentation, Tests.
- Note if any commit message does not follow Conventional Commits: `<type>[scope]: <description>` where type is one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`.
