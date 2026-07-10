ALTER TYPE "public"."agent_type" ADD VALUE 'external' BEFORE 'system';--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "type" DROP DEFAULT;