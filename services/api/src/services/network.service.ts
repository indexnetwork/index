import { and, eq, isNull, sql } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { generateMasterKey } from '../lib/experiment/master-key';
import { executeSendEmail } from '../lib/email/transport.helper';
import { networkMasterKeyRotatedTemplate } from '../lib/email/templates/network-master-key-rotated.template';
import * as schema from '../schemas/database.schema';
import { ContextInjectionSchema, validateNetworkMetadata } from '../schemas/network.validation';

const logger = log.service.from("NetworkService");

/**
 * NetworkService
 *
 * Manages index/community operations.
 * Uses ChatDatabaseAdapter for database operations.
 *
 * RESPONSIBILITIES:
 * - List networks for users
 * - Get single index details
 * - Manage network memberships
 */
export class NetworkService {
  constructor(private adapter = new ChatDatabaseAdapter()) {}

  /**
   * Get all networks that a user is a member of.
   */
  async getNetworksForUser(userId: string) {
    logger.verbose('Getting networks for user', { userId });
    return this.adapter.getNetworksForUser(userId);
  }

  /**
   * Create a new index with the requesting user as owner.
   */
  async createNetwork(userId: string, data: { title: string; prompt?: string; imageUrl?: string | null; joinPolicy?: 'anyone' | 'invite_only'; metadata?: Record<string, unknown> }) {
    const validatedMetadata = validateNetworkMetadata(data.metadata ?? {});
    logger.verbose('Creating index', { userId, title: data.title });
    const index = await this.adapter.createNetwork({
      ...data,
      metadata: validatedMetadata,
    });
    // Add the creating user as the owner
    await this.adapter.addMemberToNetwork(index.id, userId, 'owner');
    // Fetch the full index details with user and member count
    const fullIndex = await this.adapter.getNetworkDetail(index.id, userId);
    if (!fullIndex) {
      throw new Error('Failed to create network');
    }
    return fullIndex;
  }

  /**
   * Enable master-key signup on any network. Owner-only. Generates a master
   * key, stores only its hash, and forces joinPolicy: 'invite_only' so
   * key-provisioned networks are not openly joinable. The forcing is not a
   * lock — owners can change the permissions afterwards. The plaintext is
   * returned exactly once.
   */
  async enableMasterKey(networkId: string, userId: string): Promise<{ masterKey: string }> {
    const isOwner = await this.adapter.isIndexOwner(networkId, userId);
    if (!isOwner) throw new Error('Owner-only operation');

    const { key: masterKey, hash: masterKeyHash } = await generateMasterKey();
    const [existing] = await db
      .select({ permissions: schema.networks.permissions })
      .from(schema.networks)
      .where(eq(schema.networks.id, networkId))
      .limit(1);
    if (!existing) throw new Error('Network not found');

    const permissions: schema.NetworkPermissionsState = {
      ...(existing.permissions as schema.NetworkPermissionsState),
      joinPolicy: 'invite_only',
    };
    await db
      .update(schema.networks)
      .set({
        masterKeyHash,
        permissions,
      })
      .where(eq(schema.networks.id, networkId));

    return { masterKey };
  }

  /**
   * Get a public network by ID (no auth required). Returns null if not public.
   */
  async getPublicNetworkById(networkId: string) {
    logger.verbose('Getting public network by id', { networkId });
    return this.adapter.getPublicIndexDetail(networkId);
  }

  /**
   * Get a single network by ID with owner info and member count.
   * Only members of the index can view it.
   */
  async getNetworkById(networkId: string, userId: string) {
    logger.verbose('Getting index by id', { networkId });
    return this.adapter.getNetworkDetail(networkId, userId);
  }

  /**
   * Update index settings (title, prompt, permissions). Owner-only.
   */
  async updateNetwork(networkId: string, userId: string, data: { title?: string; prompt?: string | null; imageUrl?: string | null; joinPolicy?: 'anyone' | 'invite_only'; metadata?: Record<string, unknown>; contextInjection?: { discovery: boolean } }) {
    logger.verbose('Updating index', { networkId, userId });
    const validatedMetadata = data.metadata !== undefined
      ? validateNetworkMetadata(data.metadata)
      : undefined;
    const validatedContextInjection = data.contextInjection !== undefined
      ? ContextInjectionSchema.parse(data.contextInjection)
      : undefined;
    return this.adapter.updateIndexSettings(networkId, userId, { ...data, metadata: validatedMetadata, contextInjection: validatedContextInjection });
  }

