-- Add config column to integrations table for directory sync and other integration-specific configuration
ALTER TABLE "integrations" ADD COLUMN "config" jsonb;

