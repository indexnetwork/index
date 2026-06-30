CREATE TABLE "chat_session_scopes" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_session_scopes" ADD CONSTRAINT "chat_session_scopes_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_session_scopes_user_scope_unique" ON "chat_session_scopes" USING btree ("user_id","scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "chat_session_scopes_user_id_idx" ON "chat_session_scopes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_session_scopes_scope_idx" ON "chat_session_scopes" USING btree ("scope_type","scope_id");