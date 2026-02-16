'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { Client } from '@xmtp/browser-sdk';
import type { Group } from '@xmtp/browser-sdk';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useAuthContext } from './AuthContext';
import {
  createXMTPSigner,
  createXMTPClient,
  getAppData,
  CONVERSATION_TYPES,
  type ConversationAppData,
} from '@/lib/xmtp';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

interface XMTPContextType {
  /** The XMTP browser client instance, or null if not yet initialized. */
  client: Client | null;
  /** True once the client is created and conversations have been synced. */
  isReady: boolean;
  /** The XMTP agent wallet address fetched from the backend. */
  agentAddress: string | null;
  /** All conversations the user participates in (groups). */
  conversations: Group[];
  /** The single home-feed conversation, if one exists. */
  homeFeed: Group | null;
  /** AI chat conversations. */
  aiChats: Group[];
  /** Human (peer-to-peer) chat conversations. */
  humanChats: Group[];
  /** Create a new AI chat group with the agent. */
  createAIChat: (agentInboxId: string) => Promise<Group>;
  /** Create a new human chat group including the other user and the agent. */
  createHumanChat: (otherUserInboxId: string, agentInboxId: string) => Promise<Group>;
  /** Get or create the singleton home-feed group with the agent. */
  getOrCreateHomeFeed: (agentInboxId: string) => Promise<Group>;
  /** Re-sync and re-categorize conversations from the network. */
  refreshConversations: () => Promise<void>;
  /** Stream an AI response via the backend SSE sideband. Returns a ReadableStream of SSE text. */
  streamAIResponse: (
    conversationId: string,
    message: string,
    fileIds?: string[],
    indexId?: string,
  ) => Promise<ReadableStream>;
}

