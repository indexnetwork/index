-- Remove daily frame-drift monitoring. The job measured per-network embedding
-- centroids and a cross-network opportunity-yield proxy, then only logged them:
-- no API, UI, or service ever read these tables. Its premise corpus also went
-- away with `premises` in 0160.

DROP TABLE IF EXISTS "cross_network_yield_snapshots";
--> statement-breakpoint
DROP TABLE IF EXISTS "frame_centroid_snapshots";
--> statement-breakpoint
DROP TABLE IF EXISTS "frame_drift_observation_runs";
--> statement-breakpoint
DROP TABLE IF EXISTS "frame_drift_execution_attempts";
