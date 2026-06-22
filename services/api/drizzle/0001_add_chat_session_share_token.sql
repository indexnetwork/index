ALTER TABLE "chat_sessions" ADD COLUMN "share_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_sessions_share_token_unique" ON "chat_sessions" USING btree ("share_token");