  /**
   * Update index permissions. Owner-only.
   */
  async updatePermissions(networkId: string, userId: string, data: { joinPolicy?: 'anyone' | 'invite_only'; contextInjection?: { discovery: boolean } }) {
    const validatedContextInjection = data.contextInjection !== undefined
      ? ContextInjectionSchema.parse(data.contextInjection)
      : undefined;
    logger.verbose('Updating permissions', { networkId, userId });
    return this.adapter.updateIndexSettings(networkId, userId, {
      ...data,
      contextInjection: validatedContextInjection,
    });
  }

  /**
   * Rotate a network's invitation link, issuing a fresh code. Owner-only.
   * Works regardless of join policy; previously shared links stop resolving.
   * @param networkId - The network whose invitation link should be rotated
   * @param userId - The caller; must be an owner of the network
   * @returns The updated network with the new invitation code
   * @throws Error if the network is personal or the caller is not an owner
   */
  async regenerateInvitationLink(networkId: string, userId: string) {
    logger.verbose('Regenerating invitation link', { networkId, userId });
    return this.adapter.regenerateInvitationLink(networkId, userId);
  }

  /**
   * Add a member to an index. Owner-only.
   */
  async addMember(networkId: string, userId: string, requestingUserId: string, role: 'owner' | 'member' = 'member') {
    logger.verbose('Adding member', { networkId, userId, role });
    return this.adapter.addMemberForOwner(networkId, userId, requestingUserId, role);
  }

  /**
   * Update a member's role (owner ↔ member). Owner-only.
   * @throws Error if the index is personal, member not found, or last owner.
   */
  async updateMemberRole(networkId: string, targetUserId: string, requestingUserId: string, role: 'owner' | 'member') {
    logger.verbose('Updating member role', { networkId, targetUserId, role });
    return this.adapter.updateMemberRole(networkId, targetUserId, requestingUserId, role);
  }

  /**
   * Remove a member from an index. Owner-only.
   */
  async removeMember(networkId: string, memberId: string, userId: string) {
    logger.verbose('Removing member', { networkId, memberId, userId });
    return this.adapter.removeMemberForOwner(networkId, memberId, userId);
  }

  /**
   * Soft-delete a network. Owner-only. Runs the ordinary owner delete first
   * (membership checks + network soft-delete, byte-identical to the
   * pre-cascade path), then cascades to any provisioned cohort: only users
   * provisioned via master-key signup / CSV import own network-scoped
   * agents, so the cascade no-ops on ordinary networks. The cohort lookup
   * keys off agents/agent_permissions, not network_members, so it still
   * resolves after the network is soft-deleted.
   */
  async deleteNetwork(networkId: string, userId: string) {
    logger.verbose('Deleting index', { networkId, userId });

    const isOwner = await this.adapter.isIndexOwner(networkId, userId);
    if (!isOwner) throw new Error('Access denied: Not an owner of this network');
    await this.adapter.deleteIndexForOwner(networkId, userId);
    await this.adapter.softDeleteProvisionedCohort(networkId);
  }

  /**
   * Get members of an index. Only owners can call this.
   */
  async getMembersForOwner(networkId: string, userId: string) {
    logger.verbose('Getting members for owner', { networkId, userId });
    const raw = await this.adapter.getNetworkMembersForOwner(networkId, userId);
    return raw.map(m => ({
      id: m.userId,
      name: m.name,
      intro: m.intro,
      email: m.email,
      avatar: m.avatar,
      permissions: m.permissions,
      createdAt: m.joinedAt,
    }));
  }

  /**
   * Get all members from every network the signed-in user is a member of (deduplicated).
   * Used for mentionable users / @mentions.
   */
  async getMembersFromMyNetworks(userId: string) {
    logger.verbose('Getting members from user indexes', { userId });
    const raw = await this.adapter.getMembersFromUserIndexes(userId);
    return raw.map(m => ({
      id: m.userId,
      name: m.name,
      avatar: m.avatar,
    }));
  }

