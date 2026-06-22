DROP INDEX "users_email_unique";--> statement-breakpoint
ALTER TABLE "networks" ADD COLUMN "is_experiment" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "networks" ADD COLUMN "experiment_master_key_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "experiment_network_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_experiment_network_id_networks_id_fk" FOREIGN KEY ("experiment_network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_experiment_unique" ON "users" USING btree ("email","experiment_network_id");