import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import UserAvatar from '@/components/UserAvatar';
import { useAuthContext } from '@/contexts/AuthContext';
import { useConversation } from '@/contexts/ConversationContext';
import { isVisibleH2HConversation } from '@/lib/conversation-visibility';
import { resolveConversationPreview } from '@/lib/conversation-preview';
import { EmptyState } from '@/components/ui/EmptyState';
import { useCompact } from '@/hooks/useCompact';
import { Placeholder } from "@/components/ui/Placeholder";
import { useChatFilter } from '@/components/chat/ChatFrame';

interface RecentChat {
  groupId: string;
  peerUserId: string | null;
  peerAvatar: string | null;
  name: string;
  lastMessage: string;
  lastMessageIsInternal: boolean;
  viaTitle?: string;
  unreadCount: number;
  showUnreadCount: boolean;
  sortTimestamp: number;
  started: boolean;
}

const formatConversationTime = (timestamp: number) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isSameDay) {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date).toLowerCase();
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'yesterday';

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date).toLowerCase();
};

export default function ChatSidebar({ showEmpty = true }: {
  /** Off when the adjacent pane already renders the no-conversations empty state. */
  showEmpty?: boolean;
} = {}) {
  const navigate = useNavigate();
  const compact = useCompact();
  const { pathname } = useLocation();
  const activePeerId = pathname.match(/^\/u\/([^/]+)\/chat/)?.[1] ?? null;
  const { user } = useAuthContext();
  const { conversations, conversationsStatus, refreshConversations } = useConversation();

  const [refreshing, setRefreshing] = useState(true);
  const filter = useChatFilter();

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    refreshConversations().finally(() => {
      if (!cancelled) setRefreshing(false);
    });
    return () => { cancelled = true; };
  }, [user?.id, refreshConversations]);

  const recentChats: RecentChat[] = conversations.filter(isVisibleH2HConversation).map((conv) => {
      const peer = (conv.participants ?? []).find((p) => p.participantId !== user?.id && p.participantType === 'user');
      const lastText = (conv.lastMessage?.parts as { text?: string }[] | undefined)?.find(p => p.text)?.text ?? '';
      return {
        groupId: conv.id,
        peerUserId: peer?.participantId ?? null,
        peerAvatar: peer?.avatar ?? null,
        name: conv.metadata?.title ?? peer?.name ?? 'someone',
        lastMessage: lastText,
        lastMessageIsInternal: false,
        started: !!conv.lastMessage,
        viaTitle: conv.via?.[0]?.title,
        unreadCount: conv.unreadCount,
        showUnreadCount: conv.unreadCount > 0,
        sortTimestamp: new Date(conv.lastMessageAt ?? conv.createdAt).getTime(),
      };
    }).sort((a, b) => b.sortTimestamp - a.sortTimestamp)
    .filter((chat) => compact || filter === "all" || (filter === "unread" ? chat.unreadCount > 0 : !chat.started));

  /* Cold cache: conversation-row placeholders while the first fetch lands. */
  const renderSkeleton = () => <Placeholder.Rows count={8} label="loading conversations" />;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto mac-scroll">
        {recentChats.length === 0 && (refreshing || conversationsStatus === 'loading') ? (
          renderSkeleton()
        ) : recentChats.length === 0 && conversationsStatus === 'error' ? (
          <EmptyState
            tone="error"
            style={{ margin: 16 }}
            message="couldn't load conversations."
            action={{ label: 'try again', onClick: () => { setRefreshing(true); void refreshConversations().finally(() => setRefreshing(false)); } }}
          />
        ) : recentChats.length === 0 ? (
          // When showEmpty is off, the main pane next to this sidebar carries the empty state.
          !showEmpty ? null : <EmptyState
            style={{ margin: 16 }}
            message="no conversations yet. a chat opens when you and someone both accept an intro."
            action={{ label: 'start an intent', to: '/i/new' }}
          />
        ) : !compact ? (
          <div>
            {recentChats.map((chat) => {
              const preview = resolveConversationPreview({ lastMessage: chat.lastMessage, lastMessageIsInternal: chat.lastMessageIsInternal });
              return (
                <button
                  key={chat.groupId}
                  type="button"
                  className={`sv-row${chat.peerUserId === activePeerId ? " on" : ""}`}
                  data-sv-item={chat.groupId}
                  aria-current={chat.peerUserId === activePeerId ? "page" : undefined}
                  style={{ width: "100%", textAlign: "left", background: undefined, border: 0, borderBottom: "1px solid var(--sv-line)" }}
                  onClick={() => {
                    const to = chat.peerUserId ? `/u/${chat.peerUserId}/chat` : "/chat";
                    if (to === pathname) return;
                    navigate(to, { replace: pathname === "/chat" || activePeerId !== null });
                  }}
                >
                  <UserAvatar avatar={chat.peerAvatar} id={chat.peerUserId ?? chat.groupId} name={chat.name} size={36} />
                  <span className="sv-row-t">
                    <span className="sv-row-n" style={{ display: "block" }}>{chat.name}</span>
                    <span className="sv-row-pv" style={{ display: "block", color: preview.kind === "empty" ? "var(--sv-dim)" : undefined }}>
                      {preview.kind === "empty" ? "not started yet. say hi." : preview.text}
                    </span>
                  </span>
                  <span style={{ display: "grid", justifyItems: "end", gap: 4 }}>
                    {chat.lastMessage && <span className="sv-row-tm">{formatConversationTime(chat.sortTimestamp)}</span>}
                    {chat.showUnreadCount && <span className="sv-badge" data-testid={`chat-unread-${chat.groupId}`}>{chat.unreadCount > 99 ? "99+" : chat.unreadCount}</span>}
                  </span>
                </button>
              );
            })}
            {recentChats.length === 0 && <div className="sv-empty">nothing here.</div>}
          </div>
        ) : (
          <div>
            {recentChats.map((chat) => (
              <button
                key={chat.groupId}
                type="button"
                className="wb-link-row pl-row"
                aria-current={chat.peerUserId === activePeerId ? "page" : undefined}
                onClick={() => {
                  const to = chat.peerUserId ? `/u/${chat.peerUserId}/chat` : "/chat";
                  if (to === pathname) return;
                  // Compact lists push so back returns to the list; desktop swaps the pane in place.
                  navigate(to, { replace: !compact && (pathname === "/chat" || activePeerId !== null) });
                }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto minmax(0, 1fr) auto",
                  alignItems: "center",
                  width: "100%",
                  textAlign: "left",
                  gap: 12,
                  padding: "12px 16px",
                  border: "none",
                  borderBottom: "1px solid var(--pl-line, #e6e6e6)",
                }}
              >
                <UserAvatar avatar={chat.peerAvatar} id={chat.peerUserId ?? chat.groupId} name={chat.name} size={36} />
                <span style={{ display: "grid", gap: 3, minWidth: 0 }}>
                  <span style={{ display: "flex", gap: 8, alignItems: "baseline", minWidth: 0 }}>
                    <span style={{ flex: 1, minWidth: 0, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, fontWeight: 600, color: "inherit", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{chat.name}</span>
                    {chat.lastMessage && (
                      <span style={{ flex: "0 0 auto", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8a8578" }}>{formatConversationTime(chat.sortTimestamp)}</span>
                    )}
                  </span>
                  {(() => {
                    const preview = resolveConversationPreview({
                      lastMessage: chat.lastMessage,
                      lastMessageIsInternal: chat.lastMessageIsInternal,
                    });
                    if (preview.kind === "empty") {
                      return (
                        <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: "#8a8578" }}>{`${preview.text.toLowerCase()}.`}</span>
                      );
                    }
                    return (
                      <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: "#555", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{preview.text}</span>
                    );
                  })()}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {chat.showUnreadCount && (
                    <span data-testid={`chat-unread-${chat.groupId}`} style={{ fontFamily: "var(--mac-mono)", fontSize: 10, fontWeight: 700, background: "#FF8A00", color: "#000", border: "1px solid #000", padding: "0 6px" }}>{chat.unreadCount > 99 ? "99+" : chat.unreadCount}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
