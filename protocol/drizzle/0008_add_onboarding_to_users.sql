-- Add onboarding JSONB column to users table
ALTER TABLE users ADD COLUMN onboarding JSONB DEFAULT '{}'::jsonb;

