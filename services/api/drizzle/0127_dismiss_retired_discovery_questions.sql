-- One-time cleanup: dismiss pending questions left behind by the retired
-- `discovery` generator (removed in PR #1396, protocol 13.0.0).
--
-- Why only `discovery`, and why dismissal rather than deletion:
--
--   Answering a `discovery` question is a no-op. `question.answer.handler.ts`
--   has a literal `break` for that mode, and the ChatContextDigest its comment
--   points at is built by `chat.summarizer.ts` from chat messages — it never
--   reads the questions table. These rows are dead ends: they occupied the
--   majority of the unscoped questions inbox while being unanswerable in any
--   meaningful sense.
--
--   `enrichment` rows are deliberately NOT touched. Answering one still runs
--   createPremiseFromAnswer and regenerates user context, so those remain
--   pending and useful even though their generator is gone.
--
--   Answered and already-dismissed `discovery` rows are left alone: this
--   targets `status = 'pending'` only, so user-supplied answers and prior
--   dismissals keep their existing state and history.
--
-- The `voidedReason = 'retired_mode'` marker makes the change auditable and
-- reversible: exactly the rows this migration touched are recoverable with
--
--   UPDATE questions
--   SET status = 'pending', detection = detection - 'voidedReason'
--   WHERE detection->>'voidedReason' = 'retired_mode';
--
-- Idempotent: rows already carrying the marker are excluded by the
-- status = 'pending' predicate, and re-running matches nothing.

UPDATE questions
SET
  status = 'dismissed',
  detection = jsonb_set(detection, '{voidedReason}', '"retired_mode"'::jsonb, true)
WHERE detection->>'mode' = 'discovery'
  AND status = 'pending';