  /**
   * Get networks shared between the current user and a target user.
   * @param currentUserId - Authenticated user ID.
   * @param targetUserId - Profile user ID to compare memberships with.
   * @returns Shared networks with member counts.
   */
  async getSharedNetworks(currentUserId: string, targetUserId: string) {
    logger.verbose('Getting shared networks', { currentUserId, targetUserId });
    return this.adapter.getSharedNetworks(currentUserId, targetUserId);
  }

  /**
   * Get public networks that the user has not joined (for discovery).
   */
  async getPublicNetworks(userId: string) {
    logger.verbose('Getting public networks for user', { userId });
    return this.adapter.getPublicIndexesNotJoined(userId);
  }

  /**
   * Get an index by its invitation share code (public, no auth required).
   * @param code - The invitation share code from the URL
   * @returns The index with owner info and member count, or null if not found
   */
  async getNetworkByShareCode(code: string) {
    logger.verbose('Getting index by share code');
    return this.adapter.getNetworkByShareCode(code);
  }

  /**
   * Accept an invitation to join an index using the invitation code.
   * @param code - The invitation share code
   * @param userId - The authenticated user accepting the invitation
   * @returns The index, membership info, and whether user was already a member
   * @throws Error if the invitation code is invalid or the index is not found
   */
  async acceptInvitation(code: string, userId: string) {
    logger.verbose('Accepting invitation', { userId });
    return this.adapter.acceptIndexInvitation(code, userId);
  }

  /**
   * Join a public network.
   */
  async joinPublicNetwork(networkId: string, userId: string) {
    logger.verbose('Joining public network', { networkId, userId });
    await this.adapter.joinPublicNetwork(networkId, userId);
    return this.adapter.getNetworkDetail(networkId, userId);
  }

  /**
   * Leave an index. Members (non-owners) can leave.
   */
  async leaveNetwork(networkId: string, userId: string) {
    logger.verbose('Leaving index', { networkId, userId });
    await this.adapter.leaveNetwork(networkId, userId);
  }

  /**
   * Get current user's member settings (permissions and ownership status).
   */
  async getMemberSettings(networkId: string, userId: string) {
    logger.verbose('Getting member settings', { networkId, userId });
    const settings = await this.adapter.getMemberSettings(networkId, userId);
    if (!settings) {
      throw new Error('Not a member of this network');
    }
    return settings;
  }

  /**
   * Compose the /networks overview payload for the current member: their intents
   * in the network, their ACTIVE premises assigned to it, and their per-network
   * user_context. Members only: membership is asserted up front so the three
   * (all current-user scoped) reads never run for a non-member. Intents go
   * through the honest, uncapped getNetworkIntentsForMemberOwn so they stay
   * consistent with the premise count beside them. See EDG-53.
   */
  async getNetworkOverview(networkId: string, userId: string) {
    logger.verbose('Getting network overview', { networkId, userId });
    const isMember = await this.adapter.isNetworkMember(networkId, userId);
    if (!isMember) {
      throw new Error('Access denied: Not a member of this network');
    }
    const [intents, premises, userContext] = await Promise.all([
      this.adapter.getNetworkIntentsForMemberOwn(networkId, userId),
      this.adapter.getNetworkPremisesForMember(networkId, userId),
      this.adapter.getUserContext(userId, networkId),
    ]);
    return {
      intents,
      premises,
      userContext: userContext ? { text: userContext.text, generatedAt: userContext.generatedAt } : null,
    };
  }

  /**
   * Resolve an network identifier (UUID or key) to a UUID.
   * @param idOrKey - UUID or human-readable key
   * @returns The network UUID, or null if not found
   */
  async resolveIndexId(idOrKey: string): Promise<string | null> {
    logger.verbose('Resolving network ID or key', { idOrKey });
    return this.adapter.resolveIndexId(idOrKey);
  }

