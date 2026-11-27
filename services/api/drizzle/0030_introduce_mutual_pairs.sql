CREATE TABLE "contact_research" (
	"email" text PRIMARY KEY NOT NULL,
	"status" text,
	"seat_user_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"researched_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "frequency" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "rank" integer;--> statement-breakpoint
ALTER TABLE "contact_research" ADD CONSTRAINT "contact_research_seat_user_id_users_id_fk" FOREIGN KEY ("seat_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_owner_rank_idx" ON "contacts" USING btree ("owner_user_id","rank");