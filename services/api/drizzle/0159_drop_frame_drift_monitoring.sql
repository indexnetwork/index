-- Recycle unused daily frame-drift observation. No API, UI, or product
-- consumer read these tables. Snapshot rows are capture-time measurements,
-- not reconstructed history; drop them with the writer.
DROP TABLE IF EXISTS "frame_centroid_snapshots";
DROP TABLE IF EXISTS "cross_network_yield_snapshots";
DROP TABLE IF EXISTS "frame_drift_observation_runs";
DROP TABLE IF EXISTS "frame_drift_execution_attempts";
