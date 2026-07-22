CREATE TABLE "conversation_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"task_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "session_id" text;
--> statement-breakpoint
ALTER TABLE "conversation_sessions" ADD CONSTRAINT "conversation_sessions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conversation_sessions" ADD CONSTRAINT "conversation_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_session_id_conversation_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."conversation_sessions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Backfill deterministic A2A task sessions. A task owns one session even if its
-- messages share a timestamp with another task; the message ID breaks ties below.
INSERT INTO "conversation_sessions" ("id", "conversation_id", "task_id", "started_at", "last_message_at")
SELECT
  'backfill:a2a:' || "task_id",
  "conversation_id",
  "task_id",
  min("created_at"),
  max("created_at")
FROM "messages"
WHERE "task_id" IS NOT NULL
GROUP BY "conversation_id", "task_id";
--> statement-breakpoint
UPDATE "messages" AS "message"
SET "session_id" = 'backfill:a2a:' || "message"."task_id"
WHERE "message"."task_id" IS NOT NULL;
--> statement-breakpoint
-- Backfill H2A/H2H sessions using the same strictly-greater-than-24-hour gap
-- rule as runtime writes. The (created_at, id) order makes equal timestamps stable.
WITH ordered AS (
  SELECT
    "id",
    "conversation_id",
    "created_at",
    lag("created_at") OVER (
      PARTITION BY "conversation_id"
      ORDER BY "created_at", "id"
    ) AS "previous_created_at"
  FROM "messages"
  WHERE "task_id" IS NULL
), grouped AS (
  SELECT
    "id",
    "conversation_id",
    "created_at",
    sum(
      CASE
        WHEN "previous_created_at" IS NULL
          OR "created_at" - "previous_created_at" > interval '24 hours'
        THEN 1
        ELSE 0
      END
    ) OVER (
      PARTITION BY "conversation_id"
      ORDER BY "created_at", "id"
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS "session_ordinal"
  FROM ordered
)
INSERT INTO "conversation_sessions" ("id", "conversation_id", "started_at", "last_message_at")
SELECT
  'backfill:h2:' || "conversation_id" || ':' || "session_ordinal",
  "conversation_id",
  min("created_at"),
  max("created_at")
FROM grouped
GROUP BY "conversation_id", "session_ordinal";
--> statement-breakpoint
WITH ordered AS (
  SELECT
    "id",
    "conversation_id",
    "created_at",
    lag("created_at") OVER (
      PARTITION BY "conversation_id"
      ORDER BY "created_at", "id"
    ) AS "previous_created_at"
  FROM "messages"
  WHERE "task_id" IS NULL
), grouped AS (
  SELECT
    "id",
    "conversation_id",
    sum(
      CASE
        WHEN "previous_created_at" IS NULL
          OR "created_at" - "previous_created_at" > interval '24 hours'
        THEN 1
        ELSE 0
      END
    ) OVER (
      PARTITION BY "conversation_id"
      ORDER BY "created_at", "id"
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS "session_ordinal"
  FROM ordered
)
UPDATE "messages" AS "message"
SET "session_id" = 'backfill:h2:' || "grouped"."conversation_id" || ':' || "grouped"."session_ordinal"
FROM grouped
WHERE "message"."id" = "grouped"."id";
--> statement-breakpoint
CREATE INDEX "conversation_sessions_conversation_started_idx" ON "conversation_sessions" USING btree ("conversation_id","started_at","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_sessions_task_id_uniq" ON "conversation_sessions" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX "messages_session_id_created_at_idx" ON "messages" USING btree ("session_id","created_at","id");
