import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { Plus } from 'lucide-react';

import { apiClient } from '@/lib/api';
import { useAuthContext } from '@/contexts/AuthContext';
import { useAIChat } from '@/contexts/AIChatContext';
import { useAIChatSessions } from '@/contexts/AIChatSessionsContext';
import { useNetworksState } from '@/contexts/IndexesContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { log } from '@/lib/logger';

const logger = log.ui.from('AgentSessionsPanel');

interface ChatSession {
  id: string;
  title: string | null;
  networkId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Agent conversation switcher. Lists the user's agent chat sessions (from
 * /chat/sessions) and a "New conversation" action. Relocated from the retired sidebar so the Agent
 * view carries its own history. Shown in the shell aside on /agent and /d
 * routes.
 */
export default function AgentSessionsPanel() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, features } = useAuthContext();
  const { sessionsVersion } = useAIChatSessions();
  const { startReporterSession } = useAIChat();
  const { indexes } = useNetworksState();
  const { error } = useNotifications();

  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const reporterEnabled = features?.agentSurface === true;
  const [openingReporter, setOpeningReporter] = useState(false);

  const currentSessionId = pathname?.match(/^\/d\/([^/]+)/)?.[1] || null;

  useEffect(() => {
    if (!user?.id) return;
    const isInitialLoad = sessionsVersion === 0;
    const fetchSessions = async () => {
      try {
        if (isInitialLoad) setLoadingSessions(true);
        // Session-authenticated web history keeps legacy, Signal, and Reporter
        // conversations readable even when a persona flag is rolled back.
        const data = await apiClient.get<{ sessions: ChatSession[] }>('/chat/web/sessions');
        setChatSessions(data.sessions.slice(0, 20));
      } catch (err) {
        logger.error('Failed to fetch chat sessions', { error: err });
      } finally {
        if (isInitialLoad) setLoadingSessions(false);
      }
    };
    fetchSessions();
  }, [sessionsVersion, user?.id]);

  const handleNewConversation = async () => {
    if (!reporterEnabled) {
      navigate('/agent');
      return;
    }
    if (openingReporter) return;

    setOpeningReporter(true);
    const started = startReporterSession({ forceNew: true });
    // Navigation is immediate; AgentReporterSurface coalesces its mount call
    // with this in-flight reporter start instead of claiming a second session.
    navigate('/agent');
    try {
      if (!(await started)) error('Failed to start a fresh Agent briefing');
    } catch (err) {
      logger.error('Failed to start reporter conversation', { error: err });
      error('Failed to start a fresh Agent briefing');
    } finally {
      setOpeningReporter(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 px-4 py-4 border-b border-gray-100">
        <button
          onClick={() => void handleNewConversation()}
          disabled={openingReporter}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-black hover:bg-gray-50 transition-colors border border-gray-200 ${
            openingReporter ? 'opacity-50 cursor-wait' : ''
          }`}
        >
          <Plus className="w-4 h-4" />
          New conversation
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {loadingSessions ? (
          <div className="text-sm text-gray-400 py-4 px-3">Loading…</div>
        ) : chatSessions.length === 0 ? (
          <div className="text-sm text-gray-400 py-4 px-3">No conversations yet</div>
        ) : (
          chatSessions
            .map((session) => {
              const isSelected = currentSessionId === session.id;
              const sessionIndex = session.networkId ? indexes.find((i) => i.id === session.networkId) : null;
              return (
                <button
                  key={session.id}
                  onClick={() => navigate(`/d/${session.id}`)}
                  className={`w-full text-left py-2 px-3 rounded-md text-sm transition-colors flex items-center gap-1.5 ${
                    isSelected ? 'bg-gray-100 text-black font-medium' : 'text-black hover:bg-gray-50'
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
    </div>
  );
}
