-- Keys authenticate a user, not an agent, so there is no agent ACL left to
-- store. Every grant row was written by agent registration or invitation
-- provisioning, both of which are gone, and nothing reads the table now that
-- MCP authorization decides on the caller's principal kind alone.

DROP TABLE IF EXISTS "agent_permissions";
--> statement-breakpoint
DROP TYPE IF EXISTS "permission_scope";
