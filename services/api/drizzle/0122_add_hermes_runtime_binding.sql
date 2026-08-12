ALTER TABLE "agents" ADD COLUMN "last_negotiation_pickup_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "runtime_kind" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "installation_id" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "runtime_setup_attempt_id" text;--> statement-breakpoint
CREATE INDEX "agents_last_negotiation_pickup_at_idx" ON "agents" USING btree ("last_negotiation_pickup_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_agents_hermes_installation" ON "agents" USING btree ("owner_id","runtime_kind","installation_id") WHERE "agents"."type" = 'external' AND "agents"."runtime_kind" = 'hermes' AND "agents"."installation_id" IS NOT NULL AND "agents"."deleted_at" IS NULL;--> statement-breakpoint
WITH "ranked_selected_executors" AS (
  SELECT "id", row_number() OVER (
    PARTITION BY "owner_id"
    ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
  ) AS "selection_rank"
  FROM "agents"
  WHERE "type" = 'external'
    AND "handle_negotiations" = true
    AND "deleted_at" IS NULL
)
UPDATE "agents"
SET "handle_negotiations" = false,
    "updated_at" = now()
FROM "ranked_selected_executors"
WHERE "agents"."id" = "ranked_selected_executors"."id"
  AND "ranked_selected_executors"."selection_rank" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_agents_selected_negotiation_executor" ON "agents" USING btree ("owner_id") WHERE "agents"."type" = 'external' AND "agents"."handle_negotiations" = true AND "agents"."deleted_at" IS NULL;