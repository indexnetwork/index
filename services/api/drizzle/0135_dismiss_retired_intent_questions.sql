-- Question retirement, step 4: the intent refinement generator is removed
-- (docs/plans/2026-08-18-conversational-questions.md, "Retirements"). Void
-- every remaining pending intent-mode row: creation-time refinement (stamped
-- purpose 'recovery' with completionSource 'intent_creation'), legacy
-- refinement rows without recovery provenance, and anything 0134's
-- discovery-source filter did not cover.
--
-- Same shape as 0127/0132–0134: dismissal with the auditable
-- `voidedReason = 'retired_mode'` marker; `status = 'pending'` keeps answered
-- history intact and makes the migration idempotent.

UPDATE questions
SET
  status = 'dismissed',
  detection = jsonb_set(detection, '{voidedReason}', '"retired_mode"'::jsonb, true)
WHERE detection->>'mode' = 'intent'
  AND status = 'pending';
