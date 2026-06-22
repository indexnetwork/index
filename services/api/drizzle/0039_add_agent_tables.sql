CREATE TYPE "public"."agent_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."agent_type" AS ENUM('personal', 'system');--> statement-breakpoint
CREATE TYPE "public"."permission_scope" AS ENUM('global', 'node', 'network');--> statement-breakpoint
CREATE TYPE "public"."transport_channel" AS ENUM('webhook', 'mcp');--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" "agent_type" DEFAULT 'personal' NOT NULL,
	"status" "agent_status" DEFAULT 'active' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_transports" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"channel" "transport_channel" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"priority" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"scope" "permission_scope" DEFAULT 'global' NOT NULL,
	"scope_id" text,
	"actions" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_transports" ADD CONSTRAINT "agent_transports_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_permissions" ADD CONSTRAINT "agent_permissions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_permissions" ADD CONSTRAINT "agent_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_owner_id_idx" ON "agents" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "agents_type_idx" ON "agents" USING btree ("type");--> statement-breakpoint
CREATE INDEX "agent_transports_agent_id_idx" ON "agent_transports" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_permissions_agent_id_idx" ON "agent_permissions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_permissions_user_id_idx" ON "agent_permissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_permissions_agent_user_idx" ON "agent_permissions" USING btree ("agent_id","user_id");
