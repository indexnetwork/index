CREATE TABLE "opportunity_outcome_events" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_user_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"intent_fingerprint" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"network_id" text,
	"action" text NOT NULL,
	"candidate_snapshot" text NOT NULL,
	"snapshot_hash" text NOT NULL,
	"dedup_key" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_outcome_events" ADD CONSTRAINT "opportunity_outcome_events_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_opp_outcome_events_idempotency" ON "opportunity_outcome_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_opp_outcome_events_scope" ON "opportunity_outcome_events" USING btree ("recipient_user_id","intent_id","intent_fingerprint");