import { Client, type Signer, IdentifierKind } from '@xmtp/browser-sdk';

export const CONVERSATION_TYPES = {
  HOME_FEED: 'home_feed',
  AI_CHAT: 'ai_chat',
  HUMAN_CHAT: 'human_chat',
} as const;

export type ConversationType = typeof CONVERSATION_TYPES[keyof typeof CONVERSATION_TYPES];

export interface ConversationAppData {
  type: ConversationType;
  title?: string;
  opportunityIds?: string[];
}

const XMTP_ENV = (process.env.NEXT_PUBLIC_XMTP_ENV as 'dev' | 'production' | 'local') || 'dev';

/**
 * Create an XMTP-compatible EOA signer from a Privy embedded wallet provider.
 *
 * The provider is the EIP-1193 provider obtained via `wallet.getEthereumProvider()`.
 * `address` should be the wallet's Ethereum address.
 */
export function createXMTPSigner(provider: { request: (...args: unknown[]) => Promise<unknown> }, address: string): Signer {
  return {
    type: 'EOA' as const,
    getIdentifier: () => ({
      identifier: address,
      identifierKind: IdentifierKind.Ethereum,
    }),
    signMessage: async (message: string) => {
      const signature = (await provider.request({
        method: 'personal_sign',
        params: [message, address],
      })) as string;
      const hex = signature.startsWith('0x') ? signature.slice(2) : signature;
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
      }
      return bytes;
    },
  };
}

/**
 * Create and register an XMTP browser client with the given signer.
 */
export async function createXMTPClient(signer: Signer): Promise<Client> {
  const client = await Client.create(signer, {
    env: XMTP_ENV,
  });
  return client;
}

/**
 * Parse conversation appData JSON into a typed object.
 * Returns null if the conversation has no appData or if parsing fails.
 */
export function getAppData(conversation: { appData?: string }): ConversationAppData | null {
  try {
    const raw = conversation.appData;
    if (!raw) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}
