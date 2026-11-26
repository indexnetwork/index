CREATE TABLE "introducer_exclusions" (
	"introducer_user_id" text NOT NULL,
	"excluded_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "introducer_exclusions_introducer_user_id_excluded_user_id_pk" PRIMARY KEY("introducer_user_id","excluded_user_id")
);
--> statement-breakpoint
ALTER TABLE "introducer_exclusions" ADD CONSTRAINT "introducer_exclusions_introducer_user_id_users_id_fk" FOREIGN KEY ("introducer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "introducer_exclusions" ADD CONSTRAINT "introducer_exclusions_excluded_user_id_users_id_fk" FOREIGN KEY ("excluded_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;