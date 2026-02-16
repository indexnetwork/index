'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Compass, MessagesSquare, Settings, ChevronDown, User as UserIcon, LogIn, Library, History } from 'lucide-react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useXMTP } from '@/contexts/XMTPContext';
import { usePrivy } from '@privy-io/react-auth';
import { getAvatarUrl } from '@/lib/file-utils';
import { useIndexesState } from '@/contexts/IndexesContext';
import { useIndexes } from '@/contexts/APIContext';
import { useOpportunities } from '@/contexts/APIContext';
import { useNotifications } from '@/contexts/NotificationContext';
import ProfileSettingsModal from '@/components/modals/ProfileSettingsModal';
import PreferencesModal from '@/components/modals/PreferencesModal';
import CreateIndexModal from '@/components/modals/CreateIndexModal';


export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, refetchUser } = useAuthContext();
  const { isReady, humanChats, aiChats } = useXMTP();
  const { logout } = usePrivy();
  const indexesService = useIndexes();
  const opportunitiesService = useOpportunities();
  const { addIndex } = useIndexesState();
  const { success, error } = useNotifications();
  
  const [navigatingToChat, setNavigatingToChat] = useState(false);
  const [totalUnreadCount, setTotalUnreadCount] = useState(0);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [preferencesModalOpen, setPreferencesModalOpen] = useState(false);
  const [createIndexModalOpen, setCreateIndexModalOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const userDropdownRef = useRef<HTMLDivElement>(null);

  const isMessagesView = pathname === '/chat' || (pathname?.includes('/chat') && pathname?.startsWith('/u/'));
  const isLibraryView = pathname?.startsWith('/library');
  const isNetworksView = pathname?.startsWith('/networks');
  const isHistoryView = pathname?.startsWith('/d/');
  const isHomeView = !isMessagesView && !isLibraryView && !isNetworksView && !isHistoryView;

  // Get current AI session ID from pathname (e.g., /d/abc123 -> abc123)
  const currentSessionId = pathname?.match(/^\/d\/([^/]+)/)?.[1] || null;

  const handleCreateIndex = useCallback(async (indexData: { name: string; prompt?: string; joinPolicy?: 'anyone' | 'invite_only' }) => {
    try {
      const createRequest = {
        title: indexData.name,
        prompt: indexData.prompt,
        joinPolicy: indexData.joinPolicy
      };
      const newIndex = await indexesService.createIndex(createRequest);
      addIndex(newIndex);
      setCreateIndexModalOpen(false);
      success('Index created successfully');
    } catch (err) {
      console.error('Error creating index:', err);
      error('Failed to create index');
    }
  }, [indexesService, addIndex, success, error]);

  const handleDiscoverClick = () => {
    router.push('/');
  };

  const handleChatClick = async () => {
    if (!user?.id) {
      return;
    }

    setNavigatingToChat(true);
    try {
      // Conversation definition: at least one accepted opportunity between two users.
      const acceptedOpportunities = await opportunitiesService.getOpportunities({ status: 'accepted', limit: 300 });
      const latestByRecipient = new Map<string, number>();
      for (const opportunity of acceptedOpportunities) {
        const counterpart = opportunity.actors.find(
          (actor) => actor.userId !== user.id && actor.role !== 'introducer'
        ) ?? opportunity.actors.find((actor) => actor.userId !== user.id);
        if (!counterpart?.userId) continue;
        const ts = new Date(opportunity.updatedAt).getTime();
        const prev = latestByRecipient.get(counterpart.userId) ?? 0;
        if (ts > prev) latestByRecipient.set(counterpart.userId, ts);
      }

      const topConversation = Array.from(latestByRecipient.entries())
        .sort((a, b) => b[1] - a[1])[0];
      if (topConversation?.[0]) {
        router.push(`/u/${topConversation[0]}/chat`);
        return;
      }

      router.push('/chat');
    } catch (err) {
      console.error('Failed to fetch most recent chat:', err);
    } finally {
      setNavigatingToChat(false);
    }
  };



  // Track unread indicator from XMTP human chats
  // XMTP doesn't have built-in unread counts yet, so we use a simple
  // indicator: show a dot if there are any human chat conversations.
  useEffect(() => {
    if (!isReady) return;
    // For now, show the count of human chats as a simple indicator.
    // A proper unread system would track last-read timestamps per conversation.
    setTotalUnreadCount(humanChats.length > 0 ? humanChats.length : 0);
  }, [isReady, humanChats]);

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(event.target as Node)) {
        setUserDropdownOpen(false);
      }
    };
    if (userDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [userDropdownOpen]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Logo */}
      <div className="flex-shrink-0 px-4 py-6">
        <Link href="/">
          <Image
            src="/logos/logo-black-full.svg"
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
              ? 'bg-gray-100 text-black font-bold'
              : 'text-black font-medium hover:bg-gray-50'
          }`}
        >
          <Compass className="w-5 h-5" />
          Discover
        </button>

        <button
          onClick={handleChatClick}
          disabled={navigatingToChat}
          className={`relative w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
            isMessagesView
              ? 'bg-gray-100 text-black font-bold'
              : 'text-black font-medium hover:bg-gray-50'
          } ${navigatingToChat ? 'opacity-50 cursor-wait' : ''}`}
        >
          <MessagesSquare className="w-5 h-5" />
          <span className="flex-1 text-left">Chat</span>
          {totalUnreadCount > 0 && (
            <span className="bg-red-600 text-white text-xs px-2 py-0.5 rounded-full min-w-[20px] text-center">
              {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
            </span>
          )}
        </button>

        {/* History menu item with submenu */}
        <div>
          <button
            onClick={() => setHistoryExpanded(!historyExpanded)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
              isHistoryView
                ? 'bg-gray-100 text-black font-bold'
                : 'text-black font-medium hover:bg-gray-50'
            }`}
          >
            <History className="w-5 h-5" />
            <span className="flex-1 text-left">History</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${historyExpanded ? 'rotate-180' : ''}`} />
          </button>

          {/* History submenu */}
          {historyExpanded && (
            <div className="mt-1 ml-8 space-y-0.5">
              {!isReady ? (
                <div className="text-sm text-gray-400 py-2">Loading...</div>
              ) : aiChats.length === 0 ? (
                <div className="text-sm text-gray-400 py-2">No conversations yet</div>
              ) : (
                aiChats.slice(0, 4).map((chat) => {
                  const isSelected = currentSessionId === chat.id;
                  return (
                    <button
                      key={chat.id}
                      onClick={() => router.push(`/d/${chat.id}`)}
                      className={`w-full text-left py-1.5 px-2 rounded-md text-sm transition-colors truncate ${
                        isSelected
                          ? 'bg-gray-100 text-black font-normal'
                          : 'text-black font-normal hover:bg-gray-50'
                      }`}
                    >
                      {chat.name || 'Untitled chat'}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* User Profile with Dropdown - always at bottom */}
      {user && (
        <div className="flex-shrink-0 px-4 py-4 relative" ref={userDropdownRef}>
          <button
            onClick={() => setUserDropdownOpen(!userDropdownOpen)}
            className="w-full flex items-center gap-3 hover:bg-gray-50 rounded-md p-2 -m-2 transition-colors"
          >
            <Image
              src={getAvatarUrl(user)}
              alt={user.name || 'User'}
              width={40}
              height={40}
              className="rounded-full flex-shrink-0"
            />
            <div className="flex-1 min-w-0 text-left">
              <div className="text-sm font-medium text-black truncate">
                {user.name}
              </div>
              <div className="text-xs text-gray-500">
                Member
              </div>
            </div>
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${userDropdownOpen ? 'rotate-180' : ''}`} />
          </button>

          {userDropdownOpen && (
            <div className="absolute bottom-full left-4 right-4 mb-2 bg-white border border-[#E9E9E9] rounded-sm z-50">
              <div className="py-1">
                <button
                  className="w-full px-4 py-2 text-left text-gray-800 hover:bg-gray-50 flex items-center text-sm"
                  onClick={() => {
                    setUserDropdownOpen(false);
                    router.push('/networks');
                  }}
                >
                  <Compass className="h-4 w-4 mr-2" />
                  Networks
                </button>
                <button
                  className={`w-full px-4 py-2 text-left flex items-center text-sm ${
                    isLibraryView 
                      ? 'text-gray-800 bg-gray-100 font-medium' 
                      : 'text-gray-800 hover:bg-gray-50'
                  }`}
                  onClick={() => {
                    setUserDropdownOpen(false);
                    router.push('/library');
                  }}
                >
                  <Library className="h-4 w-4 mr-2" />
                  Library
                </button>
                <button
                  className="w-full px-4 py-2 text-left text-gray-800 hover:bg-gray-50 flex items-center text-sm"
                  onClick={() => {
                    setUserDropdownOpen(false);
                    setIsProfileModalOpen(true);
                  }}
                >
                  <UserIcon className="h-4 w-4 mr-2" />
                  Profile Settings
                </button>
                <button
                  className="w-full px-4 py-2 text-left text-gray-800 hover:bg-gray-50 flex items-center text-sm"
                  onClick={() => {
                    setUserDropdownOpen(false);
                    setPreferencesModalOpen(true);
                  }}
                >
                  <Settings className="h-4 w-4 mr-2" />
                  Preferences
                </button>
                <div className="border-t border-[#E9E9E9] my-1" />
                <button
                  className="w-full px-4 py-2 text-left text-red-600 hover:bg-red-50 hover:text-red-700 flex items-center transition-colors text-sm"
                  onClick={() => {
                    setUserDropdownOpen(false);
                    logout();
                  }}
                >
                  <LogIn className="h-4 w-4 mr-2" />
                  Logout
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Profile Settings Modal */}
      <ProfileSettingsModal
        open={isProfileModalOpen}
        onOpenChange={setIsProfileModalOpen}
        user={user}
        onUserUpdate={async () => {
          await refetchUser();
        }}
      />

      {/* Preferences Modal */}
      <PreferencesModal
        open={preferencesModalOpen}
        onOpenChange={setPreferencesModalOpen}
        user={user}
        onUserUpdate={async () => {
          await refetchUser();
        }}
      />

      {/* Create Index Modal */}
      <CreateIndexModal
        open={createIndexModalOpen}
        onOpenChange={setCreateIndexModalOpen}
        onSubmit={handleCreateIndex}
      />
    </div>
  );
}
