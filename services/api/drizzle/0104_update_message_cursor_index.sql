DROP INDEX "messages_conversation_id_created_at_idx";--> statement-breakpoint
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages" USING btree ("conversation_id","created_at","id");