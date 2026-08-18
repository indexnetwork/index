-- Question retirement, step 5: the chat ask_user_question generator is
-- removed (docs/plans/2026-08-18-conversational-questions.md, "Retirements").
-- Void the pending chat-mode rows its blocking tool left behind: the wait bus
-- and the inline cards are gone, so nothing can resume a turn or render them.
-- Personas now ask in plain conversation; no card machinery replaces this.
--
-- Answered chat rows — including the fast-intake analytics mirror's
-- insert-then-answer rows — keep their state and history. Targeting
-- `status = 'pending'` only makes this idempotent.

UPDATE questions
SET
  status = 'dismissed',
  detection = jsonb_set(detection, '{voidedReason}', '"retired_mode"'::jsonb, true)
WHERE detection->>'mode' = 'chat'
  AND status = 'pending';