  /**
   * Check whether a user holds the `'owner'` permission on a network.
   * Delegates to the adapter's permission-based check (network_members.permissions).
   *
   * @param networkId - The network ID
   * @param userId - The user ID to check
   * @returns `true` if the user is an owner, `false` otherwise
   */
  async isIndexOwner(networkId: string, userId: string): Promise<boolean> {
    return this.adapter.isIndexOwner(networkId, userId);
  }

  /**
   * Rotate the master key on a network. The plaintext is returned exactly
   * once and never persisted; the hash replaces the existing
   * `master_key_hash`. Every owner of the network receives an email with the
   * new key.
   *
   * @param networkId - The network ID
   * @param userId - The requesting user ID (must be an owner)
   * @returns The new plaintext master key (shown once; only the hash is stored)
   * @throws Error('Network has no master key') when the target is missing,
   *         deleted, or has no existing hash.
   * @throws Error('Owner-only operation') when the caller is not an owner.
   */
  async rotateMasterKey(networkId: string, userId: string): Promise<{ masterKey: string }> {
    logger.verbose('Rotating master key', { networkId, userId });

    const [network] = await db
      .select({
        id: schema.networks.id,
        title: schema.networks.title,
        masterKeyHash: schema.networks.masterKeyHash,
        deletedAt: schema.networks.deletedAt,
      })
      .from(schema.networks)
      .where(eq(schema.networks.id, networkId))
      .limit(1);

    if (!network || network.deletedAt || !network.masterKeyHash) {
      throw new Error('Network has no master key');
    }

    const isOwner = await this.adapter.isIndexOwner(networkId, userId);
    if (!isOwner) {
      throw new Error('Owner-only operation');
    }

    const { key, hash } = await generateMasterKey();
    await db.update(schema.networks)
      .set({ masterKeyHash: hash })
      .where(eq(schema.networks.id, networkId));

    // Pre-fetch owners synchronously so the fire-and-forget path only does fast
    // email sends and never blocks on a DB round-trip after the key is committed.
    const owners = await db
      .select({
        userId: schema.users.id,
        email: schema.users.email,
        name: schema.users.name,
      })
      .from(schema.networkMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.networkMembers.userId))
      .where(and(
        eq(schema.networkMembers.networkId, networkId),
        sql`'owner' = ANY(${schema.networkMembers.permissions})`,
        isNull(schema.networkMembers.deletedAt),
        isNull(schema.users.deletedAt),
      ));

    // Dispatch emails fire-and-forget — rotation has already committed.
    this.dispatchRotationEmails(network.id, network.title, userId, key, owners)
      .catch((err) => logger.error('Rotation email dispatch failed', { networkId, error: err }));

    return { masterKey: key };
  }

  /**
   * Email every owner of the network the new plaintext key.
   * Fire-and-forget; per-recipient errors are swallowed so one bad address
   * cannot block delivery to the others.
   *
   * @param networkId - The network whose owners to notify
   * @param networkName - The human-readable network title for the email body
   * @param actorUserId - The user who initiated the rotation (used for display name)
   * @param newKey - The new plaintext master key to include in the email
   * @param owners - Pre-fetched owner records (userId, email, name)
   */
  private async dispatchRotationEmails(
    networkId: string,
    networkName: string,
    actorUserId: string,
    newKey: string,
    owners: Array<{ userId: string; email: string; name: string | null }>,
  ): Promise<void> {
    if (owners.length === 0) return;

    const actor = owners.find((o) => o.userId === actorUserId);
    const actorDisplay = actor?.name || actor?.email || 'an owner';
    const frontendUrl = (process.env.WEB_APP_URL || 'https://index.network').replace(/\/+$/, '');
    const integrationsUrl = `${frontendUrl}/networks/${networkId}/integrations`;

    const rendered = networkMasterKeyRotatedTemplate({
      networkName,
      actorDisplay,
      newKey,
      integrationsUrl,
    });

    await Promise.all(owners.map(async (o) => {
      try {
        await executeSendEmail({
          to: o.email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
        });
      } catch (err) {
        logger.error('Rotation email failed for owner', { to: o.email, error: err });
      }
    }));
  }
}

export const networkService = new NetworkService();
