CREATE TABLE "opportunity_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"introducer_user_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"network_id" text NOT NULL,
	"detection" jsonb NOT NULL,
	"actors" jsonb NOT NULL,
	"interpretation" jsonb NOT NULL,
	"context" jsonb NOT NULL,
	"confidence" numeric NOT NULL,
	"metadata" jsonb NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"failure" text,
	"opportunity_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "excluded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "opportunity_proposals" ADD CONSTRAINT "opportunity_proposals_introducer_user_id_users_id_fk" FOREIGN KEY ("introducer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_proposals" ADD CONSTRAINT "opportunity_proposals_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_proposals" ADD CONSTRAINT "opportunity_proposals_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_proposals" ADD CONSTRAINT "opportunity_proposals_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_proposals" ADD CONSTRAINT "opportunity_proposals_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_proposals_pair_unique" ON "opportunity_proposals" USING btree ("introducer_user_id","intent_id","contact_id");--> statement-breakpoint
CREATE INDEX "opportunity_proposals_introducer_status_idx" ON "opportunity_proposals" USING btree ("introducer_user_id","status");--> statement-breakpoint
-- Carry the suggestions already found over into the opportunity format.
INSERT INTO "opportunity_proposals" ("id", "introducer_user_id", "intent_id", "contact_id", "network_id", "detection", "actors", "interpretation", "context", "confidence", "metadata", "status", "failure", "opportunity_id", "created_at", "updated_at")
SELECT s."id", s."introducer_user_id", s."intent_id", s."contact_id", s."network_id",
  jsonb_build_object('source', 'introducer', 'createdBy', 'introducer-matcher', 'triggeredBy', s."intent_id", 'timestamp', to_char(s."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
  jsonb_build_array(
    jsonb_build_object('role', 'party', 'userId', i."user_id", 'networkId', s."network_id", 'intent', s."intent_id"),
    jsonb_strip_nulls(jsonb_build_object('role', 'party', 'contactId', s."contact_id", 'via', s."introducer_user_id", 'userId', s."seat_user_id"))
  ),
  jsonb_build_object('category', 'introduction', 'reasoning', s."intent_line" || ' ⇄ ' || s."contact_line", 'confidence', s."score"),
  jsonb_build_object('networkId', s."network_id"),
  s."score",
  jsonb_build_object('introducer', jsonb_build_object('userId', s."introducer_user_id", 'context', s."draft"), 'card', jsonb_build_object('member', s."intent_line", 'contact', s."contact_line")),
  CASE s."status" WHEN 'open' THEN 'proposed' WHEN 'waking' THEN 'failed' WHEN 'woken' THEN 'opened' ELSE s."status" END,
  CASE WHEN s."status" = 'waking' THEN 'Interrupted by an update. Try again.' ELSE s."failure" END,
  s."opportunity_id", s."created_at", s."updated_at"
FROM "intro_suggestions" s JOIN "intents" i ON i."id" = s."intent_id"
ON CONFLICT DO NOTHING;
