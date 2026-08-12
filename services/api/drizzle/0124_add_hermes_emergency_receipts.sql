CREATE TABLE "hermes_emergency_receipts" (
	"plan_id" text PRIMARY KEY NOT NULL,
	"audience" text NOT NULL,
	"installations" integer NOT NULL,
	"credentials" integer NOT NULL,
	"permissions" integer NOT NULL,
	"owners" integer NOT NULL,
	"selected_paused" integer NOT NULL,
	"credentials_revoked" integer NOT NULL,
	"permissions_removed" integer NOT NULL,
	"installations_disconnected" integer NOT NULL,
	"result_reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hermes_emergency_receipts_plan_id_check" CHECK ("hermes_emergency_receipts"."plan_id" ~ '^hecp_[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "hermes_emergency_receipts_audience_check" CHECK ("hermes_emergency_receipts"."audience" = 'hermes-agent'),
	CONSTRAINT "hermes_emergency_receipts_result_check" CHECK ("hermes_emergency_receipts"."result_reason" = 'executed'),
	CONSTRAINT "hermes_emergency_receipts_counts_check" CHECK (
    "hermes_emergency_receipts"."installations" >= 0 AND "hermes_emergency_receipts"."credentials" >= 0
    AND "hermes_emergency_receipts"."permissions" >= 0 AND "hermes_emergency_receipts"."owners" >= 0
    AND "hermes_emergency_receipts"."selected_paused" >= 0 AND "hermes_emergency_receipts"."selected_paused" <= "hermes_emergency_receipts"."installations"
    AND "hermes_emergency_receipts"."credentials_revoked" >= 0 AND "hermes_emergency_receipts"."credentials_revoked" <= "hermes_emergency_receipts"."credentials"
    AND "hermes_emergency_receipts"."permissions_removed" >= 0 AND "hermes_emergency_receipts"."permissions_removed" <= "hermes_emergency_receipts"."permissions"
    AND "hermes_emergency_receipts"."installations_disconnected" >= 0 AND "hermes_emergency_receipts"."installations_disconnected" <= "hermes_emergency_receipts"."installations"
  )
);
