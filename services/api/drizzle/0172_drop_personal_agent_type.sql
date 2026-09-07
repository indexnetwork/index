-- `agents.type = 'personal'` was the auto-provisioned `{First}'s Negotiator`
-- row, created on every sign-in for the in-process negotiation loop. That loop
-- is gone: the rows carry no API key or transport, are hidden from `GET /agents`,
-- and nothing reads them. The user-facing "personal agents" are `external`.
--
-- Postgres cannot remove an enum value in place, so `agent_type` is recreated.
-- `agents_type_idx` is untyped and survives; the partial indexes that name a
-- type in their predicate are dropped and rebuilt around the swap.

DELETE FROM "agents" WHERE "type" = 'personal';
--> statement-breakpoint
DROP INDEX IF EXISTS "uniq_agents_personal_per_owner";
--> statement-breakpoint
DROP INDEX IF EXISTS "uniq_agents_hermes_installation";
--> statement-breakpoint
DROP INDEX IF EXISTS "uniq_agents_selected_negotiation_executor";
--> statement-breakpoint
ALTER TYPE "agent_type" RENAME TO "agent_type_old";
--> statement-breakpoint
CREATE TYPE "agent_type" AS ENUM('external', 'system');
--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "type" TYPE "agent_type" USING "type"::text::"agent_type";
--> statement-breakpoint
DROP TYPE "agent_type_old";
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_agents_hermes_installation" ON "agents" ("owner_id", "runtime_kind", "installation_id")
  WHERE "type" = 'external' AND "runtime_kind" = 'hermes' AND "installation_id" IS NOT NULL AND "deleted_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_agents_selected_negotiation_executor" ON "agents" ("owner_id")
  WHERE "type" = 'external' AND "handle_negotiations" = true AND "deleted_at" IS NULL;
