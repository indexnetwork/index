-- IND-410: agent_type gains 'external'.
-- NOTE: `ALTER TYPE ... ADD VALUE` is deliberately NOT used here. drizzle-kit
-- applies all pending migrations of a run inside a single transaction, and
-- Postgres forbids using a value added by ADD VALUE before that transaction
-- commits (55P04: unsafe use of new value "external") — which breaks 0089's
-- backfill in the same deploy. Recreating the type sidesteps this: values of a
-- freshly CREATED type are usable immediately within the same transaction.
ALTER TABLE "agents" ALTER COLUMN "type" DROP DEFAULT;--> statement-breakpoint
CREATE TYPE "public"."agent_type_v2" AS ENUM('personal', 'external', 'system');--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "type" SET DATA TYPE "public"."agent_type_v2" USING ("type"::text::"public"."agent_type_v2");--> statement-breakpoint
DROP TYPE "public"."agent_type";--> statement-breakpoint
ALTER TYPE "public"."agent_type_v2" RENAME TO "agent_type";
