ALTER TABLE "agents" ADD COLUMN "description" text NOT NULL;--> statement-breakpoint

ALTER TABLE "indexes" ADD COLUMN "is_discoverable" boolean DEFAULT false NOT NULL; 

-- Add link permissions column to indexes table  
ALTER TABLE "indexes" ADD COLUMN "link_permissions" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint

-- Add permissions column to index_members table
ALTER TABLE "index_members" ADD COLUMN "permissions" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- Create composite primary key for index_members to prevent duplicate entries
ALTER TABLE "index_members" ADD CONSTRAINT "index_members_pkey" PRIMARY KEY ("index_id", "user_id");

-- Add created_at and updated_at to index_members for better tracking
ALTER TABLE "index_members" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;
ALTER TABLE "index_members" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL; 




