ALTER TABLE "conversations" ADD COLUMN "dm_pair" text;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_dm_pair_idx" ON "conversations" USING btree ("dm_pair");