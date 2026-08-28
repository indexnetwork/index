ALTER TYPE "public"."negotiation_round_log_event_kind" ADD VALUE 'opening_complete';--> statement-breakpoint
ALTER TABLE "negotiation_round_log_events" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "intents" ADD COLUMN "negotiation_batch_id" text;--> statement-breakpoint
ALTER TABLE "intents" DROP COLUMN "negotiation_round";--> statement-breakpoint
ALTER TABLE "intents" DROP COLUMN "negotiation_round_size";--> statement-breakpoint
ALTER TABLE "intents" DROP COLUMN "negotiation_kickoff_started_at";
