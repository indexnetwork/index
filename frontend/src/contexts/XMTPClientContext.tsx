import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from 'react';
import type { Client, Dm } from '@xmtp/browser-sdk';

import { useAuthContext } from './AuthContext';
import { useAuthenticatedAPI } from '@/lib/api';
import { useXmtpKeyManager } from '@/hooks/useXmtpKeyManager';
import { createXmtpService, type ChatContextResponse, type ResolvedPeer } from '@/services/xmtp';
import { createBrowserClient } from '@/lib/xmtp/xmtp.client';

export interface XmtpConversation {
  groupId: string;
  name: string | null;
  peerUserId: string | null;
  peerAvatar: string | null;
  lastMessage: { content: unknown; sentAt: string } | null;
  updatedAt: string | null;
}

export interface XmtpMessage {
  id: string;
  senderInboxId: string;
  content: unknown;
  sentAt: string;
}

export interface XmtpChatContext extends ChatContextResponse {
  groupId: string | null;
}

interface XMTPClientContextType {
  isConnected: boolean;
  myInboxId: string | null;
  conversations: XmtpConversation[];
  messages: Map<string, XmtpMessage[]>;
  totalUnreadCount: number;
  deletedConversationIds: Set<string>;
  sendMessage: (params: { groupId?: string; peerUserId?: string; text: string }) => Promise<string | null>;
  getChatContext: (peerUserId: string) => Promise<XmtpChatContext | null>;
  loadMessages: (groupId: string, limit?: number) => Promise<XmtpMessage[]>;
  refreshConversations: () => Promise<void>;
  deleteConversation: (conversationId: string) => Promise<void>;
  isKeyReady: boolean;
}

const XMTPClientContext = createContext<XMTPClientContextType | undefined>(undefined);

// @ts-expect-error — Vite injects import.meta.env at build time
const XMTP_ENV: 'dev' | 'production' = (import.meta.env?.VITE_XMTP_ENV as string) || 'dev';

/**
 * Extract text content from an XMTP message's content field.
 */
function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && 'text' in content) {
    return String((content as { text: unknown }).text);
  }
  return '';
}

/**
 * Client-side XMTP provider using @xmtp/browser-sdk.
 * Fetches server-managed wallet key and creates the XMTP client automatically.
 */
