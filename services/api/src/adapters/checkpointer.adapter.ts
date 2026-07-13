/**
 * PostgresSaver Checkpointer Adapter
 *
 * Provides singleton and factory methods for creating PostgresSaver checkpointer instances.
 * The checkpointer enables conversation persistence across requests using LangGraph's
 * built-in checkpoint tables.
 *
 * USAGE:
 * - Use `getCheckpointer()` for production (singleton pattern, reuses connection)
 * - Use `createCheckpointer()` for testing or isolation scenarios
 *
 * CONTEXT:
 * - PostgresSaver creates its own tables (checkpoint, checkpoint_writes, checkpoint_metadata)
 * - These are separate from our chat_sessions/chat_messages tables
 * - The checkpointer tables store graph state snapshots for multi-turn conversations
 */

import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { sql } from "drizzle-orm";

import db from "../lib/drizzle/drizzle";
import { log } from "../lib/log";

const logger = log.lib.from("checkpointer.adapter");

let checkpointerInstance: PostgresSaver | null = null;
let setupPromise: Promise<void> | null = null;

/**
 * Get or create a PostgresSaver checkpointer instance.
 * Uses the same database connection as the main application (process.env.DATABASE_URL).
 *
 * This is a singleton that ensures:
 * 1. Only one checkpointer instance exists per process
 * 2. Setup is called exactly once
 * 3. Subsequent calls return the cached instance
 *
 * @returns Promise<PostgresSaver> - The initialized checkpointer
 * @throws Error if DATABASE_URL is not configured
 */
export async function getCheckpointer(): Promise<PostgresSaver> {
  if (checkpointerInstance) {
    // Ensure setup has completed before returning
    if (setupPromise) {
      await setupPromise;
    }
    return checkpointerInstance;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "[getCheckpointer] DATABASE_URL environment variable is required"
    );
  }

  logger.verbose("Initializing shared PostgresSaver checkpointer");

  // Create checkpointer from connection string
  checkpointerInstance = PostgresSaver.fromConnString(connectionString);

  // Setup creates required tables if they don't exist
  // Store the promise so concurrent calls can await it
  setupPromise = checkpointerInstance.setup().then(() => {
    logger.verbose("Shared PostgresSaver setup complete");
  }).catch((error) => {
    logger.error("Shared PostgresSaver setup failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    // Reset instance on failure so next call retries
    checkpointerInstance = null;
    setupPromise = null;
    throw error;
  });

  await setupPromise;
  return checkpointerInstance;
}

/**
 * Create a fresh checkpointer instance for testing or isolation purposes.
 * Each call creates a new instance with its own connection.
 *
 * NOTE: This does NOT use the singleton pattern - each call creates a new instance.
 * Use this when you need:
 * - Isolated test environments
 * - Custom connection strings
 * - Separate checkpointer lifecycles
 *
 * @param connectionString - Optional custom connection string (defaults to DATABASE_URL)
 * @returns Promise<PostgresSaver> - A new initialized checkpointer
 * @throws Error if no connection string is available
 */
export async function createCheckpointer(
  connectionString?: string
): Promise<PostgresSaver> {
  const connStr = connectionString || process.env.DATABASE_URL;
  if (!connStr) {
    throw new Error(
      "[createCheckpointer] Connection string is required (either pass directly or set DATABASE_URL)"
    );
  }

  logger.verbose("Creating new PostgresSaver instance");

  const checkpointer = PostgresSaver.fromConnString(connStr);
  await checkpointer.setup();
  logger.verbose("New PostgresSaver instance setup complete");
  return checkpointer;
}

/**
 * Reset the singleton checkpointer instance.
 * Useful for testing or when connection needs to be re-established.
 *
 * WARNING: This does NOT close the underlying connection pool.
 * Use with caution in production.
 */
export function resetCheckpointer(): void {
  logger.verbose("Resetting checkpointer instance");
  checkpointerInstance = null;
  setupPromise = null;
}

/** Row counts removed by a single {@link pruneStaleCheckpointThreads} batch. */
export interface CheckpointPruneResult {
  /** Distinct thread_ids removed in this batch. */
  threads: number;
  /** Rows deleted from `checkpoints`. */
  checkpoints: number;
  /** Rows deleted from `checkpoint_blobs`. */
  blobs: number;
  /** Rows deleted from `checkpoint_writes`. */
  writes: number;
}

const EMPTY_PRUNE_RESULT: CheckpointPruneResult = Object.freeze({
  threads: 0,
  checkpoints: 0,
  blobs: 0,
  writes: 0,
});

/** postgres.js result lists carry the affected-row count on `.count`. */
function affectedRows(result: unknown): number {
  const count = (result as { count?: unknown })?.count;
  return typeof count === "number" ? count : 0;
}

/**
 * Delete one batch of stale LangGraph checkpoint threads.
 *
 * A thread is stale when its NEWEST checkpoint is older than `retentionDays`.
 * Chat threads use a per-run composite thread_id (`sessionId:runId`), so a
 * thread whose latest checkpoint has aged out can never be resumed again —
 * conversation continuity is rebuilt from `chat_messages`, not checkpoints.
 *
 * Deletes rows from `checkpoints`, `checkpoint_blobs`, and `checkpoint_writes`
 * inside a single transaction. Call repeatedly (until `threads < batchSize`)
 * to drain a large backlog incrementally.
 *
 * @param opts.retentionDays - Age threshold in whole days (must be >= 1)
 * @param opts.batchSize - Max threads to delete per call (must be >= 1)
 * @returns Row counts removed in this batch
 */
export async function pruneStaleCheckpointThreads(opts: {
  retentionDays: number;
  batchSize: number;
}): Promise<CheckpointPruneResult> {
  const retentionDays = Math.max(1, Math.floor(opts.retentionDays));
  const batchSize = Math.max(1, Math.floor(opts.batchSize));

  const stale = await db.execute<{ thread_id: string }>(sql`
    SELECT thread_id
    FROM checkpoints
    GROUP BY thread_id
    HAVING max((checkpoint->>'ts')::timestamptz) < now() - make_interval(days => ${retentionDays})
    LIMIT ${batchSize}
  `);
  const threadIds = Array.from(stale, (row) => row.thread_id);
  if (threadIds.length === 0) {
    return EMPTY_PRUNE_RESULT;
  }

  // drizzle expands a JS array in a template into a row constructor `($1, $2)`,
  // not a PG array — build an explicit IN list instead.
  const idList = sql.join(threadIds.map((id) => sql`${id}`), sql`, `);

  return db.transaction(async (tx) => {
    const writes = affectedRows(
      await tx.execute(sql`DELETE FROM checkpoint_writes WHERE thread_id IN (${idList})`),
    );
    const blobs = affectedRows(
      await tx.execute(sql`DELETE FROM checkpoint_blobs WHERE thread_id IN (${idList})`),
    );
    const checkpoints = affectedRows(
      await tx.execute(sql`DELETE FROM checkpoints WHERE thread_id IN (${idList})`),
    );
    return { threads: threadIds.length, checkpoints, blobs, writes };
  });
}
