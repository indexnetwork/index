import { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { MoreHorizontal, Trash2, Bot } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';
import { useAuthContext } from '@/contexts/AuthContext';
import { useConversation } from '@/contexts/ConversationContext';

interface RecentChat {
  groupId: string;
  peerUserId: string | null;
  peerAvatar: string | null;
  name: string;
  lastMessage: string;
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

  const [loading, setLoading] = useState(true);
  const [chatMenuOpen, setChatMenuOpen] = useState<string | null>(null);
  const chatMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    refreshConversations().finally(() => setLoading(false));
  }, [user?.id, refreshConversations]);

  // Only show human-to-human DMs (no agent participants); agent chats appear in History sidebar
  const dmConversations = conversations.filter((conv) => {
    const participants = conv.participants ?? [];
    return participants.length === 2 && participants.every((p) => p.participantType === 'user');
  });
  const recentChats: RecentChat[] = dmConversations.map((conv) => {
    const peer = (conv.participants ?? []).find((p) => p.participantId !== user?.id && p.participantType === 'user');
    const lastText = (conv.lastMessage?.parts as { text?: string }[] | undefined)?.find(p => p.text)?.text ?? '';
    return {
      groupId: conv.id,
      peerUserId: peer?.participantId ?? null,
      peerAvatar: peer?.avatar ?? null,
      name: conv.metadata?.title ?? peer?.name ?? 'Conversation',
      lastMessage: lastText,
      sortTimestamp: conv.lastMessageAt ? new Date(conv.lastMessageAt).getTime() : 0,
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="lg:hidden px-4 py-3 min-h-[68px] flex items-center gap-3">
        <button onClick={() => navigate('/')} className="text-[#3D3D3D] hover:text-black transition-colors text-xl mr-2">&larr;</button>
        <h2 className="text-lg font-bold text-black font-ibm-plex-mono">Conversations</h2>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pt-4 lg:pt-4">
        <h3 className="hidden lg:block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 font-ibm-plex-mono">
          Conversations
        </h3>
        {loading ? (
          <div className="text-sm text-gray-400">Loading...</div>
        ) : (
          <div className="space-y-1">
            {/* Copilot entry — always visible */}
            <div
              className={`relative flex items-center py-2 px-2 -mx-2 rounded-md transition-colors hover:bg-gray-50 ${pathname === '/chat/copilot' ? 'bg-gray-100' : ''}`}
            >
              <button
                onClick={() => navigate('/chat/copilot')}
                className="flex-1 flex items-center gap-3 text-sm text-left min-w-0 text-gray-700 hover:text-black"
              >
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-black flex items-center justify-center">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-black">Copilot</p>
                  <p className="truncate text-sm font-normal text-gray-500">Your private AI assistant</p>
                </div>
              </button>
            </div>
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
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-black">{chat.name}</p>
                    <p className="truncate text-sm font-normal text-gray-500">
                      {chat.lastMessage.replace(/[*_~`#>]/g, '')}
                    </p>
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
