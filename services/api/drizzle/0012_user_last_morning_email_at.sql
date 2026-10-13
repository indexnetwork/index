ALTER TABLE "users" ADD COLUMN "last_morning_email_at" timestamp;
--> statement-breakpoint
UPDATE "users" SET "last_morning_email_at" = "last_morning_brief_at";
--> statement-breakpoint
UPDATE "user_notification_settings" s
SET "preferences" = (s."preferences"::jsonb || '{"morningBrief": true}')::json
FROM "users" u
WHERE u."id" = s."user_id" AND u."email_verified" AND u."deleted_at" IS NULL
  AND s."preferences"::jsonb->>'morningBrief' = 'false';