export function XMTPProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, user } = useAuthContext();
  const api = useAuthenticatedAPI();
  const keyManager = useXmtpKeyManager(api);
  const service = useMemo(() => createXmtpService(api), [api]);

  const [isConnected, setIsConnected] = useState(false);
  const [myInboxId, setMyInboxId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<XmtpConversation[]>([]);
  const [messages, setMessages] = useState<Map<string, XmtpMessage[]>>(new Map());
  const [deletedConversationIds, setDeletedConversationIds] = useState<Set<string>>(new Set());

  const clientRef = useRef<Client | null>(null);
  const clientCreatingRef = useRef(false);
  const streamAbortRef = useRef<AbortController | null>(null);
  const peerCacheRef = useRef<Map<string, ResolvedPeer>>(new Map());
  const hiddenIdsRef = useRef<Set<string>>(new Set());

  // Initialize key manager when authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      keyManager.initialize();
    }
  }, [isAuthenticated, user]); // eslint-disable-line react-hooks/exhaustive-deps

  const isKeyReady = keyManager.state.status === 'ready';

  // ── Create browser XMTP client when key becomes ready ─────────────────────

  // Extract wallet address when ready (type narrowing)
  const readyWalletAddress: string | null =
    keyManager.state.status === 'ready' ? keyManager.state.walletAddress : null;

  useEffect(() => {
    if (!isKeyReady || !readyWalletAddress) return;
    if (clientRef.current || clientCreatingRef.current) return; // already created or in progress
    clientCreatingRef.current = true;

    let cancelled = false;
    const walletAddress = readyWalletAddress;

    (async () => {
      try {
        const client = await createBrowserClient(walletAddress, api, XMTP_ENV);
        if (cancelled) {
          clientCreatingRef.current = false;
          return;
        }
        clientRef.current = client;
        setMyInboxId(client.inboxId ?? null);
        setIsConnected(true);

        // Fetch hidden conversations
        try {
          const { conversations: hidden } = await service.getHiddenConversations();
          const hiddenSet = new Set(hidden.map(h => h.conversationId));
          hiddenIdsRef.current = hiddenSet;
          setDeletedConversationIds(hiddenSet);
        } catch (err) {
          console.error('[XMTPClientContext] Failed to fetch hidden conversations:', err);
        }

        // Start streaming messages
        startMessageStream(client);
      } catch (err) {
        console.error('[XMTPClientContext] Failed to create browser client:', err);
        clientCreatingRef.current = false;
      }
    })();

    return () => { cancelled = true; };
  }, [isKeyReady, readyWalletAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);

  // ── Reconnection handling ─────────────────────────────────────────────────

  useEffect(() => {
    const handleOnline = () => {
      const client = clientRef.current;
      if (client) {
        client.conversations.syncAll().catch(err => {
          console.error('[XMTPClientContext] syncAll on reconnect failed:', err);
        });
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  // ── Message streaming ─────────────────────────────────────────────────────

  const startMessageStream = useCallback((client: Client) => {
    streamAbortRef.current?.abort();
    const abort = new AbortController();
    streamAbortRef.current = abort;

    (async () => {
      try {
        const stream = await client.conversations.streamAllMessages();
        for await (const message of stream) {
          if (abort.signal.aborted) break;

          const groupId = message.conversationId;
          if (hiddenIdsRef.current.has(groupId)) continue;

          const msg: XmtpMessage = {
            id: message.id,
            senderInboxId: message.senderInboxId,
            content: extractMessageText(message.content),
            sentAt: new Date(Number(message.sentAtNs) / 1_000_000).toISOString(),
          };

          setMessages(prev => {
            const next = new Map(prev);
            const existing = next.get(groupId) ?? [];
            if (existing.some(m => m.id === msg.id)) return prev;
            next.set(groupId, [...existing, msg]);
            return next;
          });

          // Update conversation's lastMessage
          setConversations(prev => {
            const idx = prev.findIndex(c => c.groupId === groupId);
            if (idx === -1) return prev; // will be picked up on next refresh
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              lastMessage: { content: msg.content, sentAt: msg.sentAt },
              updatedAt: msg.sentAt,
            };
            return updated;
          });
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          console.error('[XMTPClientContext] Message stream error:', err);
        }
      }
    })();
  }, []);

  // ── Peer resolution helper ────────────────────────────────────────────────

  const resolvePeerForDm = useCallback(async (dm: Dm, myInboxId: string): Promise<ResolvedPeer | null> => {
    try {
      const members = await dm.members();
      const peerMember = members.find(m => m.inboxId !== myInboxId);
      if (!peerMember) return null;

      const cached = peerCacheRef.current.get(peerMember.inboxId);
      if (cached) return cached;

      const { peers } = await service.resolvePeers([peerMember.inboxId]);
      const peer = peers[peerMember.inboxId];
      if (peer) {
        peerCacheRef.current.set(peerMember.inboxId, peer);
      }
      return peer ?? null;
    } catch {
      return null;
    }
  }, [service]);

  // ── Messaging operations ──────────────────────────────────────────────────

  const refreshConversations = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;

    try {
      await client.conversations.syncAll();
      const dms = await client.conversations.listDms();

      // Batch resolve all peer inbox IDs
      const unresolvedInboxIds: string[] = [];
      const dmPeerMap = new Map<string, string>(); // dmId -> peerInboxId

      for (const dm of dms) {
        if (hiddenIdsRef.current.has(dm.id)) continue;
        const members = await dm.members();
        const peer = members.find(m => m.inboxId !== client.inboxId);
        if (peer) {
          dmPeerMap.set(dm.id, peer.inboxId);
          if (!peerCacheRef.current.has(peer.inboxId)) {
            unresolvedInboxIds.push(peer.inboxId);
          }
        }
      }

      // Batch resolve unresolved peers
      if (unresolvedInboxIds.length > 0) {
        try {
          const { peers } = await service.resolvePeers(unresolvedInboxIds);
          for (const [inboxId, peer] of Object.entries(peers)) {
            peerCacheRef.current.set(inboxId, peer);
          }
        } catch (err) {
          console.error('[XMTPClientContext] Failed to resolve peers:', err);
        }
      }

      // Build conversation list
      const convos: XmtpConversation[] = [];
      for (const dm of dms) {
        if (hiddenIdsRef.current.has(dm.id)) continue;
        const peerInboxId = dmPeerMap.get(dm.id);
        const peer = peerInboxId ? peerCacheRef.current.get(peerInboxId) : undefined;

        // Get last message
        await dm.sync();
        const msgs = await dm.messages({ limit: BigInt(1) });
        const lastMsg = msgs[0];

        convos.push({
          groupId: dm.id,
          name: peer?.name ?? null,
          peerUserId: peer?.id ?? null,
          peerAvatar: peer?.avatar ?? null,
          lastMessage: lastMsg ? {
            content: extractMessageText(lastMsg.content),
            sentAt: new Date(Number(lastMsg.sentAtNs) / 1_000_000).toISOString(),
          } : null,
          updatedAt: lastMsg
            ? new Date(Number(lastMsg.sentAtNs) / 1_000_000).toISOString()
            : null,
        });
      }

      // Sort by most recent message
      convos.sort((a, b) => {
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bTime - aTime;
      });

      setConversations(convos);
    } catch (err) {
      console.error('[XMTPClientContext] Failed to refresh conversations:', err);
    }
  }, [service]);

  const getChatContext = useCallback(async (peerUserId: string): Promise<XmtpChatContext | null> => {
    const client = clientRef.current;
    try {
      const oppCtx = await service.getChatContext(peerUserId);

      // Try to find existing DM by resolving peer's inbox ID
      let groupId: string | null = null;
      if (client) {
        try {
          const peerInfo = await service.getPeerInfo(peerUserId);
          if (peerInfo?.xmtpInboxId) {
            const dm = await client.conversations.getDmByInboxId(peerInfo.xmtpInboxId);
            groupId = dm?.id ?? null;
          }
        } catch {
          // peer may not have an inbox yet
        }
      }

      return { ...oppCtx, groupId };
    } catch (err) {
      console.error('[XMTPClientContext] Failed to get chat context:', err);
      return null;
    }
  }, [service]);

  const loadMessages = useCallback(async (groupId: string, limit?: number): Promise<XmtpMessage[]> => {
    const client = clientRef.current;
    if (!client) return [];

    try {
      const dms = await client.conversations.listDms();
      const dm = dms.find(d => d.id === groupId);
      if (!dm) return [];

      await dm.sync();
      const msgs = await dm.messages({ limit: limit ? BigInt(limit) : undefined });

      const mapped: XmtpMessage[] = msgs.map(m => ({
        id: m.id,
        senderInboxId: m.senderInboxId,
        content: extractMessageText(m.content),
        sentAt: new Date(Number(m.sentAtNs) / 1_000_000).toISOString(),
      }));

      setMessages(prev => {
        const next = new Map(prev);
        next.set(groupId, mapped);
        return next;
      });

      return mapped;
    } catch (err) {
      console.error('[XMTPClientContext] Failed to load messages:', err);
      return [];
    }
  }, []);

  const sendMessage = useCallback(async (params: { groupId?: string; peerUserId?: string; text: string }): Promise<string | null> => {
    const client = clientRef.current;
    if (!client) return null;

    try {
      let dm: Dm | undefined;

      if (params.groupId) {
        const dms = await client.conversations.listDms();
        dm = dms.find(d => d.id === params.groupId);
      }

      if (!dm && params.peerUserId) {
        // Resolve peer's inbox ID and create/find DM
        const peerInfo = await service.getPeerInfo(params.peerUserId);
        if (!peerInfo?.xmtpInboxId) {
          console.error('[XMTPClientContext] Peer has no XMTP inbox');
          return null;
        }

        dm = (await client.conversations.getDmByInboxId(peerInfo.xmtpInboxId)) as Dm | undefined;
        if (!dm) {
          dm = await client.conversations.createDm(peerInfo.xmtpInboxId) as Dm;
        }
      }

      if (!dm) {
        console.error('[XMTPClientContext] Could not find or create DM');
        return null;
      }

      await dm.sendText(params.text);
      void refreshConversations();
      return dm.id;
    } catch (err) {
      console.error('[XMTPClientContext] Failed to send message:', err);
      return null;
    }
  }, [service, refreshConversations]);

  const deleteConversation = useCallback(async (conversationId: string) => {
    try {
      await service.deleteConversation(conversationId);
      hiddenIdsRef.current.add(conversationId);
      setDeletedConversationIds(prev => new Set(prev).add(conversationId));
      setConversations(prev => prev.filter(c => c.groupId !== conversationId));
      setMessages(prev => {
        const next = new Map(prev);
        next.delete(conversationId);
        return next;
      });
    } catch (err) {
      console.error('[XMTPClientContext] Failed to delete conversation:', err);
    }
  }, [service]);

  return (
    <XMTPClientContext.Provider value={{
      isConnected,
      myInboxId,
      conversations,
      messages,
      totalUnreadCount: 0,
      deletedConversationIds,
      sendMessage,
      getChatContext,
      loadMessages,
      refreshConversations,
      deleteConversation,
      isKeyReady,
    }}>
      {children}
    </XMTPClientContext.Provider>
  );
}

export function useXMTP() {
  const context = useContext(XMTPClientContext);
  if (context === undefined) {
    throw new Error('useXMTP must be used within an XMTPProvider');
  }
  return context;
}
