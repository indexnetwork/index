ALTER TABLE "users" ADD COLUMN "xmtp_inbox_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_xmtp_inbox_id_unique" UNIQUE("xmtp_inbox_id");
