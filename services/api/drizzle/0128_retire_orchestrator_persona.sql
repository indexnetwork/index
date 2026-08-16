-- Retire the pre-personafication 'orchestrator' chat persona.
--
-- Data retention: existing rows are KEPT AS-IS. Orchestrator conversations
-- stay readable and listable in the product (see getWebUserSessions and the
-- read-only branch of resolveStreamPersonaPolicy); they simply can no longer
-- drive a turn. Nothing is relabelled or archived, so no user loses history
-- and no earlier chat is silently re-attributed to a persona that did not
-- write it.

--> statement-breakpoint
-- 1. The column default stops being a persona.
--
-- `conversations.persona` is NOT NULL for every conversation, but it is only
-- meaningful for H2A chat sessions — H2H DMs and A2A negotiation conversations
-- insert without one and relied on this default. Every H2A writer now names its
-- persona explicitly, so the default's only remaining job is to fill the column
-- where it carries no meaning. 'none' says that; 'orchestrator' did not.
--
-- Existing rows are untouched: this changes the default for future inserts
-- only, so historical DM/negotiation rows keep their 'orchestrator' value and
-- historical chat sessions keep theirs.
ALTER TABLE "conversations" ALTER COLUMN "persona" SET DEFAULT 'none';

--> statement-breakpoint
-- 2. Give the reporter persona its own intent-scope registry key.
--
-- `chat_session_scopes.scope_type` keys the (user_id, scope_type, scope_id)
-- unique index that makes get-or-create race-safe. Signal and the negotiator
-- already had dedicated keys ('signal-intent', 'negotiator-intent'); every
-- other persona shared the bare 'intent' key with the orchestrator.
-- intentRegistryScopeType() now derives '<persona>-intent' uniformly, so the
-- reporter's existing rows must move with it or its intent-scoped sessions
-- would stop resolving and silently fork into new ones.
--
-- Scoped by conversation persona, so this cannot collide: the code only ever
-- wrote one of the two forms for a given (user, scope), never both.
--
-- Orchestrator rows are deliberately NOT relabelled — they keep the bare
-- 'intent' key alongside their retained conversations. Nothing resolves
-- through them any more, and rewriting them would edit history for no gain.
UPDATE "chat_session_scopes" AS s
SET "scope_type" = c."persona" || '-intent'
FROM "conversations" AS c
WHERE s."conversation_id" = c."id"
  AND s."scope_type" = 'intent'
  AND c."persona" NOT IN ('orchestrator', 'none');
