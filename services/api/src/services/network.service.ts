import { log } from '../lib/log';
import { getNetworkPulseSummary, SUMMARY_MIN_MEMBERS } from '../lib/network-pulse-summary';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { ContextInjectionSchema, validateNetworkMetadata } from '../schemas/network.validation';

const logger = log.service.from("NetworkService");

/**
 * Every open invite page polls its counts every few seconds. Viewers of one
 * invite link share a result this fresh, and a single query while one is running.
 * Keyed by share code, so a rotated code stops being served within the TTL.
 */
const SHARE_PULSE_TTL_MS = 2_500;
type SharePulse = Awaited<ReturnType<ChatDatabaseAdapter['getNetworkShareCounts']>> | null;
const sharePulseCache = new Map<string, { at: number; value: Promise<SharePulse> }>();

/**
 * NetworkService
 *
 * Manages network/community operations.
 * Uses ChatDatabaseAdapter for database operations.
 *
 * RESPONSIBILITIES:
 * - List networks for users
 * - Get single network details
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
   * Create a new network with the requesting user as owner.
   */
  async createNetwork(userId: string, data: { title: string; prompt?: string; imageUrl?: string | null; joinPolicy?: 'anyone' | 'invite_only'; metadata?: Record<string, unknown> }) {
    const validatedMetadata = validateNetworkMetadata(data.metadata ?? {});
    logger.verbose('Creating network', { userId, title: data.title });
    const index = await this.adapter.createNetwork({
      ...data,
      metadata: validatedMetadata,
    });
    // Add the creating user as the owner
    await this.adapter.addMemberToNetwork(index.id, userId, 'owner');
    // Fetch the full network details with user and member count
    const fullNetwork = await this.adapter.getNetworkDetail(index.id, userId);
    if (!fullNetwork) {
      throw new Error('Failed to create network');
    }
    return fullNetwork;
  }

  /**
   * Get a public network by ID (no auth required). Returns null if not public.
   */
  async getPublicNetworkById(networkId: string) {
    logger.verbose('Getting public network by id', { networkId });
    return this.adapter.getPublicNetworkDetail(networkId);
  }

  /**
   * Get a single network by ID with owner info and member count.
   * Only members of the network can view it.
   */
  async getNetworkById(networkId: string, userId: string) {
    logger.verbose('Getting network by id', { networkId });
    return this.adapter.getNetworkDetail(networkId, userId);
  }

  /**
   * Update network settings (title, prompt, permissions). Owner-only.
   */
  async updateNetwork(networkId: string, userId: string, data: { title?: string; prompt?: string | null; imageUrl?: string | null; joinPolicy?: 'anyone' | 'invite_only'; metadata?: Record<string, unknown>; contextInjection?: { discovery: boolean } }) {
    logger.verbose('Updating network', { networkId, userId });
    const validatedMetadata = data.metadata !== undefined
      ? validateNetworkMetadata(data.metadata)
      : undefined;
    const validatedContextInjection = data.contextInjection !== undefined
      ? ContextInjectionSchema.parse(data.contextInjection)
      : undefined;
    return this.adapter.updateNetworkSettings(networkId, userId, { ...data, metadata: validatedMetadata, contextInjection: validatedContextInjection });
  }

  /**
   * Update network permissions. Owner-only.
   */
  async updatePermissions(networkId: string, userId: string, data: { joinPolicy?: 'anyone' | 'invite_only'; requireAdminApproval?: boolean; contextInjection?: { discovery: boolean } }) {
    const validatedContextInjection = data.contextInjection !== undefined
      ? ContextInjectionSchema.parse(data.contextInjection)
      : undefined;
    logger.verbose('Updating permissions', { networkId, userId });
    return this.adapter.updateNetworkSettings(networkId, userId, {
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
   * Add a member to a network. Owner-only.
   */
  async addMember(networkId: string, userId: string, requestingUserId: string, role: 'owner' | 'member' = 'member') {
    logger.verbose('Adding member', { networkId, userId, role });
    return this.adapter.addMemberForOwner(networkId, userId, requestingUserId, role);
  }

  /**
   * Update a member's role (owner ↔ member). Owner-only.
   * @throws Error if the network is personal, member not found, or last owner.
   */
  async updateMemberRole(networkId: string, targetUserId: string, requestingUserId: string, role: 'owner' | 'member') {
    logger.verbose('Updating member role', { networkId, targetUserId, role });
    return this.adapter.updateMemberRole(networkId, targetUserId, requestingUserId, role);
  }

  /**
   * Remove a member from a network. Owner-only.
   */
  async removeMember(networkId: string, memberId: string, userId: string) {
    logger.verbose('Removing member', { networkId, memberId, userId });
    return this.adapter.removeMemberForOwner(networkId, memberId, userId);
  }

  /**
   * Soft-delete a network. Owner-only.
   */
  async deleteNetwork(networkId: string, userId: string) {
    logger.verbose('Deleting network', { networkId, userId });

    const isOwner = await this.adapter.isNetworkOwner(networkId, userId);
    if (!isOwner) throw new Error('Access denied: Not an owner of this network');
    await this.adapter.deleteNetworkForOwner(networkId, userId);
  }

  /**
   * Get the roster of a network. Any current member can call this; emails are
   * only ever the caller's own.
   */
  async getMembers(networkId: string, userId: string) {
    logger.verbose('Getting members for member', { networkId, userId });
    const raw = await this.adapter.getNetworkMembersForMember(networkId, userId);
    return raw.map(m => ({
      id: m.userId,
      name: m.name,
      email: m.email,
      avatar: m.avatar,
      emailVerified: m.emailVerified,
      permissions: m.permissions,
      createdAt: m.joinedAt,
    }));
  }

  /**
   * List the active intents shared in a network, across all members. Any
   * current member can call this; the adapter refuses non-members.
   */
  async getNetworkIntents(networkId: string, userId: string, options: { page: number; limit: number }) {
    logger.verbose('Getting network intents', { networkId, userId, ...options });
    return this.adapter.getNetworkIntentsForMember(networkId, userId, {
      limit: options.limit,
      offset: (options.page - 1) * options.limit,
    });
  }

  /**
   * Get all members from every network the signed-in user is a member of (deduplicated).
   * Used for mentionable users / @mentions.
   */
  async getMembersFromMyNetworks(userId: string) {
    logger.verbose('Getting members from user networks', { userId });
    const raw = await this.adapter.getMembersFromUserNetworks(userId);
    return raw.map(m => ({
      id: m.userId,
      name: m.name,
      avatar: m.avatar,
    }));
  }

  /**
   * Search people the user shares a network with, for the add-member box.
   * @param excludeNetworkId - Leave out people already in this network.
   */
  async searchUsers(userId: string, q: string, excludeNetworkId?: string) {
    return this.adapter.searchUsersInUserNetworks(userId, q, excludeNetworkId);
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
    return this.adapter.getPublicNetworksNotJoined(userId);
  }

  /**
   * Get a network by its invitation share code (public, no auth required).
   * @param code - The invitation share code from the URL
   * @returns The network with owner info and member count, or null if not found.
   *   Counts and the written summary are separate requests so this one stays fast.
   */
  async getNetworkByShareCode(code: string) {
    logger.verbose('Getting network by share code');
    return this.adapter.getNetworkByShareCode(code);
  }

  /**
   * Counts for the invite page. Separate from the network lookup so the page
   * can render before these scans finish.
   */
  async getNetworkSharePulse(code: string) {
    const cached = sharePulseCache.get(code);
    if (cached && Date.now() - cached.at < SHARE_PULSE_TTL_MS) return cached.value;
    const value = this.adapter.getNetworkByShareCode(code)
      .then((network) => (network ? this.adapter.getNetworkShareCounts(network.id) : null));
    sharePulseCache.set(code, { at: Date.now(), value });
    // A failed scan must not be served to the next viewer.
    value.catch(() => {
      if (sharePulseCache.get(code)?.value === value) sharePulseCache.delete(code);
    });
    for (const [key, entry] of sharePulseCache) {
      if (Date.now() - entry.at >= SHARE_PULSE_TTL_MS) sharePulseCache.delete(key);
    }
    return value;
  }


  /**
   * The aggregate "what people are looking for" line. A cache miss waits on
   * the model, so the page asks for this after it has already rendered.
   */
  async getNetworkShareSummary(code: string) {
    const network = await this.adapter.getNetworkByShareCode(code);
    if (!network) return null;
    if (network._count.members < SUMMARY_MIN_MEMBERS) return { summary: null };
    const intents = await this.adapter.getNetworkShareSummaryIntents(network.id);
    const { summary } = await getNetworkPulseSummary(network.id, {
      networkTitle: network.title,
      intents,
      negotiations: [],
    });
    return { summary };
  }

  /**
   * Accept an invitation to join a network using the invitation code.
   * @param code - The invitation share code
   * @param userId - The authenticated user accepting the invitation
   * @returns The network, membership info, and whether user was already a member
   * @throws Error if the invitation code is invalid or the network is not found
   */
  async acceptInvitation(code: string, userId: string) {
    logger.verbose('Accepting invitation', { userId });
    return this.adapter.acceptNetworkInvitation(code, userId);
  }

  /**
   * List the people waiting for approval to join a network. Owner-only.
   * @param networkId - The network whose queue to read
   * @param userId - The caller; must be an owner of the network
   * @returns Pending requesters with name and email
   * @throws Error if the caller is not an owner
   */
  async getJoinRequests(networkId: string, userId: string) {
    logger.verbose('Getting join requests', { networkId, userId });
    const raw = await this.adapter.getNetworkJoinRequests(networkId, userId);
    return raw.map(r => ({
      id: r.userId,
      name: r.name,
      email: r.email,
      avatar: r.avatar,
      requestedAt: r.requestedAt,
    }));
  }

  /**
   * Approve or decline a pending join request. Owner-only.
   * @param networkId - The network being joined
   * @param targetUserId - The person who asked to join
   * @param userId - The caller; must be an owner of the network
   * @param decision - Whether to approve or decline the request
   * @throws Error if the caller is not an owner or the request is not pending
   */
  async reviewJoinRequest(networkId: string, targetUserId: string, userId: string, decision: 'approve' | 'decline') {
    logger.verbose('Reviewing join request', { networkId, targetUserId, decision });
    return this.adapter.reviewNetworkJoinRequest(networkId, targetUserId, userId, decision);
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
   * Leave a network. Members (non-owners) can leave.
   */
  async leaveNetwork(networkId: string, userId: string) {
    logger.verbose('Leaving network', { networkId, userId });
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
   * in the network. Members only: membership is asserted up front so the
   * current-user scoped read does not run for a non-member. Intents go through
   * the honest, uncapped getNetworkIntentsForMemberOwn.
   */
  async getNetworkOverview(networkId: string, userId: string) {
    logger.verbose('Getting network overview', { networkId, userId });
    const isMember = await this.adapter.isNetworkMember(networkId, userId);
    if (!isMember) {
      throw new Error('Access denied: Not a member of this network');
    }
    const intents = await this.adapter.getNetworkIntentsForMemberOwn(networkId, userId);
    return { intents };
  }

  /**
   * Resolve an network identifier (UUID or key) to a UUID.
   * @param idOrKey - UUID or human-readable key
   * @returns The network UUID, or null if not found
   */
  async resolveNetworkId(idOrKey: string): Promise<string | null> {
    logger.verbose('Resolving network ID or key', { idOrKey });
    return this.adapter.resolveNetworkId(idOrKey);
  }

  /**
   * Check whether a user holds the `'owner'` permission on a network.
   * Delegates to the adapter's permission-based check (network_members.permissions).
   *
   * @param networkId - The network ID
   * @param userId - The user ID to check
   * @returns `true` if the user is an owner, `false` otherwise
   */
  async isNetworkOwner(networkId: string, userId: string): Promise<boolean> {
    return this.adapter.isNetworkOwner(networkId, userId);
  }

}

export const networkService = new NetworkService();
