CREATE TABLE "network_join_requests" (
	"network_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "network_join_requests_network_id_user_id_pk" PRIMARY KEY("network_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "network_join_requests" ADD CONSTRAINT "network_join_requests_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_join_requests" ADD CONSTRAINT "network_join_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "network_join_requests_network_id_status_idx" ON "network_join_requests" USING btree ("network_id","status");