CREATE TABLE "opportunity_events" (
  "id" text PRIMARY KEY NOT NULL,
  "opportunity_id" text NOT NULL,
  "type" text NOT NULL,
  "actor_user_id" text,
  "at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "opportunity_events_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "opportunity_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "opportunity_events_opportunity_idx" ON "opportunity_events" USING btree ("opportunity_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_events_one_fact" ON "opportunity_events" USING btree ("opportunity_id","type") WHERE "type" <> 'committed';
--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_events_one_commit" ON "opportunity_events" USING btree ("opportunity_id","actor_user_id") WHERE "type" = 'committed';
--> statement-breakpoint
INSERT INTO "opportunity_events" ("id", "opportunity_id", "type", "actor_user_id", "at")
SELECT gen_random_uuid()::text, "id", 'opened', NULL, "created_at" FROM "opportunities";
--> statement-breakpoint
INSERT INTO "opportunity_events" ("id", "opportunity_id", "type", "actor_user_id", "at")
SELECT gen_random_uuid()::text, "id", 'agreed', NULL, "created_at" + interval '1 millisecond'
FROM "opportunities" WHERE "status" IN ('pending', 'accepted');
--> statement-breakpoint
INSERT INTO "opportunity_events" ("id", "opportunity_id", "type", "actor_user_id", "at")
SELECT gen_random_uuid()::text, "id", 'declined', NULL, "created_at" + interval '1 millisecond'
FROM "opportunities" WHERE "status" = 'rejected';
--> statement-breakpoint
INSERT INTO "opportunity_events" ("id", "opportunity_id", "type", "actor_user_id", "at")
SELECT gen_random_uuid()::text, "id", 'expired', NULL, "created_at" + interval '1 millisecond'
FROM "opportunities" WHERE "status" = 'expired';
--> statement-breakpoint
INSERT INTO "opportunity_events" ("id", "opportunity_id", "type", "actor_user_id", "at")
SELECT gen_random_uuid()::text, opportunity_id, 'committed', actor_user_id, at FROM (
  SELECT DISTINCT ON (o."id", actor->>'userId')
    o."id" AS opportunity_id,
    actor->>'userId' AS actor_user_id,
    o."created_at" + interval '2 milliseconds' AS at
  FROM "opportunities" o, jsonb_array_elements(o."actors") AS actor
  WHERE actor->>'userId' IS NOT NULL
    AND (
      o."status" = 'accepted'
      OR (o."status" = 'pending' AND actor->>'actedAt' IS NOT NULL)
    )
  ORDER BY o."id", actor->>'userId'
) commits;
--> statement-breakpoint
UPDATE "opportunities" SET "actors" = (
  SELECT COALESCE(jsonb_agg(actor - 'actedAt'), '[]'::jsonb)
  FROM jsonb_array_elements("actors") AS actor
);
--> statement-breakpoint
ALTER TABLE "opportunities" DROP COLUMN "accepted_by";