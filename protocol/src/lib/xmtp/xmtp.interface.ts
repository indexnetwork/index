/**
 * Storage contract required by the XMTP messaging layer.
 * Implementations provide database access without the lib knowing about the ORM.
 */
export interface MessagingStore {
  /** Retrieve the wallet address for a user (public info only). Returns null if no wallet exists. */
  getWalletAddress(userId: string): Promise<string | null>;

  /** Sign a message using the user's server-held private key. Returns the raw ECDSA signature bytes. */
  signMessage(userId: string, message: string): Promise<Uint8Array>;

  /** Ensure a user has a wallet. Generates one if missing. */
  ensureWallet(userId: string): Promise<void>;

  /** Store the XMTP inbox ID for a user after client creation. */
  setInboxId(userId: string, inboxId: string): Promise<void>;

  /** Get non-sensitive XMTP identity info (wallet address + inbox ID). */
  getPublicInfo(userId: string): Promise<{ walletAddress: string | null; xmtpInboxId: string | null } | null>;

  /** Get all hidden conversations for a user. */
  getHiddenConversations(userId: string): Promise<{ conversationId: string; hiddenAt: Date }[]>;

  /** Get the hidden-at timestamp for a specific conversation, or null if not hidden. */
  getHiddenAt(userId: string, conversationId: string): Promise<Date | null>;

  /** Mark a conversation as hidden (upsert). */
  hideConversation(userId: string, conversationId: string): Promise<void>;

  /** Resolve XMTP inbox IDs to user records (id, name, avatar). */
  resolveUsersByInboxIds(inboxIds: string[]): Promise<Map<string, { id: string; name: string; avatar: string | null }>>;
}
