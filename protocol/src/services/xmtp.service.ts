import type { MessagingStore } from '../lib/xmtp';
import { log } from '../lib/log';

const logger = log.service.from('xmtp');

/**
 * Manages XMTP identity, server-side signing, peer resolution, and conversation management.
 */
export class XmtpService {
  constructor(private readonly messagingStore: MessagingStore) {}

  /**
   * Retrieve the public wallet address for a user (no private key exposed).
   * @param userId - Authenticated user ID.
   * @returns Wallet address, or null if no wallet exists.
   */
  async getIdentity(userId: string): Promise<{ walletAddress: string } | null> {
    const walletAddress = await this.messagingStore.getWalletAddress(userId);
    if (!walletAddress) return null;
    return { walletAddress };
  }

  /**
   * Sign a message using the user's server-held private key.
   * The private key never leaves the server.
   * @param userId - Authenticated user ID.
   * @param message - The message to sign (XMTP identity challenge).
   * @returns Raw signature bytes as number array (for JSON transport).
   */
  async signMessage(userId: string, message: string): Promise<number[]> {
    const signature = await this.messagingStore.signMessage(userId, message);
    return Array.from(signature);
  }

  /**
   * Resolve XMTP inbox IDs to user records (id, name, avatar).
   * @param inboxIds - Array of XMTP inbox IDs.
   * @returns Map of inboxId to user info, serialized as a plain object.
   */
  async resolvePeers(inboxIds: string[]): Promise<Record<string, { id: string; name: string; avatar: string | null }>> {
    const map = await this.messagingStore.resolveUsersByInboxIds(inboxIds);
    const result: Record<string, { id: string; name: string; avatar: string | null }> = {};
    for (const [inboxId, user] of map) {
      result[inboxId] = user;
    }
    return result;
  }

  /**
   * Get public XMTP identity info for a user.
   * @param userId - The target user ID.
   * @returns Wallet address and inbox ID, or null if not found.
   */
  async getPeerInfo(userId: string): Promise<{ walletAddress: string | null; xmtpInboxId: string | null } | null> {
    return this.messagingStore.getPublicInfo(userId);
  }

  /**
   * Soft-delete a conversation for a user.
   * @param userId - Authenticated user ID.
   * @param conversationId - The XMTP conversation/group ID to hide.
   */
  async hideConversation(userId: string, conversationId: string): Promise<void> {
    await this.messagingStore.hideConversation(userId, conversationId);
    logger.info('[hideConversation] Conversation hidden', { userId, conversationId });
  }

  /**
   * Get all hidden conversations for a user.
   * @param userId - Authenticated user ID.
   * @returns Array of hidden conversation records.
   */
  async getHiddenConversations(userId: string): Promise<{ conversationId: string; hiddenAt: Date }[]> {
    return this.messagingStore.getHiddenConversations(userId);
  }
}
