DROP INDEX "user_contexts_user_network_uniq";--> statement-breakpoint
ALTER TABLE "user_contexts" ALTER COLUMN "network_id" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_contexts_user_global_uniq" ON "user_contexts" USING btree ("user_id") WHERE "user_contexts"."network_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "user_contexts_user_network_uniq" ON "user_contexts" USING btree ("user_id","network_id") WHERE "user_contexts"."network_id" IS NOT NULL;