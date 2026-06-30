import { upsertIntentNetworkAssignment, and, db, eq, intentNetworks, intents, isNull, networkMembers, networks } from './database.shared';

export class NetworkGraphDatabaseAdapter {
  async getIntentForIndexing(intentId: string) {
    const rows = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        userId: intents.userId,
        sourceType: intents.sourceType,
        sourceId: intents.sourceId,
      })
      .from(intents)
      .where(eq(intents.id, intentId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getNetworkMemberContext(networkId: string, userId: string) {
    const rows = await db
      .select({
        networkId: networks.id,
        indexPrompt: networks.prompt,
        memberPrompt: networkMembers.prompt,
      })
      .from(networks)
      .innerJoin(networkMembers, eq(networks.id, networkMembers.networkId))
      .where(
        and(
          eq(networks.id, networkId),
          eq(networkMembers.userId, userId),
          eq(networkMembers.autoAssign, true),
          isNull(networks.deletedAt)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async getNetworkAssignmentContext(networkId: string, userId: string) {
    const rows = await db
      .select({
        networkId: networks.id,
        indexPrompt: networks.prompt,
        memberPrompt: networkMembers.prompt,
      })
      .from(networks)
      .innerJoin(networkMembers, eq(networks.id, networkMembers.networkId))
      .where(
        and(
          eq(networks.id, networkId),
          eq(networkMembers.userId, userId),
          isNull(networkMembers.deletedAt),
          isNull(networks.deletedAt)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async isIntentAssignedToIndex(intentId: string, networkId: string): Promise<boolean> {
    const rows = await db
      .select({ networkId: intentNetworks.networkId })
      .from(intentNetworks)
      .where(
        and(
          eq(intentNetworks.intentId, intentId),
          eq(intentNetworks.networkId, networkId)
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  async assignIntentToNetwork(
    intentId: string,
    networkId: string,
    relevancyScore?: number,
    assignmentMetadata?: import('@indexnetwork/protocol').NetworkAssignmentMetadata,
  ): Promise<void> {
    return upsertIntentNetworkAssignment(intentId, networkId, relevancyScore, assignmentMetadata);
  }

  async unassignIntentFromIndex(intentId: string, networkId: string): Promise<void> {
    await db
      .delete(intentNetworks)
      .where(
        and(
          eq(intentNetworks.intentId, intentId),
          eq(intentNetworks.networkId, networkId)
        )
      );
  }

  async getNetworkIdsForIntent(intentId: string): Promise<string[]> {
    const rows = await db
      .select({ networkId: intentNetworks.networkId })
      .from(intentNetworks)
      .where(eq(intentNetworks.intentId, intentId));
    return rows.map((r) => r.networkId);
  }

  /**
   * Delete only index_members for an index (releases user FK for teardown).
   */
  async deleteMembersForNetwork(networkId: string): Promise<void> {
    await db.delete(networkMembers).where(eq(networkMembers.networkId, networkId));
  }

  /**
   * Delete a network and its members/intent-network links (for test teardown).
   */
  async deleteNetworkAndMembers(networkId: string): Promise<void> {
    await db.delete(intentNetworks).where(eq(intentNetworks.networkId, networkId));
    await db.delete(networkMembers).where(eq(networkMembers.networkId, networkId));
    await db.delete(networks).where(eq(networks.id, networkId));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HyDE Document Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

/** Input shape for saving a HyDE document (matches CreateHydeDocumentData). */
