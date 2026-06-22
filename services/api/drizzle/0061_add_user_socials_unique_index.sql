CREATE UNIQUE INDEX IF NOT EXISTS "uniq_user_socials_user_label" ON "user_socials" ("user_id", "label") WHERE "label" <> 'custom';
