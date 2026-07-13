import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { Link } from 'react-router';
import { Compass, MessagesSquare, ChevronDown, Settings, LogOut, History, Network, Bot, BotMessageSquare, Brain, CircleHelp } from 'lucide-react';
import { useAuthContext } from '@/contexts/AuthContext';
import { useNetworkFilter } from '@/contexts/IndexFilterContext';
import { useAIChatSessions } from '@/contexts/AIChatSessionsContext';
import { useAIChat } from '@/contexts/AIChatContext';
import { useConversation } from '@/contexts/ConversationContext';
import { apiClient } from '@/lib/api';
import UserAvatar from '@/components/UserAvatar';
import { useNetworksState } from '@/contexts/IndexesContext';
import { useNetworks } from '@/contexts/APIContext';
import { useOpportunities } from '@/contexts/APIContext';
import { useNotifications } from '@/contexts/NotificationContext';
import CreateNetworkModal from '@/components/modals/CreateIndexModal';
import MasterKeyDialog from '@/components/MasterKeyDialog';
import { useQuestions } from '@/contexts/QuestionsContext';
import { log } from '@/lib/logger';

const logger = log.ui.from('Sidebar');


interface ChatSession {
  id: string;
  title: string | null;
  networkId: string | null;
  /** Canonical scope; intent-pinned negotiator sessions carry 'intent' (IND-403). */
  scopeType?: 'network' | 'intent' | null;
  createdAt: string;
  updatedAt: string;
}

