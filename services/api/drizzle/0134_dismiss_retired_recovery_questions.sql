-- Question retirement, step 3: the post-discovery recovery generator is
-- removed (docs/plans/2026-08-18-conversational-questions.md, "Retirements").
-- Void the pending recovery rows the discovery-completion producers left
-- behind. Creation-time intent refinement also stamps purpose 'recovery'
-- (shared cadence), so this targets only the retired discovery-completion
-- provenance; refinement rows retire in the next step's migration.
--
-- Same shape as 0127/0132/0133: dismissal with the auditable
-- `voidedReason = 'retired_mode'` marker; `status = 'pending'` keeps answered
-- history intact and makes the migration idempotent.

UPDATE questions
SET
  status = 'dismissed',
  detection = jsonb_set(detection, '{voidedReason}', '"retired_mode"'::jsonb, true)
WHERE detection->>'purpose' = 'recovery'
  AND detection->'recovery'->>'completionSource' IN ('from_intent', 'discovery_run')
  AND status = 'pending';
