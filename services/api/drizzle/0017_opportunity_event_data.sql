DROP INDEX "opportunity_events_one_fact";--> statement-breakpoint
ALTER TABLE "opportunity_events" ADD COLUMN "data" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_events_one_fact" ON "opportunity_events" USING btree ("opportunity_id","type") WHERE "opportunity_events"."type" in ('opened', 'agreed', 'declined', 'expired');