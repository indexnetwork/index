CREATE TABLE "hidden_conversations" (
	"user_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"hidden_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hidden_conversations_user_id_conversation_id_pk" PRIMARY KEY("user_id","conversation_id")
);
--> statement-breakpoint
ALTER TABLE "hidden_conversations" ADD CONSTRAINT "hidden_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;