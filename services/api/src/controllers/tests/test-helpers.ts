/**
 * Shared teardown helpers for controller integration specs.
 *
 * Replaces the removed NetworkGraphDatabaseAdapter, which only survived
 * because specs used it to hard-delete networks during cleanup.
 */
import { db, eq, intentNetworks, networkMembers, networks } from '../../adapters/database.shared';

/**
 * Hard-delete a network together with its intent-network assignments and
 * member rows (test teardown only — bypasses soft deletes and events).
 *
 * @param networkId - The network to remove.
 */
export async function deleteNetworkAndMembers(networkId: string): Promise<void> {
  await db.delete(intentNetworks).where(eq(intentNetworks.networkId, networkId));
  await db.delete(networkMembers).where(eq(networkMembers.networkId, networkId));
  await db.delete(networks).where(eq(networks.id, networkId));
}
