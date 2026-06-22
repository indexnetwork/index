ALTER TABLE "users" ADD COLUMN "key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "users_key_unique" ON "users" USING btree ("key");--> statement-breakpoint
ALTER TABLE "indexes" ADD COLUMN "key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "indexes_key_unique" ON "indexes" USING btree ("key");
