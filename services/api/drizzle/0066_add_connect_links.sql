CREATE TABLE "connect_links" (
	"code" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"opportunity_id" text NOT NULL,
	"kind" text NOT NULL,
	"greeting" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connect_links" ADD CONSTRAINT "connect_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connect_links" ADD CONSTRAINT "connect_links_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connect_links_kind_recipient_uq" ON "connect_links" USING btree ("opportunity_id","user_id","kind");--> statement-breakpoint
CREATE INDEX "connect_links_expires_at_idx" ON "connect_links" USING btree ("expires_at");