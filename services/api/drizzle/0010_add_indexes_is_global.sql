ALTER TABLE "indexes" ADD COLUMN "is_global" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "indexes_is_global_unique" ON "indexes" USING btree ("is_global") WHERE is_global = true;
