CREATE TYPE "public"."message_role" AS ENUM('user', 'agent');--> statement-breakpoint
CREATE TYPE "public"."participant_type" AS ENUM('user', 'agent');--> statement-breakpoint
CREATE TYPE "public"."task_state" AS ENUM('submitted', 'working', 'input_required', 'completed', 'failed', 'canceled', 'rejected', 'auth_required');--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"name" text,
	"description" text,
	"parts" jsonb NOT NULL,
	"metadata" jsonb,
	"extensions" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_metadata" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_participants" (
	"conversation_id" text NOT NULL,
	"participant_id" text NOT NULL,
	"participant_type" "participant_type" NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hidden_at" timestamp with time zone,
	CONSTRAINT "conversation_participants_conversation_id_participant_id_pk" PRIMARY KEY("conversation_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"task_id" text,
	"sender_id" text NOT NULL,
	"role" "message_role" NOT NULL,
	"parts" jsonb NOT NULL,
	"metadata" jsonb,
	"extensions" jsonb,
	"reference_task_ids" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"state" "task_state" DEFAULT 'submitted' NOT NULL,
	"status_message" jsonb,
	"status_timestamp" timestamp with time zone,
	"metadata" jsonb,
	"extensions" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_metadata" ADD CONSTRAINT "conversation_metadata_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_task_id_idx" ON "artifacts" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "conversation_participants_participant_id_idx" ON "conversation_participants" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_sender_id_idx" ON "messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "messages_task_id_idx" ON "messages" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "tasks_conversation_id_idx" ON "tasks" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "tasks_state_idx" ON "tasks" USING btree ("state");