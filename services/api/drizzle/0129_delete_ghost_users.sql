-- Retire ghost users permanently.
--
-- A "ghost" was a placeholder account minted for a contact who had no Index
-- account, so an imported address book could participate in matching before the
-- person signed up. The import and manual-add paths that created them were
-- removed in protocol 17.0.0 / api 0.91.0; contacts now arise only from
-- accepting an opportunity, which links two real accounts. Nothing in the
-- codebase can create a ghost any more, so the remaining rows are the last of
-- them and this migration is the end of the feature, not a cleanup pass.
--
-- Why deleting them is safe (verified against production before writing):
--
--   * 14 rows have is_ghost = true; ALL of them have zero `accounts` and zero
--     `sessions`. None ever authenticated, so none is a real person's account
--     that was mislabelled — deleting them cannot lock anybody out.
--   * 19 opportunities name a ghost actor, and NONE is accepted or pending
--     (9 draft, 6 expired, 4 rejected). No accepted match is destroyed and no
--     user loses a card they were being asked to act on.
--   * The 14 contact memberships held by ghosts are memberships that a real
--     user can no longer act on anyway: the counterpart cannot log in, so the
--     edge can never produce a conversation.
--
-- Ordering is dictated by the foreign keys, not by preference. Most references
-- to `users` are ON DELETE CASCADE and clear themselves when the user row goes
-- (premises, user_contexts, user_socials, user_notification_settings,
-- enrichment_tool_runs, signal_intake_*, agents, negotiator_memories,
-- opportunity_deliveries, opportunity_outcome_events, ...). Five are NO ACTION
-- and must be cleared by hand first: files, intents, network_members,
-- personal_networks, and — indirectly — the networks those ghosts owned.
-- `opportunities.actors` is JSONB with no foreign key at all, so it is matched
-- structurally.
--
-- Idempotent: every statement keys off `users.is_ghost = true`, which is empty
-- after a successful run, so re-applying this migration is a no-op.

-- 1. Stage the personal networks owned by ghosts.
--
-- These have to be identified BEFORE `personal_networks` rows are deleted, but
-- the `networks` rows can only be deleted AFTER, because personal_networks
-- references networks with NO ACTION. A regular (not TEMP) table carries the
-- ids across the gap; TEMP would not survive a pooled connection switching
-- between statement-breakpoints. Dropped at the end of this migration.
CREATE TABLE IF NOT EXISTS "_ghost_cleanup_networks" ("network_id" text PRIMARY KEY);--> statement-breakpoint

INSERT INTO "_ghost_cleanup_networks" ("network_id")
SELECT pn."network_id"
FROM "personal_networks" pn
JOIN "users" u ON u."id" = pn."user_id"
WHERE u."is_ghost" = true
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- 2. Opportunities naming a ghost actor.
--
-- No foreign key backs `actors`, so this is a structural match on the JSONB
-- array. Deleting the opportunity also clears its deliveries and outcome
-- events, which cascade from the opportunity.
DELETE FROM "opportunities" o
WHERE EXISTS (
  SELECT 1 FROM jsonb_array_elements(o."actors") a
  JOIN "users" u ON u."id" = a->>'userId'
  WHERE u."is_ghost" = true
);--> statement-breakpoint

-- 3. HyDE documents describing a ghost profile or a ghost's intent.
--
-- `hyde_documents.source_id` is a polymorphic reference with no foreign key, so
-- nothing would clear these automatically and they would survive as embeddings
-- that match against a user who no longer exists.
DELETE FROM "hyde_documents"
WHERE "source_type" = 'profile'
  AND "source_id" IN (SELECT "id" FROM "users" WHERE "is_ghost" = true);--> statement-breakpoint

DELETE FROM "hyde_documents"
WHERE "source_type" = 'intent'
  AND "source_id" IN (
    SELECT i."id" FROM "intents" i
    JOIN "users" u ON u."id" = i."user_id"
    WHERE u."is_ghost" = true
  );--> statement-breakpoint

-- 4. Intent→network assignments, then the intents themselves.
--
-- Two distinct sets: assignments belonging to a ghost's intent, and assignments
-- pointing AT a ghost-owned personal network (whose intent may belong to a real
-- user). Both block their parent row, and `intents` is NO ACTION on users.
DELETE FROM "intent_networks"
WHERE "intent_id" IN (
  SELECT i."id" FROM "intents" i
  JOIN "users" u ON u."id" = i."user_id"
  WHERE u."is_ghost" = true
);--> statement-breakpoint

DELETE FROM "intent_networks"
WHERE "network_id" IN (SELECT "network_id" FROM "_ghost_cleanup_networks");--> statement-breakpoint

DELETE FROM "intents"
WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "is_ghost" = true);--> statement-breakpoint

-- 5. Premise→network assignments pointing at a ghost-owned network.
--
-- Premises owned by ghosts cascade with the user; these rows may belong to a
-- real user's premise that was scoped to the ghost's network, and block the
-- network delete either way.
DELETE FROM "premise_networks"
WHERE "network_id" IN (SELECT "network_id" FROM "_ghost_cleanup_networks");--> statement-breakpoint

-- 6. Memberships: ghosts held as someone's contact, and every member of a
-- ghost-owned network (including real users who were added to it).
DELETE FROM "network_members"
WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "is_ghost" = true)
   OR "network_id" IN (SELECT "network_id" FROM "_ghost_cleanup_networks");--> statement-breakpoint

DELETE FROM "network_integrations"
WHERE "network_id" IN (SELECT "network_id" FROM "_ghost_cleanup_networks");--> statement-breakpoint

-- 7. Files owned by ghosts (NO ACTION on users).
DELETE FROM "files"
WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "is_ghost" = true);--> statement-breakpoint

-- 8. The personal-network link rows, then the networks themselves.
DELETE FROM "personal_networks"
WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "is_ghost" = true);--> statement-breakpoint

DELETE FROM "networks"
WHERE "id" IN (SELECT "network_id" FROM "_ghost_cleanup_networks");--> statement-breakpoint

-- 9. The ghosts. Everything still referencing them is ON DELETE CASCADE.
DELETE FROM "users" WHERE "is_ghost" = true;--> statement-breakpoint

DROP TABLE IF EXISTS "_ghost_cleanup_networks";