export default function Sidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, features, signOut } = useAuthContext();
  useConversation();
  const totalUnreadCount = 0; // Unread tracking out of scope for now
  const { sessionsVersion } = useAIChatSessions();
  const { clearChat } = useAIChat();
  const { setSelectedNetworkIds } = useNetworkFilter();
  const indexesService = useNetworks();
  const opportunitiesService = useOpportunities();
  const { indexes, addIndex } = useNetworksState();
  const { success, error } = useNotifications();

  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [navigatingToChat, setNavigatingToChat] = useState(false);
  const [createIndexModalOpen, setCreateIndexModalOpen] = useState(false);
  const [masterKeyModal, setMasterKeyModal] = useState<{ networkId: string; masterKey: string } | null>(null);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const userDropdownRef = useRef<HTMLDivElement>(null);
  const { count: pendingQuestionsCount } = useQuestions();

  // Pinned negotiator DM (IND-411). Flag-gated: the entry renders only when
  // the backend reports the negotiator chat feature enabled on /auth/me.
  const negotiatorEnabled = features?.negotiatorChat === true;
  const [negotiatorSession, setNegotiatorSession] = useState<{ id: string; title: string | null } | null>(null);
  const [openingNegotiator, setOpeningNegotiator] = useState(false);

  // Get current AI session ID from pathname (e.g., /d/abc123 -> abc123)
  const currentSessionId = pathname?.match(/^\/d\/([^/]+)/)?.[1] || null;

  const isMessagesView = pathname === '/chat' || (pathname?.includes('/chat') && pathname?.startsWith('/u/'));
  const isNetworksView = pathname?.startsWith('/networks');
  const isNegotiatorView = !!negotiatorSession && currentSessionId === negotiatorSession.id;
  const isHistoryView = pathname?.startsWith('/d/') && !isNegotiatorView;
  const isSettingsView = pathname?.startsWith('/settings');
  const isAgentsView = pathname?.startsWith('/agents') || pathname?.startsWith('/agent');
  const isMyNetworkView = pathname?.startsWith('/mynetwork');
  const isQuestionsView = pathname?.startsWith('/questions');
  const isHomeView = !isMessagesView && !isNetworksView && !isHistoryView && !isNegotiatorView && !isSettingsView && !isAgentsView && !isMyNetworkView && !isQuestionsView;

  const handleCreateIndex = useCallback(async (indexData: { name: string; prompt?: string; imageUrl?: string | null; joinPolicy?: 'anyone' | 'invite_only'; isExperiment?: boolean; type?: 'community' | 'event'; metadata?: Record<string, unknown> }) => {
    try {
      const createRequest = {
        title: indexData.name,
        prompt: indexData.prompt,
        imageUrl: indexData.imageUrl,
        joinPolicy: indexData.joinPolicy,
        isExperiment: indexData.isExperiment,
        type: indexData.type,
        metadata: indexData.metadata,
      };
      const newIndex = await indexesService.createNetwork(createRequest);
      const { masterKey, ...network } = newIndex;
      addIndex(network);
      setCreateIndexModalOpen(false);
      if (masterKey) {
        setMasterKeyModal({ networkId: network.id, masterKey });
      } else {
        success('Index created successfully');
      }
    } catch (err) {
      logger.error('Error creating index', { error: err });
      error('Failed to create network');
    }
  }, [indexesService, addIndex, success, error]);

  const handleDiscoverClick = () => {
    clearChat({ abortStream: false });
    setSelectedNetworkIds([]);
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
      logger.error('Failed to fetch most recent chat', { error: err });
    } finally {
      setNavigatingToChat(false);
    }
  };

  // Resolve the existing negotiator DM (if bootstrapped) so the pinned entry
  // can show the agent's name and highlight when active — without creating a
  // session as a side effect of rendering the sidebar.
  useEffect(() => {
    if (!user?.id || !negotiatorEnabled) return;
    let active = true;
    apiClient
      .get<{ sessions: ChatSession[] }>('/chat/sessions?persona=negotiator')
      .then((data) => {
        if (!active) return;
        // The pinned entry is the unscoped DM — intent-pinned negotiator
        // sessions (IND-403) also carry persona=negotiator but have a scope.
        const session = data.sessions?.find((s) => !s.scopeType);
        if (session) setNegotiatorSession({ id: session.id, title: session.title });
      })
      .catch((error) => {
        logger.error('Failed to fetch negotiator session', { error });
      });
    return () => { active = false; };
  }, [user?.id, negotiatorEnabled]);

  // One persistent DM per user: get-or-create on click, then navigate to the
  // regular session route. Repeat clicks and reloads land in the same session.
  const handleNegotiatorClick = async () => {
    if (!user?.id || openingNegotiator) return;
    if (negotiatorSession) {
      navigate(`/d/${negotiatorSession.id}`);
      return;
    }
    setOpeningNegotiator(true);
    try {
      const { session, agent } = await apiClient.post<{
        session: { id: string; title: string | null };
        created: boolean;
        agent: { id: string; name: string; description: string | null };
      }>('/chat/negotiator/session');
      setNegotiatorSession({ id: session.id, title: session.title ?? agent.name });
      navigate(`/d/${session.id}`);
    } catch (err) {
      logger.error('Failed to open negotiator chat', { error: err });
      error('Failed to open Personal Agent chat');
    } finally {
      setOpeningNegotiator(false);
    }
  };

  // Canonical branding: the pinned entry is "Personal Agent" unless the
  // session carries the agent's real name (e.g. "Ada's Negotiator").
  const negotiatorLabel = negotiatorSession?.title || 'Personal Agent';

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
        logger.error('Failed to fetch chat sessions', { error });
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

        {/* Pinned Personal Agent DM (IND-411) — flag-gated, above History; a
            pinned surface, not a history entry (backend excludes it from
            /chat/sessions). */}
        {negotiatorEnabled && (
          <div
            className={`group flex items-center rounded-md transition-colors ${
              isNegotiatorView ? 'bg-gray-100' : 'hover:bg-gray-50'
            }`}
          >
          <button
            onClick={handleNegotiatorClick}
            disabled={openingNegotiator}
            className={`min-w-0 flex-1 flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-black ${
              isNegotiatorView ? 'font-bold' : 'font-medium'
            } ${openingNegotiator ? 'opacity-50 cursor-wait' : ''}`}
          >
            <BotMessageSquare className="w-5 h-5" />
            <span className="flex-1 text-left truncate">{negotiatorLabel}</span>
            {/* Pending question inbox count (IND-404) — the DM surfaces the
                same open questions the Questions page lists. */}
            {pendingQuestionsCount > 0 && (
              <span
                data-testid="negotiator-question-badge"
                className="bg-[#041729] text-white text-xs px-2 py-0.5 rounded-full min-w-[20px] text-center"
              >
                {pendingQuestionsCount > 99 ? '99+' : pendingQuestionsCount}
              </span>
            )}
          </button>
          {/* Memory shortcut — everything the agent remembers is inspectable
              at /agent/memory (P5.4); revealed on hover to keep the row calm. */}
          <button
            onClick={() => navigate('/agent/memory')}
            aria-label="Personal Agent memory"
            data-testid="negotiator-memory-link"
            className="p-1.5 mr-1.5 rounded text-gray-400 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-black transition-opacity"
          >
            <Brain className="w-4 h-4" />
          </button>
          </div>
        )}

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
                chatSessions.filter((session) => session.id !== negotiatorSession?.id).map((session) => {
                  const isSelected = currentSessionId === session.id;
                  const sessionIndex = session.networkId ? indexes.find(i => i.id === session.networkId) : null;
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

        {/* Questions — links to the dedicated Questions page. */}
        {pendingQuestionsCount > 0 && (
          <button
            type="button"
            onClick={() => navigate('/questions')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
              isQuestionsView
                ? 'bg-gray-100 text-black font-bold'
                : 'text-black font-medium hover:bg-gray-50'
            }`}
          >
            <CircleHelp className="w-5 h-5" />
            <span className="flex-1 text-left">Questions</span>
            <span className="bg-[#041729] text-white text-xs px-2 py-0.5 rounded-full min-w-[20px] text-center">
              {pendingQuestionsCount > 99 ? '99+' : pendingQuestionsCount}
            </span>
          </button>
        )}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />



      {/* Networks & Agent - above user dropdown */}
      <nav className="flex-shrink-0 px-2 space-y-1 pb-2">
        <button
          onClick={() => navigate('/networks')}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
            isNetworksView ? 'bg-gray-100 text-black font-bold' : 'text-black font-medium hover:bg-gray-50'
          }`}
        >
          <Network className="w-5 h-5" />
          Networks
        </button>
        <button
          onClick={() => navigate('/agent')}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${
            isAgentsView ? 'bg-gray-100 text-black font-bold' : 'text-black font-medium hover:bg-gray-50'
          }`}
        >
          <Bot className="w-5 h-5" />
          Agent
        </button>
      </nav>

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
              <div className="py-1.5">
                <button
                  className={`w-full px-4 py-2 text-left flex items-center gap-2.5 text-sm transition-colors ${
                    isSettingsView ? 'text-black font-medium bg-gray-50' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                  onClick={() => { setUserDropdownOpen(false); navigate('/settings'); }}
                >
                  <Settings className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  Settings
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

      {/* Create Network Modal */}
      <CreateNetworkModal
        open={createIndexModalOpen}
        onOpenChange={setCreateIndexModalOpen}
        onSubmit={handleCreateIndex}
        uploadIndexImage={indexesService.uploadIndexImage}
      />

      <MasterKeyDialog
        open={!!masterKeyModal}
        masterKey={masterKeyModal?.masterKey ?? ''}
        onClose={() => {
          const networkId = masterKeyModal?.networkId;
          setMasterKeyModal(null);
          if (networkId) navigate(`/networks/${networkId}`);
        }}
      />
    </div>
  );
}
