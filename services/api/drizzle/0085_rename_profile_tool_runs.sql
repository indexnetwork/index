-- WS11 (IND-368): rename profile_tool_runs -> enrichment_tool_runs (data-preserving).
-- The async-run subsystem tracks enrichment tool runs (preview/update); the "profile" name is legacy.
ALTER TABLE "profile_tool_runs" RENAME TO "enrichment_tool_runs";--> statement-breakpoint
ALTER INDEX "profile_tool_runs_user_created_idx" RENAME TO "enrichment_tool_runs_user_created_idx";--> statement-breakpoint
ALTER INDEX "profile_tool_runs_status_created_idx" RENAME TO "enrichment_tool_runs_status_created_idx";--> statement-breakpoint
ALTER INDEX "profile_tool_runs_operation_created_idx" RENAME TO "enrichment_tool_runs_operation_created_idx";--> statement-breakpoint
ALTER INDEX "profile_tool_runs_expires_at_idx" RENAME TO "enrichment_tool_runs_expires_at_idx";
--> statement-breakpoint
ALTER TABLE "enrichment_tool_runs" RENAME CONSTRAINT "profile_tool_runs_user_id_users_id_fk" TO "enrichment_tool_runs_user_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "enrichment_tool_runs" RENAME CONSTRAINT "profile_tool_runs_agent_id_agents_id_fk" TO "enrichment_tool_runs_agent_id_agents_id_fk";
