CREATE TABLE "intro_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"introducer_user_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"network_id" text NOT NULL,
	"score" double precision NOT NULL,
	"intent_line" text NOT NULL,
	"contact_line" text NOT NULL,
	"draft" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"failure" text,
	"seat_user_id" text,
	"opportunity_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "embedding" vector(2000);--> statement-breakpoint
ALTER TABLE "intro_suggestions" ADD CONSTRAINT "intro_suggestions_introducer_user_id_users_id_fk" FOREIGN KEY ("introducer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intro_suggestions" ADD CONSTRAINT "intro_suggestions_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intro_suggestions" ADD CONSTRAINT "intro_suggestions_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intro_suggestions" ADD CONSTRAINT "intro_suggestions_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intro_suggestions" ADD CONSTRAINT "intro_suggestions_seat_user_id_users_id_fk" FOREIGN KEY ("seat_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intro_suggestions" ADD CONSTRAINT "intro_suggestions_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "intro_suggestions_pair_unique" ON "intro_suggestions" USING btree ("introducer_user_id","intent_id","contact_id");--> statement-breakpoint
CREATE INDEX "intro_suggestions_introducer_status_idx" ON "intro_suggestions" USING btree ("introducer_user_id","status");--> statement-breakpoint
CREATE INDEX "contacts_embedding_idx" ON "contacts" USING hnsw ("embedding" vector_cosine_ops);