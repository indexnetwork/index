-- One PersonalAgent persona: the signal/onboarding/negotiator chat personas
-- collapse into 'personal'. Scope is derived from the session row (its intent
-- scope link), never from a persona id. 'orchestrator' and 'telegram' rows are
-- deliberately untouched: they are read-only history, not chat personas.
UPDATE "conversations" SET "persona" = 'personal' WHERE "persona" IN ('signal', 'onboarding', 'negotiator');--> statement-breakpoint

-- Fold the persona-keyed intent registries into one 'personal-intent' key
-- (one DM per signal). The negotiator DM wins a collision with the old
-- pinned-signal chat for the same intent: it is the conversation the
-- IntentAgent's memory lives in.
UPDATE "chat_session_scopes" SET "scope_type" = 'personal-intent' WHERE "scope_type" = 'negotiator-intent';--> statement-breakpoint
UPDATE "chat_session_scopes" s SET "scope_type" = 'personal-intent'
  WHERE s."scope_type" = 'signal-intent'
    AND NOT EXISTS (
      SELECT 1 FROM "chat_session_scopes" t
      WHERE t."user_id" = s."user_id"
        AND t."scope_type" = 'personal-intent'
        AND t."scope_id" = s."scope_id"
    );--> statement-breakpoint
-- Collision losers (a signal that already had a DM): archive the old pinned
-- chat — hidden from the owner's listings and, with no registry claim, held
-- read-only by the canonical-DM guard. Still readable by id.
UPDATE "conversation_participants" cp SET "hidden_at" = now()
  FROM "chat_session_scopes" s
  WHERE s."scope_type" = 'signal-intent'
    AND cp."conversation_id" = s."conversation_id"
    AND cp."participant_id" = s."user_id"
    AND cp."participant_type" = 'user'
    AND cp."hidden_at" IS NULL;--> statement-breakpoint
DELETE FROM "chat_session_scopes" WHERE "scope_type" = 'signal-intent';
