import { useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { MoreHorizontal, Trash2, ChevronRight } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
import ConversationPreviewLine from '@/components/ConversationPreviewLine';
import { useAuthContext } from '@/contexts/AuthContext';
import { useConversation } from '@/contexts/ConversationContext';
import { isVisibleH2HConversation } from '@/lib/conversation-visibility';
import { resolveConversationPreview } from '@/lib/conversation-preview';
import { countNegotiationsRequiringAction } from '@/lib/negotiation-inbox';
import { groupNegotiationOutline, opportunityStatusPresentation } from '@/lib/negotiation-outline';

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
  const { pathname, search } = useLocation();
  const { user } = useAuthContext();
  const { conversations, negotiations, isConnected, refreshConversations, refreshNegotiations, hideConversation } = useConversation();

  // Background revalidation flag. The ConversationProvider prefetches both
  // lists on auth, so cached data renders immediately; this only gates the
  // empty state (skeleton vs "No messages yet") on a genuinely cold cache.
  const [refreshing, setRefreshing] = useState(true);
  const [chatMenuOpen, setChatMenuOpen] = useState<string | null>(null);
  const [mode, setMode] = useState<'h2h' | 'a2a'>('h2h');
  const chatMenuRef = useRef<HTMLDivElement>(null);

  const [expandedCounterpartIds, setExpandedCounterpartIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    Promise.all([refreshConversations(), refreshNegotiations()]).finally(() => {
      if (!cancelled) setRefreshing(false);
    });
    return () => { cancelled = true; };
  }, [user?.id, refreshConversations, refreshNegotiations]);

  // One classification source for inbox, tab, TopBar pill, and this toggle
  // badge — no inline re-derivation here (R1).
  const yourMoveCount = useMemo(
    () => countNegotiationsRequiringAction(negotiations, user?.id),
    [negotiations, user?.id],
  );
  const negotiationOutline = useMemo(
    () => groupNegotiationOutline(negotiations, user?.id),
    [negotiations, user?.id],
  );
  const negotiationCount = negotiationOutline.reduce((count, group) => count + group.opportunities.length, 0);

  const recentChats: RecentChat[] = mode === 'h2h'
    ? conversations.filter(isVisibleH2HConversation).map((conv) => {
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
    }).sort((a, b) => b.sortTimestamp - a.sortTimestamp)
    : [];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (chatMenuRef.current && !chatMenuRef.current.contains(event.target as Node)) {
        setChatMenuOpen(null);
      }
    };
    if (chatMenuOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [chatMenuOpen]);

  const openNegotiation = (conversationId: string, taskId: string) => {
    navigate(`/chat/${conversationId}?taskId=${encodeURIComponent(taskId)}`);
  };

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

  const selectedTaskId = new URLSearchParams(search).get('taskId');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="lg:hidden px-4 py-3 min-h-[68px] flex items-center gap-3">
        <button onClick={() => navigate('/')} className="text-[#3D3D3D] hover:text-black transition-colors text-xl mr-2">&larr;</button>
        <h2 className="text-lg font-bold text-black font-ibm-plex-mono">Conversations</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pt-4 lg:pt-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="flex flex-1 items-center gap-1 bg-gray-100 rounded-md p-0.5">
            <button
              onClick={() => setMode('h2h')}
              className={`flex-1 text-xs font-semibold py-1.5 rounded transition-colors font-ibm-plex-mono ${mode === 'h2h' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Messages
            </button>
            <button
              onClick={() => setMode('a2a')}
              className={`flex-1 text-xs font-semibold py-1.5 rounded transition-colors font-ibm-plex-mono ${mode === 'a2a' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Negotiations
              {yourMoveCount > 0 && (
                <span
                  data-testid="chat-negotiations-your-move-badge"
                  aria-label={`${yourMoveCount} negotiation${yourMoveCount === 1 ? '' : 's'} need your input`}
                  className="ml-1 inline-flex h-4 min-w-4 flex-none items-center justify-center rounded-full bg-[#041729] px-1 align-middle text-[10px] font-bold leading-none text-white"
                >
                  {yourMoveCount > 99 ? '99+' : yourMoveCount}
                </span>
              )}
            </button>
          </div>
          <span
            data-testid="chat-connection-dot"
            role="status"
            title={isConnected ? 'live' : 'reconnecting…'}
            aria-label={isConnected ? 'live' : 'reconnecting…'}
            className={`h-1.5 w-1.5 flex-none rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-gray-400'}`}
          />
        </div>
        {mode === 'a2a' ? (
          negotiationCount === 0 && refreshing ? (
            renderSkeleton()
          ) : negotiationCount === 0 ? (
            <div className="py-8 text-center font-ibm-plex-mono">
              <p className="text-xs font-semibold text-gray-700">No negotiations yet</p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-gray-400">Your agents’ connection work will appear here.</p>
            </div>
          ) : (
            <div className="space-y-1" data-testid="negotiation-outline">
              {negotiationOutline.map((counterparty) => {
                const expanded = expandedCounterpartIds.has(counterparty.id);
                const regionId = `negotiations-${counterparty.id}`;
                return (
                  <div key={counterparty.id} className="rounded-md">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={regionId}
                      onClick={() => setExpandedCounterpartIds((previous) => {
                        const next = new Set(previous);
                        if (next.has(counterparty.id)) next.delete(counterparty.id);
                        else next.add(counterparty.id);
                        return next;
                      })}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#4091bb]"
                    >
                      <ChevronRight className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden="true" />
                      <UserAvatar avatar={counterparty.avatar} id={counterparty.id} name={counterparty.name} size={28} className="flex-shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-black">{counterparty.name}</span>
                      <span className="font-ibm-plex-mono text-[10px] text-gray-400">{counterparty.opportunities.length}</span>
                    </button>
                    {expanded && (
                      <div id={regionId} className="ml-5 border-l border-gray-200 pl-2" role="region" aria-label={`${counterparty.name} opportunities`}>
                        {counterparty.opportunities.map((opportunity) => {
                          const presentation = opportunity.status ? opportunityStatusPresentation[opportunity.status] : null;
                          const selected = pathname === `/chat/${opportunity.conversationId}` && selectedTaskId === opportunity.taskId;
                          const opportunityMenuId = `negotiation:${opportunity.conversationId}:${opportunity.taskId}`;
                          return (
                            <div key={`${opportunity.conversationId}-${opportunity.taskId}`} className={`group relative flex min-w-0 items-center rounded-md ${selected ? 'bg-[#f1f5f7]' : 'hover:bg-gray-50'}`}>
                              <button
                                type="button"
                                onClick={() => openNegotiation(opportunity.conversationId, opportunity.taskId)}
                                aria-current={selected ? 'page' : undefined}
                                className="relative flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#4091bb]"
                              >
                                {selected && <span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-[#041729]" aria-hidden="true" />}
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${presentation?.dotClass ?? 'bg-gray-300'}`} aria-hidden="true" />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-xs font-medium text-gray-800">{opportunity.title}</span>
                                  <span className="block truncate font-ibm-plex-mono text-[10px] text-gray-400">
                                    {presentation?.label ?? 'No lifecycle status'}
                                  </span>
                                </span>
                              </button>
                              <button
                                type="button"
                                aria-label="Negotiation options"
                                onClick={() => setChatMenuOpen(chatMenuOpen === opportunityMenuId ? null : opportunityMenuId)}
                                className="mr-1 rounded p-1 opacity-0 transition-opacity hover:bg-gray-100 group-hover:opacity-100 focus-visible:opacity-100"
                              >
                                <MoreHorizontal className="h-4 w-4 text-gray-400" />
                              </button>
                              {chatMenuOpen === opportunityMenuId && (
                                <div ref={chatMenuRef} className="absolute right-0 top-full z-30 min-w-[140px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      setChatMenuOpen(null);
                                      await hideConversation(opportunity.conversationId);
                                    }}
                                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50"
                                  >
                                    <Trash2 className="h-4 w-4" /> Hide
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : recentChats.length === 0 && refreshing ? (
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
        {mode === 'a2a' && (
          <div className="mt-3 border-t border-gray-100 pt-3">
            <button
              onClick={() => navigate('/negotiations')}
              className="text-[11px] font-ibm-plex-mono text-[#35799C] transition-colors hover:text-[#041729]"
            >
              View all in Negotiations inbox &rarr;
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
