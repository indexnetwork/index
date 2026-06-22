CREATE TABLE "opportunity_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"user_id" text NOT NULL,
	"agent_id" text,
	"channel" text NOT NULL,
	"trigger" text NOT NULL,
	"delivered_at_status" text NOT NULL,
	"reservation_token" text,
	"reserved_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_deliveries" ADD CONSTRAINT "opportunity_deliveries_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_deliveries" ADD CONSTRAINT "opportunity_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_deliveries" ADD CONSTRAINT "opportunity_deliveries_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_opp_deliveries_committed" ON "opportunity_deliveries" USING btree ("user_id","opportunity_id","channel","delivered_at_status") WHERE "opportunity_deliveries"."delivered_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_opp_deliveries_open_reservations" ON "opportunity_deliveries" USING btree ("user_id","channel","reserved_at") WHERE "opportunity_deliveries"."delivered_at" IS NULL;