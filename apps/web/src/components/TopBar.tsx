import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router';
import { ChevronDown, Settings, LogOut, Menu, X } from 'lucide-react';

import { useAuthContext } from '@/contexts/AuthContext';
import { useOpportunities } from '@/contexts/APIContext';
import { useAIChat } from '@/contexts/AIChatContext';
import { useNetworkFilter } from '@/contexts/IndexFilterContext';
import UserAvatar from '@/components/UserAvatar';
import { log } from '@/lib/logger';

const logger = log.ui.from('TopBar');

/**
 * Top navigation bar. Replaces the retired left sidebar: logo on the left
 * (links to Discover), primary nav (Signals / Chat / Networks / Agent) and the
 * profile menu on the right. Signals is the Discover home, also reachable via
 * the logo.
 */
export default function TopBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, signOut } = useAuthContext();
  const opportunitiesService = useOpportunities();
  const { clearChat } = useAIChat();
  const { setSelectedNetworkIds } = useNetworkFilter();

  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [navigatingToChat, setNavigatingToChat] = useState(false);
  const userDropdownRef = useRef<HTMLDivElement>(null);

  // Active-route detection ported from the sidebar so deep routes highlight.
  // Signals covers Discover (/) plus the signal detail and creation routes.
  const isSignalsView = pathname === '/' || pathname?.startsWith('/i/');
  const isMessagesView = pathname === '/chat' || (pathname?.includes('/chat') && pathname?.startsWith('/u/'));
  const isNetworksView = pathname?.startsWith('/networks');
  const isAgentView = pathname?.startsWith('/agent') || pathname?.startsWith('/d/');
  const isSettingsView = pathname?.startsWith('/settings');

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

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

  // Chat: open the most recent DM if there is one, else the conversation list.
  const handleChatClick = async () => {
    if (!user?.id) return;
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
          (actor) => actor.userId !== user.id && actor.role !== 'introducer',
        ) ?? opportunity.actors.find((actor) => actor.userId !== user.id);
        if (!counterpart?.userId) continue;
        const ts = new Date(opportunity.updatedAt).getTime();
        const prev = latestByRecipient.get(counterpart.userId) ?? 0;
        if (ts > prev) latestByRecipient.set(counterpart.userId, ts);
      }
      const topConversation = Array.from(latestByRecipient.entries()).sort((a, b) => b[1] - a[1])[0];
      if (topConversation?.[0]) {
        navigate(`/u/${topConversation[0]}/chat`);
        return;
      }
      navigate('/chat');
    } catch (err) {
      logger.error('Failed to fetch most recent chat', { error: err });
      navigate('/chat');
    } finally {
      setNavigatingToChat(false);
    }
  };

  const handleAgentClick = () => {
    clearChat({ abortStream: false });
    setSelectedNetworkIds([]);
    navigate('/agent');
  };

  const navItemClass = (active: boolean) =>
    `px-3 py-1.5 rounded-md text-sm transition-colors ${
      active ? 'bg-gray-100 text-black font-bold' : 'text-black font-medium hover:bg-gray-50'
    }`;

  const navItems = (
    <>
      <button onClick={() => navigate('/')} className={navItemClass(!!isSignalsView)}>
        Signals
      </button>
      <button
        onClick={handleChatClick}
        disabled={navigatingToChat}
        className={`${navItemClass(!!isMessagesView)} ${navigatingToChat ? 'opacity-50 cursor-wait' : ''}`}
      >
        Chat
      </button>
      <button onClick={() => navigate('/networks')} className={navItemClass(!!isNetworksView)}>
        Networks
      </button>
      <button onClick={handleAgentClick} className={navItemClass(!!isAgentView)}>
        Agent
      </button>
    </>
  );

  return (
    <header className="flex-shrink-0 sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-gray-200">
      <div className="flex items-center justify-between h-14 px-4 lg:px-6">
        {/* Logo → Discover */}
        <Link to="/" className="flex-shrink-0">
          <img
            src="/logos/logo-black-full.svg"
            alt="Index Network"
            width={140}
            height={24}
            className="object-contain"
          />
        </Link>

        {/* Desktop nav + profile */}
        <div className="hidden lg:flex items-center gap-1">
          {navItems}

          {user && (
            <div className="relative ml-2" ref={userDropdownRef}>
              <button
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                className="flex items-center gap-2 hover:bg-gray-50 rounded-md p-1.5 transition-colors"
              >
                <UserAvatar id={user.id} name={user.name || 'User'} avatar={user.avatar} size={32} className="flex-shrink-0" />
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${userDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {userDropdownOpen && (
                <div className="absolute top-full right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-sm z-50 overflow-hidden">
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
        </div>

        {/* Mobile: avatar + menu toggle */}
        <div className="flex lg:hidden items-center gap-2">
          {user && (
            <UserAvatar id={user.id} name={user.name || 'User'} avatar={user.avatar} size={30} className="flex-shrink-0" />
          )}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-md text-gray-700 hover:bg-gray-100"
            aria-label="Menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-gray-100 px-4 py-2 flex flex-col gap-1">
          {navItems}
          <button onClick={() => navigate('/settings')} className={navItemClass(!!isSettingsView) + ' text-left'}>
            Settings
          </button>
          <button
            onClick={() => signOut()}
            className="px-3 py-1.5 rounded-md text-sm text-left text-red-500 hover:bg-red-50 font-medium"
          >
            Log out
          </button>
        </div>
      )}
    </header>
  );
}
