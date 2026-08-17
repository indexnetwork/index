-- Remove the Agent reporter feature.
--
-- The reporter was a read-only, web-only briefing persona at /agent, gated by
-- WEB_AGENT_SURFACE_ENABLED, plus a dark-shipped owner-confirmed cleanup-action
-- path gated by WEB_AGENT_ACTIONS_ENABLED. Both flags, the persona, its prompt
-- and toolset, the /api/chat/reporter/session and /api/agent/actions routes and
-- the whole web surface are deleted in this change. Nothing in the codebase can
-- create a reporter conversation or an action proposal any more, so this
-- migration ends the feature rather than trimming it.
--
-- Unlike the orchestrator (migration 0128), reporter rows are NOT retained.
-- The orchestrator was the historical default persona behind years of real user
-- chat; the reporter was a short-lived, flag-gated surface, and its transcripts
-- are being deleted deliberately rather than left listed in web history.
--
-- Verified against production before writing:
--
--   * 4 conversations carry persona = 'reporter', holding 2 messages total,
--     across 2 distinct users. They own no chat_session_scopes rows and no
--     tasks, so nothing else is reachable only through them.
--   * agent_action_proposals has never held a row (0 rows, all time) — the
--     actions flag was never enabled in any environment. Dropping the table
--     destroys no data.
--
-- Every foreign key pointing at `conversations` is ON DELETE CASCADE
-- (messages, conversation_participants, conversation_metadata, conversation_sessions,
-- chat_session_scopes, chat_session_summaries, tasks), so the single delete
-- below is complete and needs no ordering.
--
-- Idempotent: the DELETE keys off a persona value nothing can write again, and
-- both DROPs use IF EXISTS, so re-applying this migration is a no-op.

-- 1. Delete every reporter conversation and, by cascade, its messages,
--    participants, metadata, timeline sessions, scopes, and summaries.
DELETE FROM "conversations" WHERE "persona" = 'reporter';

--> statement-breakpoint
-- 2. Drop the dark-shipped cleanup-action proposal store. Its indexes and its
--    user_id foreign key go with the table.
DROP TABLE IF EXISTS "agent_action_proposals";

--> statement-breakpoint
-- 3. Drop the status enum the table was the only user of.
DROP TYPE IF EXISTS "public"."agent_action_proposal_status";
