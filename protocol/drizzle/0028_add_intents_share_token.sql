ALTER TABLE "intents" ADD COLUMN "share_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "intents_share_token_idx" ON "intents" USING btree ("share_token");