ALTER TABLE "agents" ADD COLUMN "notify_on_opportunity" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "daily_summary_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "handle_negotiations" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "last_daily_summary_at" timestamp with time zone;