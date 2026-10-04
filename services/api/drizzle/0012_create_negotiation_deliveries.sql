CREATE TABLE "negotiation_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"recipient_user_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"claim_token" text,
	"claimed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "negotiation_deliveries" ADD CONSTRAINT "negotiation_deliveries_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "negotiation_deliveries_created_at_idx" ON "negotiation_deliveries" USING btree ("created_at");