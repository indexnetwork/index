ALTER TYPE "public"."task_state" ADD VALUE 'claimed';--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "claimed_by_agent_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "claimed_at" timestamp with time zone;