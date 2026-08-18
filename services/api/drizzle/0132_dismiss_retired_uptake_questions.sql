-- Question retirement, step 1: the pre-accept uptake generator is removed
-- (docs/plans/2026-08-18-conversational-questions.md, "Retirements"). Void the
-- pending advisory rows it left behind so they stop occupying inboxes and the
-- acceptance preflight surface that consumed them (also removed) has nothing
-- to resurface.
--
-- Same shape as 0127 (retired discovery generator): dismissal, not deletion,
-- with the auditable `voidedReason = 'retired_mode'` marker. Answered and
-- already-dismissed uptake rows keep their state and history; this targets
-- `status = 'pending'` only, which also makes the migration idempotent.

UPDATE questions
SET
  status = 'dismissed',
  detection = jsonb_set(detection, '{voidedReason}', '"retired_mode"'::jsonb, true)
WHERE detection->>'mode' = 'negotiation'
  AND detection->>'purpose' = 'uptake'
  AND status = 'pending';