const XMTPContext = createContext<XMTPContextType | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function XMTPProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuthContext();
  const { getAccessToken } = usePrivy();
  const { wallets } = useWallets();

  const [client, setClient] = useState<Client | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [agentAddress, setAgentAddress] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Group[]>([]);
  const [homeFeed, setHomeFeed] = useState<Group | null>(null);
  const [aiChats, setAiChats] = useState<Group[]>([]);
  const [humanChats, setHumanChats] = useState<Group[]>([]);

  // Track the currently-connected user so we can skip re-initialization.
  const connectedUserRef = useRef<string | null>(null);
  const initPromiseRef = useRef<Promise<void> | null>(null);

  // ------------------------------------------------------------------
  // Fetch agent address from the backend (no auth required)
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!isAuthenticated) {
      setAgentAddress(null);
      return;
    }

    let cancelled = false;
    const fetchAgentAddress = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/chat/agent-address`);
        if (!res.ok) {
          console.warn('Failed to fetch agent address:', res.status);
          return;
        }
        const data = (await res.json()) as { address?: string };
        if (!cancelled && data.address) {
          setAgentAddress(data.address);
        }
      } catch (err) {
        console.error('Error fetching agent address:', err);
      }
    };

    fetchAgentAddress();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  // ------------------------------------------------------------------
  // Categorize conversations by their appData.type
  // ------------------------------------------------------------------
  const categorize = useCallback((groups: Group[]) => {
    const home: Group[] = [];
    const ai: Group[] = [];
    const human: Group[] = [];

    for (const g of groups) {
      const appData = getAppData(g as unknown as { appData?: string });
      if (!appData) continue;
      switch (appData.type) {
        case CONVERSATION_TYPES.HOME_FEED:
          home.push(g);
          break;
        case CONVERSATION_TYPES.AI_CHAT:
          ai.push(g);
          break;
        case CONVERSATION_TYPES.HUMAN_CHAT:
          human.push(g);
          break;
      }
    }

    setConversations(groups);
    setHomeFeed(home[0] ?? null);
    setAiChats(ai);
    setHumanChats(human);
  }, []);

  // ------------------------------------------------------------------
  // Refresh conversations from network
  // ------------------------------------------------------------------
  const refreshConversations = useCallback(async () => {
    if (!client) return;
    await client.conversations.syncAll();
    const allGroups = await client.conversations.listGroups();
    categorize(allGroups);
  }, [client, categorize]);

  // ------------------------------------------------------------------
  // Initialize XMTP client when authenticated + wallet ready
  // ------------------------------------------------------------------
  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      // Clean up when logging out
      if (client) {
        client.close();
        setClient(null);
      }
      connectedUserRef.current = null;
      initPromiseRef.current = null;
      setIsReady(false);
      setConversations([]);
      setHomeFeed(null);
      setAiChats([]);
      setHumanChats([]);
      return;
    }

    // Find the Privy embedded wallet
    const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy');
    if (!embeddedWallet) return; // wallet not yet available

    // If we're already connected for this user, skip
    if (connectedUserRef.current === user.id && client) return;

    // If init is already in flight, skip
    if (initPromiseRef.current) return;

    let mounted = true;

    const init = async () => {
      try {
        const provider = await embeddedWallet.getEthereumProvider();
        const signer = createXMTPSigner(
          provider as unknown as { request: (...args: unknown[]) => Promise<unknown> },
          embeddedWallet.address,
        );
        const xmtpClient = await createXMTPClient(signer);

        if (!mounted) {
          xmtpClient.close();
          return;
        }

        connectedUserRef.current = user.id;
        setClient(xmtpClient);

        // Register the XMTP inbox ID with the backend so the agent can
        // resolve this user from their XMTP sender inbox ID.
        try {
          const token = await getAccessToken();
          await fetch(`${API_BASE_URL}/chat/register-inbox`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ inboxId: xmtpClient.inboxId }),
          });
        } catch (error) {
          console.error('[XMTP] Failed to register inbox ID:', error);
        }

        // Initial sync
        await xmtpClient.conversations.syncAll();
        const allGroups = await xmtpClient.conversations.listGroups();

        if (mounted) {
          categorize(allGroups);
          setIsReady(true);
        }
      } catch (err) {
        console.error('Failed to initialize XMTP client:', err);
      } finally {
        initPromiseRef.current = null;
      }
    };

    initPromiseRef.current = init();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user?.id, wallets, categorize]);

  // ------------------------------------------------------------------
  // Cleanup on unmount
  // ------------------------------------------------------------------
  useEffect(() => {
    return () => {
      if (client) {
        client.close();
      }
    };
  }, [client]);

  // ------------------------------------------------------------------
  // createAIChat
  // ------------------------------------------------------------------
  const createAIChat = useCallback(
    async (agentInboxId: string): Promise<Group> => {
      if (!client) throw new Error('XMTP client not initialized');

      const appData: ConversationAppData = { type: CONVERSATION_TYPES.AI_CHAT };
      const group = await client.conversations.createGroup([agentInboxId], {
        appData: JSON.stringify(appData),
      });
      // Refresh local state
      await refreshConversations();
      return group;
    },
    [client, refreshConversations],
  );

  // ------------------------------------------------------------------
  // createHumanChat
  // ------------------------------------------------------------------
  const createHumanChat = useCallback(
    async (otherUserInboxId: string, agentInboxId: string): Promise<Group> => {
      if (!client) throw new Error('XMTP client not initialized');

      const appData: ConversationAppData = { type: CONVERSATION_TYPES.HUMAN_CHAT };
      const group = await client.conversations.createGroup(
        [otherUserInboxId, agentInboxId],
        { appData: JSON.stringify(appData) },
      );
      await refreshConversations();
      return group;
    },
    [client, refreshConversations],
  );

  // ------------------------------------------------------------------
  // getOrCreateHomeFeed
  // ------------------------------------------------------------------
  const getOrCreateHomeFeed = useCallback(
    async (agentInboxId: string): Promise<Group> => {
      if (!client) throw new Error('XMTP client not initialized');

      // Check if we already have one
      if (homeFeed) return homeFeed;

      // Sync first to make sure we haven't missed it
      await client.conversations.syncAll();
      const groups = await client.conversations.listGroups();
      const existing = groups.find((g) => {
        const data = getAppData(g as unknown as { appData?: string });
        return data?.type === CONVERSATION_TYPES.HOME_FEED;
      });
      if (existing) {
        categorize(groups);
        return existing;
      }

      // Create new home feed group
      const appData: ConversationAppData = { type: CONVERSATION_TYPES.HOME_FEED };
      const group = await client.conversations.createGroup([agentInboxId], {
        appData: JSON.stringify(appData),
        groupName: 'Home Feed',
      });
      await refreshConversations();
      return group;
    },
    [client, homeFeed, categorize, refreshConversations],
  );

  // ------------------------------------------------------------------
  // streamAIResponse -- SSE sideband via backend /chat/stream
  // ------------------------------------------------------------------
  const streamAIResponse = useCallback(
    async (
      conversationId: string,
      message: string,
      fileIds?: string[],
      indexId?: string,
    ): Promise<ReadableStream> => {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error('Not authenticated');

      const res = await fetch(`${API_BASE_URL}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          message,
          sessionId: conversationId,
          fileIds: fileIds ?? [],
          ...(indexId ? { indexId } : {}),
        }),
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown error');
        throw new Error(`Stream request failed (${res.status}): ${errorText}`);
      }

      if (!res.body) {
        throw new Error('Response body is null');
      }

      return res.body;
    },
    [getAccessToken],
  );

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------
  return (
    <XMTPContext.Provider
      value={{
        client,
        isReady,
        agentAddress,
        conversations,
        homeFeed,
        aiChats,
        humanChats,
        createAIChat,
        createHumanChat,
        getOrCreateHomeFeed,
        refreshConversations,
        streamAIResponse,
      }}
    >
      {children}
    </XMTPContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useXMTP() {
  const context = useContext(XMTPContext);
  if (context === undefined) {
    throw new Error('useXMTP must be used within an XMTPProvider');
  }
  return context;
}
