-- Simple migration to add vector embeddings (no indexing)
-- This avoids the dimension limits and works with exact search

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to intents table (3072 dimensions)
ALTER TABLE "intents" ADD COLUMN IF NOT EXISTS "embedding" vector(3072);

-- Optional: Add a comment to document the column
COMMENT ON COLUMN "intents"."embedding" IS 'OpenAI text-embedding-3-large vector (3072 dimensions) for semantic search';

-- Check that the column was added successfully
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'intents' AND column_name = 'embedding';
