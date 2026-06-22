CREATE TABLE "chat_session_summaries" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"from_message_id" text NOT NULL,
	"to_message_id" text NOT NULL,
	"digest" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_session_summaries" ADD CONSTRAINT "chat_session_summaries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session_summaries" ADD CONSTRAINT "chat_session_summaries_from_message_id_messages_id_fk" FOREIGN KEY ("from_message_id") REFERENCES "public"."messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_session_summaries" ADD CONSTRAINT "chat_session_summaries_to_message_id_messages_id_fk" FOREIGN KEY ("to_message_id") REFERENCES "public"."messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_session_summaries_session_latest_idx" ON "chat_session_summaries" USING btree ("conversation_id","to_message_id");