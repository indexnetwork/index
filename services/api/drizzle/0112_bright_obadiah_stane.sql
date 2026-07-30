CREATE TABLE "signal_intake_packs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"brief" text NOT NULL,
	"question" jsonb NOT NULL,
	"premise_hash" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_intake_packs_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "signal_intake_packs" ADD CONSTRAINT "signal_intake_packs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signal_intake_packs_user_id_idx" ON "signal_intake_packs" USING btree ("user_id");