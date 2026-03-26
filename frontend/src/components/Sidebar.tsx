import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { Link } from 'react-router';
import { Compass, MessagesSquare, ChevronDown, User as UserIcon, LogOut, Library, History, Network, Bot } from 'lucide-react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useIndexFilter } from '@/contexts/IndexFilterContext';
import { useAIChatSessions } from '@/contexts/AIChatSessionsContext';
import { useAIChat } from '@/contexts/AIChatContext';
import { useConversation } from '@/contexts/ConversationContext';
import { apiClient } from '@/lib/api';
import UserAvatar from '@/components/UserAvatar';
import { useIndexesState } from '@/contexts/IndexesContext';
import { useIndexes } from '@/contexts/APIContext';
import { useOpportunities } from '@/contexts/APIContext';
import { useNotifications } from '@/contexts/NotificationContext';
import CreateIndexModal from '@/components/modals/CreateIndexModal';


interface ChatSession {
  id: string;
  title: string | null;
  indexId: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function Sidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, signOut } = useAuthContext();
  const { isConnected } = useConversation();
  const totalUnreadCount = 0; // Unread tracking out of scope for now
  const { sessionsVersion } = useAIChatSessions();
  const { clearChat } = useAIChat();
  const { setSelectedIndexIds } = useIndexFilter();
  const indexesService = useIndexes();
  const opportunitiesService = useOpportunities();
  const { indexes, addIndex } = useIndexesState();
  const { success, error } = useNotifications();
  
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [navigatingToChat, setNavigatingToChat] = useState(false);
  const [createIndexModalOpen, setCreateIndexModalOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const userDropdownRef = useRef<HTMLDivElement>(null);

  const isMessagesView = pathname === '/chat' || (pathname?.includes('/chat') && pathname?.startsWith('/u/'));
  const isLibraryView = pathname?.startsWith('/library');
  const isNetworksView = pathname?.startsWith('/networks');
  const isHistoryView = pathname?.startsWith('/d/');
  const isProfileView = pathname?.startsWith('/profile');
  const isAgentView = pathname?.startsWith('/agent');
  const isMyNetworkView = pathname?.startsWith('/mynetwork');
  const isHomeView = !isMessagesView && !isLibraryView && !isNetworksView && !isHistoryView && !isProfileView && !isAgentView && !isMyNetworkView;

  // Get current AI session ID from pathname (e.g., /d/abc123 -> abc123)
  const currentSessionId = pathname?.match(/^\/d\/([^/]+)/)?.[1] || null;

  const handleCreateIndex = useCallback(async (indexData: { name: string; prompt?: string; imageUrl?: string | null; joinPolicy?: 'anyone' | 'invite_only' }) => {
    try {
      const createRequest = {
        title: indexData.name,
        prompt: indexData.prompt,
        imageUrl: indexData.imageUrl,
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
    clearChat({ abortStream: false });
    setSelectedIndexIds([]);
    navigate('/');
  };

  const handleChatClick = async () => {
    if (!user?.id) {
      return;
    }

    // Browser notifications will be handled by XMTP context

    const isMobile = typeof window !== 'undefined' && !window.matchMedia('(min-width: 1024px)').matches;
    if (isMobile) {
      navigate('/chat');
      return;
    }

    setNavigatingToChat(true);
    try {
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
        navigate(`/u/${topConversation[0]}/chat`);
        return;
      }

      navigate('/chat');
    } catch (err) {
      console.error('Failed to fetch most recent chat:', err);
    } finally {
      setNavigatingToChat(false);
    }
  };

  // Fetch AI chat sessions (cookie-based auth; credentials sent automatically)
  useEffect(() => {
    if (!user?.id) return;

    const isInitialLoad = sessionsVersion === 0;
    const fetchSessions = async () => {
      try {
        if (isInitialLoad) setLoadingSessions(true);

        const data = await apiClient.get<{ sessions: ChatSession[] }>('/chat/sessions');
        setChatSessions(data.sessions.slice(0, 10));
      } catch (error) {
        console.error('Failed to fetch chat sessions:', error);
      } finally {
        if (isInitialLoad) setLoadingSessions(false);
      }
    };

    fetchSessions();
  }, [sessionsVersion, user?.id]);


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
        <Link to="/">
          <img
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
              {loadingSessions ? (
                <div className="text-sm text-gray-400 py-2">Loading...</div>
              ) : chatSessions.length === 0 ? (
                <div className="text-sm text-gray-400 py-2">No conversations yet</div>
              ) : (
                chatSessions.slice(0, 10).map((session) => {
                  const isSelected = currentSessionId === session.id;
                  const sessionIndex = session.indexId ? indexes.find(i => i.id === session.indexId) : null;
                  return (
                    <button
                      key={session.id}
                      onClick={() => navigate(`/d/${session.id}`)}
                      className={`w-full text-left py-1.5 px-2 rounded-md text-sm transition-colors flex items-center gap-1.5 ${
                        isSelected
                          ? 'bg-gray-100 text-black font-normal'
                          : 'text-black font-normal hover:bg-gray-50'
                      }`}
                    >
                      <span className="truncate flex-1">{session.title || 'Untitled chat'}</span>
                      {sessionIndex && (
                        <span className="shrink-0 text-[10px] text-gray-400 truncate max-w-[60px]" title={sessionIndex.title}>
                          {sessionIndex.title}
                        </span>
                      )}
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
            <UserAvatar
              id={user.id}
              name={user.name || 'User'}
              avatar={user.avatar}
              size={40}
              className="flex-shrink-0"
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
            <div className="absolute bottom-full left-4 right-4 mb-2 bg-white border border-gray-200 rounded-lg shadow-sm z-50 overflow-hidden">
              {/* Nav items */}
              <div className="py-1.5">
                <button
                  className={`w-full px-4 py-2 text-left flex items-center gap-2.5 text-sm transition-colors ${
                    isNetworksView ? 'text-black font-medium bg-gray-50' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                  onClick={() => { setUserDropdownOpen(false); navigate('/networks'); }}
                >
                  <Network className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  Networks
                </button>
                <button
                  className={`w-full px-4 py-2 text-left flex items-center gap-2.5 text-sm transition-colors ${
                    isAgentView ? 'text-black font-medium bg-gray-50' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                  onClick={() => { setUserDropdownOpen(false); navigate('/agent'); }}
                >
                  <Bot className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  Agent
                </button>
                <button
                  className={`w-full px-4 py-2 text-left flex items-center gap-2.5 text-sm transition-colors ${
                    isLibraryView ? 'text-black font-medium bg-gray-50' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                  onClick={() => { setUserDropdownOpen(false); navigate('/library'); }}
                >
                  <Library className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  Library
                </button>
                <button
                  className={`w-full px-4 py-2 text-left flex items-center gap-2.5 text-sm transition-colors ${
                    isProfileView ? 'text-black font-medium bg-gray-50' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                  onClick={() => { setUserDropdownOpen(false); navigate('/profile'); }}
                >
                  <UserIcon className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  Profile
                </button>
              </div>

              {/* Logout */}
              <div className="border-t border-gray-100 py-1.5">
                <button
                  className="w-full px-4 py-2 text-left flex items-center gap-2.5 text-sm text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors"
                  onClick={() => { setUserDropdownOpen(false); signOut(); }}
                >
                  <LogOut className="h-4 w-4 flex-shrink-0" />
                  Log out
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create Index Modal */}
      <CreateIndexModal
        open={createIndexModalOpen}
        onOpenChange={setCreateIndexModalOpen}
        onSubmit={handleCreateIndex}
        uploadIndexImage={indexesService.uploadIndexImage}
      />
    </div>
  );
}
