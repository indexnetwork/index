'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Compass, MessageCircle, Settings, MoreHorizontal, Trash2, Loader2 } from 'lucide-react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useStreamChat } from '@/contexts/StreamChatContext';
import { useAIChatSessions } from '@/contexts/AIChatSessionsContext';
import { useAIChat } from '@/contexts/AIChatContext';
import { usePrivy } from '@privy-io/react-auth';
import { useTheme } from 'next-themes';
import { getAvatarUrl } from '@/lib/file-utils';
import { Channel } from 'stream-chat';
import ProfileSettingsModal from '@/components/modals/ProfileSettingsModal';

interface ChatSession {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RecentChat {
  id: string;
  recipientId: string;
  name: string;
  avatar: string | null;
  lastMessage: string;
}

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuthContext();
  const { client, isReady } = useStreamChat();
  const { sessionsVersion } = useAIChatSessions();
  const { clearChat } = useAIChat();
  const { getAccessToken } = usePrivy();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const logoSrc = mounted && resolvedTheme === 'dark' 
    ? "/logos/logo-white-full.svg" 
    : "/logos/logo-black-full.svg";
  
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [recentChats, setRecentChats] = useState<RecentChat[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [navigatingToChat, setNavigatingToChat] = useState(false);
  const [totalUnreadCount, setTotalUnreadCount] = useState(0);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const { updateUser } = useAuthContext();
  const [chatMenuOpen, setChatMenuOpen] = useState<string | null>(null);
  const [deletingChat, setDeletingChat] = useState<string | null>(null);
  const chatMenuRef = useRef<HTMLDivElement>(null);

  const isMessagesView = pathname?.includes('/chat') && pathname?.startsWith('/u/');
  const isHomeView = !isMessagesView;
  
  // Extract current chat user ID from pathname (e.g., /u/abc123/chat -> abc123)
  const currentChatUserId = pathname?.match(/^\/u\/([^/]+)\/chat/)?.[1] || null;
  
  // Get current AI session ID from URL params
  const currentSessionId = searchParams?.get('sessionId') || null;

  const handleDiscoverClick = () => {
    clearChat();
    router.push('/');
  };

  const handleChatClick = async () => {
    if (!isReady || !client) {
      return;
    }

    setNavigatingToChat(true);
    try {
      const filter = {
        type: 'messaging',
        members: { $in: [client.userID || ''] },
      };
      const sort = [{ last_message_at: -1 as const }];
      const channels = await client.queryChannels(filter, sort, {
        limit: 1,
        watch: false,
        state: true,
      });

      if (channels.length > 0) {
        const channel = channels[0];
        const members = Object.values(channel.state.members || {});
        const otherMember = members.find(m => m.user_id !== client.userID);
        const recipientId = otherMember?.user?.id;
        
        if (recipientId) {
          router.push(`/u/${recipientId}/chat`);
        }
      }
    } catch (error) {
      console.error('Failed to fetch most recent chat:', error);
    } finally {
      setNavigatingToChat(false);
    }
  };

  // Fetch AI chat sessions
  useEffect(() => {
    if (!isHomeView) return;
    
    const fetchSessions = async () => {
      try {
        setLoadingSessions(true);
        const token = await getAccessToken();
        if (!token) return;
        
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL_V2}/v2/chat/sessions`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to fetch sessions');
        const data = await res.json() as { sessions: ChatSession[] };
        setChatSessions(data.sessions.slice(0, 5));
      } catch (error) {
        console.error('Failed to fetch chat sessions:', error);
      } finally {
        setLoadingSessions(false);
      }
    };

    fetchSessions();
  }, [isHomeView, sessionsVersion, getAccessToken]);

  // Fetch user-to-user chats when on messages view
  useEffect(() => {
    if (!isMessagesView || !isReady || !client) return;
    
    const fetchChats = async () => {
      try {
        setLoadingChats(true);
        const filter = {
          type: 'messaging',
          members: { $in: [client.userID || ''] },
        };
        const sort = [{ last_message_at: -1 as const }];
        const channels = await client.queryChannels(filter, sort, {
          limit: 5,
          watch: false,
          state: true,
        });

        const chats: RecentChat[] = channels.map((channel: Channel) => {
          const members = Object.values(channel.state.members || {});
          const otherMember = members.find(m => m.user_id !== client.userID);
          const otherUser = otherMember?.user;
          return {
            id: channel.id || '',
            recipientId: otherUser?.id || '',
            name: otherUser?.name || 'Unknown',
            avatar: otherUser?.image || null,
            lastMessage: channel.state.messages?.[channel.state.messages.length - 1]?.text || '',
          };
        }).filter((chat: RecentChat) => chat.recipientId);

        setRecentChats(chats);
      } catch (error) {
        console.error('Failed to fetch chats:', error);
      } finally {
        setLoadingChats(false);
      }
    };

    fetchChats();
  }, [isMessagesView, isReady, client]);

  // Track unread message count
  useEffect(() => {
    if (!isReady || !client) return;

    const fetchUnreadCount = async () => {
      try {
        const filter = {
          type: 'messaging',
          members: { $in: [client.userID || ''] },
        };
        const channels = await client.queryChannels(filter, {}, {
          watch: true,
          state: true,
        });
        
        const total = channels.reduce((sum, ch) => sum + (ch.state.unreadCount || 0), 0);
        setTotalUnreadCount(total);
      } catch (error) {
        console.error('Failed to fetch unread count:', error);
      }
    };

    fetchUnreadCount();

    // Listen for message events to update unread count
    const handleEvent = () => fetchUnreadCount();
    client.on('message.new', handleEvent);
    client.on('message.read', handleEvent);
    client.on('notification.mark_read', handleEvent);

    return () => {
      client.off('message.new', handleEvent);
      client.off('message.read', handleEvent);
      client.off('notification.mark_read', handleEvent);
    };
  }, [isReady, client]);

  // Close chat menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (chatMenuRef.current && !chatMenuRef.current.contains(event.target as Node)) {
        setChatMenuOpen(null);
      }
    };
    if (chatMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [chatMenuOpen]);

  const handleDeleteChat = async (channelId: string, chatName: string) => {
    if (!client || deletingChat) return;
    setDeletingChat(channelId);
    try {
      const channel = client.channel('messaging', channelId);
      await channel.delete();
      setRecentChats(prev => prev.filter(c => c.id !== channelId));
      setChatMenuOpen(null);
    } catch (error) {
      console.error('Failed to delete chat:', error);
    } finally {
      setDeletingChat(null);
    }
  };

  return (
    <div className="flex flex-col h-full font-ibm-plex-mono overflow-hidden">
      {/* Logo */}
      <div className="flex-shrink-0 px-4 py-6">
        <Link href="/">
          <Image
            src={logoSrc}
            alt="Index Network"
            width={160}
            height={28}
            className="object-contain"
          />
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-shrink-0 px-2 space-y-1">
        <button
          onClick={handleDiscoverClick}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
            isHomeView
              ? 'bg-muted text-foreground font-medium'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          }`}
        >
          <Compass className="w-5 h-5" />
          Discover
        </button>

        <button
          onClick={handleChatClick}
          disabled={navigatingToChat}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
            isMessagesView
              ? 'bg-muted text-foreground font-medium'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          } ${navigatingToChat ? 'opacity-50 cursor-wait' : ''}`}
        >
          <MessageCircle className="w-5 h-5" />
          <span className="flex-1 text-left">Chat</span>
          {totalUnreadCount > 0 && (
            <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full min-w-[20px] text-center">
              {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
            </span>
          )}
        </button>
      </nav>

      {/* Recent Section - fixed height, no scroll */}
      <div className="flex-shrink-0 mt-8 px-4">
        {isHomeView && (
          <>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Recent
              </h3>
            </div>
            {loadingSessions ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : chatSessions.length === 0 ? (
              <div className="text-sm text-muted-foreground">No conversations yet</div>
            ) : (
              <div className="space-y-1">
                {chatSessions.slice(0, 4).map((session) => {
                  const isSelected = currentSessionId === session.id;
                  return (
                    <button
                      key={session.id}
                      onClick={() => router.push(`/?sessionId=${session.id}`)}
                      className={`w-full text-left py-2 px-2 -mx-2 rounded-md text-sm transition-colors truncate ${
                        isSelected
                          ? 'bg-muted text-foreground font-medium'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                      }`}
                    >
                      {session.title || 'Untitled conversation'}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {isMessagesView && (
          <>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Recent
            </h3>
            {loadingChats ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : recentChats.length === 0 ? (
              <div className="text-sm text-muted-foreground">No messages yet</div>
            ) : (
              <div className="space-y-1">
                {recentChats.slice(0, 4).map((chat) => {
                  const isSelected = currentChatUserId === chat.recipientId;
                  return (
                  <div 
                    key={chat.id} 
                    className={`relative group flex items-center py-2 px-2 -mx-2 rounded-md transition-colors ${
                      isSelected 
                        ? 'bg-muted' 
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <button
                      onClick={() => router.push(`/u/${chat.recipientId}/chat`)}
                      className={`flex-1 flex items-center gap-3 text-sm text-left ${
                        isSelected 
                          ? 'text-foreground font-medium' 
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      <Image
                        src={getAvatarUrl({ avatar: chat.avatar, id: chat.recipientId, name: chat.name })}
                        alt={chat.name}
                        width={28}
                        height={28}
                        className="rounded-full flex-shrink-0"
                      />
                      <span className="truncate">{chat.name}</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setChatMenuOpen(chatMenuOpen === chat.id ? null : chat.id);
                      }}
                      className="p-1 opacity-0 group-hover:opacity-100 hover:bg-muted rounded transition-all flex-shrink-0"
                    >
                      <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                    </button>
                    {chatMenuOpen === chat.id && (
                      <div 
                        ref={chatMenuRef}
                        className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg dark:shadow-none py-1 min-w-[140px] z-30"
                      >
                        <button
                          onClick={() => handleDeleteChat(chat.id, chat.name)}
                          disabled={deletingChat === chat.id}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors disabled:opacity-50"
                        >
                          {deletingChat === chat.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* User Profile - always at bottom */}
      {user && (
        <div className="flex-shrink-0 px-4 py-4">
          <button
            onClick={() => setIsProfileModalOpen(true)}
            className="w-full flex items-center gap-3 hover:bg-muted/50 rounded-md p-2 -m-2 transition-colors"
          >
            <Image
              src={getAvatarUrl(user)}
              alt={user.name || 'User'}
              width={40}
              height={40}
              className="rounded-full flex-shrink-0"
            />
            <div className="flex-1 min-w-0 text-left">
              <div className="text-sm font-medium text-foreground truncate">
                {user.name}
              </div>
              <div className="text-xs text-muted-foreground">
                Member
              </div>
            </div>
            <Settings className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
      )}

      {/* Profile Settings Modal */}
      <ProfileSettingsModal
        open={isProfileModalOpen}
        onOpenChange={setIsProfileModalOpen}
        user={user}
        onUserUpdate={updateUser}
      />
    </div>
  );
}
