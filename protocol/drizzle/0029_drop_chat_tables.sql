-- Drop chat tables (XMTP migration: chat sessions/messages now handled by XMTP)
DROP TABLE IF EXISTS "chat_messages" CASCADE;
--> statement-breakpoint
DROP TABLE IF EXISTS "chat_sessions" CASCADE;
--> statement-breakpoint
DROP TYPE IF EXISTS "chat_message_role";
