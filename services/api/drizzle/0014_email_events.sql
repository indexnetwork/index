CREATE TABLE "email_events" (
	"id" text PRIMARY KEY NOT NULL,
	"email_id" text NOT NULL,
	"type" text NOT NULL,
	"kind" text,
	"occurred_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "email_events_type_occurred_at_idx" ON "email_events" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE INDEX "email_events_email_id_idx" ON "email_events" USING btree ("email_id");