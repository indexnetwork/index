CREATE TABLE "agent_test_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"content" text NOT NULL,
	"reservation_token" text,
	"reserved_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_test_messages" ADD CONSTRAINT "agent_test_messages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_test_messages" ADD CONSTRAINT "agent_test_messages_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_test_messages_agent_pending" ON "agent_test_messages" USING btree ("agent_id","reserved_at");