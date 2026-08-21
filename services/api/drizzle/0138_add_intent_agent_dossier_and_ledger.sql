CREATE TYPE "public"."intent_dossier_source" AS ENUM('user_message', 'answer', 'agent_note');
--> statement-breakpoint
CREATE TABLE "intent_dossier" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "intent_id" text NOT NULL,
  "text" text NOT NULL,
  "source" "intent_dossier_source" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "retired_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "intent_dossier" ADD CONSTRAINT "intent_dossier_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "intent_dossier" ADD CONSTRAINT "intent_dossier_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "idx_intent_dossier_scope" ON "intent_dossier" USING btree ("user_id","intent_id","retired_at");
--> statement-breakpoint
CREATE TABLE "intent_agent_acts" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "intent_id" text NOT NULL,
  "event" jsonb NOT NULL,
  "act" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intent_agent_acts" ADD CONSTRAINT "intent_agent_acts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX "idx_intent_agent_acts_scope" ON "intent_agent_acts" USING btree ("user_id","intent_id","created_at");
