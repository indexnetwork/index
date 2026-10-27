CREATE TABLE "moralmod_arms" (
	"user_id" text PRIMARY KEY NOT NULL,
	"arm" text NOT NULL,
	"experiment_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "moralmod_arms" ADD CONSTRAINT "moralmod_arms_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;