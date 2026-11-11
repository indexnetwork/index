CREATE TABLE "question_group_members" (
	"question_id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"state" text DEFAULT 'held' NOT NULL,
	"lead_question_id" text NOT NULL,
	"answer_text" text,
	"answered_at" timestamp,
	"shown_at" timestamp,
	"emailed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "question_group_members" ADD CONSTRAINT "question_group_members_group_id_question_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."question_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_groups" ADD CONSTRAINT "question_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "question_group_members_group_idx" ON "question_group_members" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "question_groups_user_state_idx" ON "question_groups" USING btree ("user_id","state");