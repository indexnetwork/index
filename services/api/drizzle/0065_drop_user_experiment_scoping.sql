ALTER TABLE "users" DROP CONSTRAINT "users_experiment_network_id_networks_id_fk";
--> statement-breakpoint
DROP INDEX "users_email_experiment_unique";--> statement-breakpoint
DROP INDEX "users_email_organic_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "experiment_network_id";