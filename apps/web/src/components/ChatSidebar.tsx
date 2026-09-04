import { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { MoreHorizontal, Trash2 } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
import ConversationPreviewLine from '@/components/ConversationPreviewLine';
import { useAuthContext } from '@/contexts/AuthContext';
import { useConversation } from '@/contexts/ConversationContext';
import { isVisibleH2HConversation } from '@/lib/conversation-visibility';
import { resolveConversationPreview } from '@/lib/conversation-preview';

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
    }).format(date);
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
};

export default function ChatSidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useAuthContext();
  const { conversations, refreshConversations, hideConversation } = useConversation();

  // Background revalidation flag. The ConversationProvider prefetches both
  // lists on auth, so cached data renders immediately; this only gates the
  // empty state (skeleton vs "No messages yet") on a genuinely cold cache.
  const [refreshing, setRefreshing] = useState(true);
  const [chatMenuOpen, setChatMenuOpen] = useState<string | null>(null);
  const chatMenuRef = useRef<HTMLDivElement>(null);

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
        name: conv.metadata?.title ?? peer?.name ?? 'Conversation',
        lastMessage: lastText,
        lastMessageIsInternal: false,
        viaTitle: conv.via?.[0]?.title,
        unreadCount: conv.unreadCount,
        showUnreadCount: conv.unreadCount > 0,
        sortTimestamp: new Date(conv.lastMessageAt ?? conv.createdAt).getTime(),
      };
    }).sort((a, b) => b.sortTimestamp - a.sortTimestamp);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (chatMenuRef.current && !chatMenuRef.current.contains(event.target as Node)) {
        setChatMenuOpen(null);
      }
    };
    if (chatMenuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [chatMenuOpen]);

  const renderSkeleton = () => (
    /* Cold cache — conversation-row skeletons while the first fetch lands. */
    <div className="space-y-1" data-testid="chat-sidebar-skeleton" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2 px-2 -mx-2 animate-pulse">
          <div className="h-7 w-7 rounded-full bg-gray-200 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3.5 w-2/3 rounded bg-gray-200" />
            <div className="h-3 w-11/12 rounded bg-gray-200" />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="lg:hidden px-4 py-3 min-h-[68px] flex items-center gap-3">
        <button onClick={() => navigate('/')} className="text-[#3D3D3D] hover:text-black transition-colors text-xl mr-2">&larr;</button>
        <h2 className="text-lg font-bold text-black font-ibm-plex-mono">
          Conversations
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pt-4 lg:pt-4">
        {recentChats.length === 0 && refreshing ? (
          renderSkeleton()
        ) : recentChats.length === 0 ? (
          <div className="text-sm text-gray-400">No messages yet</div>
        ) : (
          <div className="space-y-1">
            {recentChats.map((chat) => (
              <div
                key={chat.groupId}
                className="relative group flex items-center py-2 px-2 -mx-2 rounded-md transition-colors hover:bg-gray-50"
              >
                <button
                  onClick={() => navigate(chat.peerUserId ? `/u/${chat.peerUserId}/chat` : `/chat`)}
                  className="flex-1 flex items-center gap-3 text-sm text-left pr-10 min-w-0 text-gray-700 hover:text-black"
                >
                  <UserAvatar avatar={chat.peerAvatar} id={chat.peerUserId ?? chat.groupId} name={chat.name} size={28} className="flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-sm flex items-center gap-1.5 ${chat.showUnreadCount ? 'font-bold' : 'font-medium'} text-black`}>
                      <span className="truncate">{chat.name}</span>
                      {chat.showUnreadCount && (
                        <span
                          data-testid={`chat-unread-${chat.groupId}`}
                          aria-label={`${chat.unreadCount} unread message${chat.unreadCount === 1 ? '' : 's'}`}
                          className="inline-flex min-w-4 h-4 items-center justify-center rounded-full bg-[#041729] px-1 text-[10px] font-bold text-white flex-shrink-0"
                        >
                          {chat.unreadCount > 99 ? '99+' : chat.unreadCount}
                        </span>
                      )}
                    </p>
                    {chat.viaTitle && (
                      <p className="truncate text-[11px] font-ibm-plex-mono text-gray-400">via {chat.viaTitle}</p>
                    )}
                    <ConversationPreviewLine
                      preview={resolveConversationPreview({
                        lastMessage: chat.lastMessage,
                        lastMessageIsInternal: chat.lastMessageIsInternal,
                      })}
                    />
                  </div>
                </button>
                <span className="absolute right-8 top-2 text-[11px] leading-none font-normal text-gray-400">
                  {formatConversationTime(chat.sortTimestamp)}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setChatMenuOpen(chatMenuOpen === chat.groupId ? null : chat.groupId);
                  }}
                  aria-label="Conversation options"
                  className="p-1 opacity-0 group-hover:opacity-100 hover:bg-gray-100 rounded transition-all flex-shrink-0"
                >
                  <MoreHorizontal className="w-4 h-4 text-gray-400" />
                </button>
                {chatMenuOpen === chat.groupId && (
                  <div
                    ref={chatMenuRef}
                    className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px] z-30"
                  >
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        setChatMenuOpen(null);
                        await hideConversation(chat.groupId);
                        if (chat.peerUserId && pathname?.includes(chat.peerUserId)) {
                          navigate('/');
                        }
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" /> Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
