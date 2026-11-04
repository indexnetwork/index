CREATE TABLE "invite_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_credits" (
	"id" text PRIMARY KEY NOT NULL,
	"inviter_user_id" text NOT NULL,
	"invitee_user_id" text NOT NULL,
	"counterpart_user_id" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "invited_by_id" text;--> statement-breakpoint
ALTER TABLE "invite_codes" ADD CONSTRAINT "invite_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_credits" ADD CONSTRAINT "invite_credits_inviter_user_id_users_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_credits" ADD CONSTRAINT "invite_credits_invitee_user_id_users_id_fk" FOREIGN KEY ("invitee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_credits" ADD CONSTRAINT "invite_credits_counterpart_user_id_users_id_fk" FOREIGN KEY ("counterpart_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_credits" ADD CONSTRAINT "invite_credits_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invite_codes_code_unique" ON "invite_codes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "invite_codes_user_unique" ON "invite_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invite_credits_invitee_counterpart_unique" ON "invite_credits" USING btree ("invitee_user_id","counterpart_user_id");--> statement-breakpoint
CREATE INDEX "invite_credits_inviter_idx" ON "invite_credits" USING btree ("inviter_user_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;