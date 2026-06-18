-- WS8 (IND-365): remove the user_profiles table entirely. Identity (name/bio/location)
-- lives on `users`; skills/interests/narrative are superseded by premises + user_contexts.
DROP TABLE "user_profiles" CASCADE;
--> statement-breakpoint
-- Deferred from WS10 (IND-367): profile-HyDE discovery was retired, leaving these
-- hyde_documents rows orphaned (never read). Clean them up now.
DELETE FROM "hyde_documents" WHERE "source_type" = 'profile';
