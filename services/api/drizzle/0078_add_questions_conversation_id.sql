ALTER TABLE "questions" ADD COLUMN "conversation_id" text;--> statement-breakpoint
CREATE INDEX "questions_conversation_id_idx" ON "questions" USING btree ("conversation_id");