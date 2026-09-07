DROP TABLE IF EXISTS "artifacts" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "tasks" CASCADE;--> statement-breakpoint
DROP TYPE IF EXISTS "public"."task_state";--> statement-breakpoint
ALTER TABLE "conversation_sessions" DROP COLUMN IF EXISTS "task_id";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN IF EXISTS "task_id";--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN IF EXISTS "reference_task_ids";--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN IF EXISTS "last_negotiation_pickup_at";--> statement-breakpoint
ALTER TABLE "intents" DROP COLUMN IF EXISTS "negotiation_batch_id";
