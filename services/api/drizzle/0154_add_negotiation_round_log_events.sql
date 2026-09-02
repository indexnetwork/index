CREATE TYPE "public"."negotiation_round_log_event_kind" AS ENUM('opened', 'stopped', 'resumed');--> statement-breakpoint
CREATE TYPE "public"."negotiation_round_log_event_via" AS ENUM('paused', 'completed');--> statement-breakpoint
CREATE TABLE "negotiation_round_log_events" (
	"id" text PRIMARY KEY NOT NULL,
	"intent_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"task_id" text NOT NULL,
	"kind" "negotiation_round_log_event_kind" NOT NULL,
	"via" "negotiation_round_log_event_via",
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_negotiation_round_log_events_batch" ON "negotiation_round_log_events" USING btree ("intent_id","batch_id","created_at");
