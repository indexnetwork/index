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

  logger.verbose("[getCheckpointer] Initializing PostgresSaver checkpointer");

  // Create checkpointer from connection string
  checkpointerInstance = PostgresSaver.fromConnString(connectionString);

  // Setup creates required tables if they don't exist
  // Store the promise so concurrent calls can await it
  setupPromise = checkpointerInstance.setup().then(() => {
    logger.verbose("[getCheckpointer] PostgresSaver setup complete");
  }).catch((error) => {
    logger.error("[getCheckpointer] PostgresSaver setup failed", {
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

  logger.verbose("[createCheckpointer] Creating new PostgresSaver instance");

  const checkpointer = PostgresSaver.fromConnString(connStr);
  await checkpointer.setup();
  logger.verbose("[createCheckpointer] PostgresSaver setup complete");
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
  logger.verbose("[resetCheckpointer] Resetting checkpointer instance");
  checkpointerInstance = null;
  setupPromise = null;
}
