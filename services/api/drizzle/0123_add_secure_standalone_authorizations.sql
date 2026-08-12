CREATE TABLE "hermes_agent_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"secret_hash" text NOT NULL,
	"owner_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"setup_attempt_id" text NOT NULL,
	"audience" text NOT NULL,
	"actions" text[] NOT NULL,
	"activation_state" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "hermes_agent_credentials_audience_check" CHECK ("hermes_agent_credentials"."audience" = 'hermes-agent'),
	CONSTRAINT "hermes_agent_credentials_actions_check" CHECK ("hermes_agent_credentials"."actions" = ARRAY['manage:identity', 'manage:premises', 'manage:intents', 'manage:networks', 'manage:opportunities', 'manage:negotiations']::text[]),
	CONSTRAINT "hermes_agent_credentials_state_check" CHECK ("hermes_agent_credentials"."activation_state" IN ('pending', 'active', 'revoked')),
	CONSTRAINT "hermes_agent_credentials_expiry_check" CHECK ("hermes_agent_credentials"."expires_at" > "hermes_agent_credentials"."issued_at")
);
--> statement-breakpoint
CREATE TABLE "hermes_authorizations" (
	"request_id" text PRIMARY KEY NOT NULL,
	"owner_id" text,
	"agent_id" text,
	"installation_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"state" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text NOT NULL,
	"actions" text[] NOT NULL,
	"code_hash" text,
	"setup_attempt_id" text,
	"replay_receipt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "hermes_authorizations_s256_check" CHECK ("hermes_authorizations"."code_challenge_method" = 'S256'),
	CONSTRAINT "hermes_authorizations_actions_check" CHECK ("hermes_authorizations"."actions" = ARRAY['manage:identity', 'manage:premises', 'manage:intents', 'manage:networks', 'manage:opportunities', 'manage:negotiations']::text[]),
	CONSTRAINT "hermes_authorizations_expiry_check" CHECK ("hermes_authorizations"."expires_at" > "hermes_authorizations"."created_at")
);
--> statement-breakpoint
CREATE TABLE "index_app_owner_authorizations" (
	"request_id" text PRIMARY KEY NOT NULL,
	"owner_id" text,
	"installation_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"state" text NOT NULL,
	"code_challenge" text NOT NULL,
	"code_challenge_method" text NOT NULL,
	"legacy_key_id" text,
	"code_hash" text,
	"replay_receipt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "index_app_owner_authorizations_s256_check" CHECK ("index_app_owner_authorizations"."code_challenge_method" = 'S256'),
	CONSTRAINT "index_app_owner_authorizations_expiry_check" CHECK ("index_app_owner_authorizations"."expires_at" > "index_app_owner_authorizations"."created_at")
);
--> statement-breakpoint
CREATE TABLE "index_app_owner_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"secret_hash" text NOT NULL,
	"activation_proof_hash" text,
	"owner_id" text NOT NULL,
	"installation_id" text NOT NULL,
	"generation" text NOT NULL,
	"audience" text NOT NULL,
	"activation_state" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "index_app_owner_credentials_audience_check" CHECK ("index_app_owner_credentials"."audience" = 'index-app-owner'),
	CONSTRAINT "index_app_owner_credentials_state_check" CHECK ("index_app_owner_credentials"."activation_state" IN ('pending', 'active', 'revoked')),
	CONSTRAINT "index_app_owner_credentials_expiry_check" CHECK ("index_app_owner_credentials"."expires_at" > "index_app_owner_credentials"."issued_at")
);
--> statement-breakpoint
ALTER TABLE "hermes_agent_credentials" ADD CONSTRAINT "hermes_agent_credentials_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hermes_agent_credentials" ADD CONSTRAINT "hermes_agent_credentials_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hermes_authorizations" ADD CONSTRAINT "hermes_authorizations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hermes_authorizations" ADD CONSTRAINT "hermes_authorizations_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_app_owner_authorizations" ADD CONSTRAINT "index_app_owner_authorizations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_app_owner_credentials" ADD CONSTRAINT "index_app_owner_credentials_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hermes_agent_credentials_secret_hash_unique" ON "hermes_agent_credentials" USING btree ("secret_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "hermes_agent_credentials_live_installation_unique" ON "hermes_agent_credentials" USING btree ("owner_id","installation_id") WHERE "hermes_agent_credentials"."activation_state" IN ('pending', 'active');--> statement-breakpoint
CREATE UNIQUE INDEX "hermes_agent_credentials_live_generation_unique" ON "hermes_agent_credentials" USING btree ("agent_id","setup_attempt_id") WHERE "hermes_agent_credentials"."activation_state" IN ('pending', 'active');--> statement-breakpoint
CREATE INDEX "hermes_agent_credentials_expiry_idx" ON "hermes_agent_credentials" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hermes_authorization_state_unique" ON "hermes_authorizations" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "hermes_authorization_code_hash_unique" ON "hermes_authorizations" USING btree ("code_hash") WHERE "hermes_authorizations"."code_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "hermes_authorizations_installation_idx" ON "hermes_authorizations" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "hermes_authorizations_expiry_idx" ON "hermes_authorizations" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "index_app_owner_authorization_state_unique" ON "index_app_owner_authorizations" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "index_app_owner_authorization_code_hash_unique" ON "index_app_owner_authorizations" USING btree ("code_hash") WHERE "index_app_owner_authorizations"."code_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "index_app_owner_authorizations_installation_idx" ON "index_app_owner_authorizations" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "index_app_owner_authorizations_expiry_idx" ON "index_app_owner_authorizations" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "index_app_owner_credentials_secret_hash_unique" ON "index_app_owner_credentials" USING btree ("secret_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "index_app_owner_credentials_live_installation_unique" ON "index_app_owner_credentials" USING btree ("owner_id","installation_id") WHERE "index_app_owner_credentials"."activation_state" IN ('pending', 'active');--> statement-breakpoint
CREATE UNIQUE INDEX "index_app_owner_credentials_generation_unique" ON "index_app_owner_credentials" USING btree ("owner_id","installation_id","generation");--> statement-breakpoint
CREATE INDEX "index_app_owner_credentials_expiry_idx" ON "index_app_owner_credentials" USING btree ("expires_at");