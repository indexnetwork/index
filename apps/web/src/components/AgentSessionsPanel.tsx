import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { Plus, BotMessageSquare, Brain } from 'lucide-react';

import { apiClient } from '@/lib/api';
import { useAuthContext } from '@/contexts/AuthContext';
import { useAIChatSessions } from '@/contexts/AIChatSessionsContext';
import { useNetworksState } from '@/contexts/IndexesContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useQuestions } from '@/contexts/QuestionsContext';
import { log } from '@/lib/logger';

const logger = log.ui.from('AgentSessionsPanel');

interface ChatSession {
  id: string;
  title: string | null;
  networkId: string | null;
  /** Canonical scope; intent-pinned negotiator sessions carry 'intent' (IND-403). */
  scopeType?: 'network' | 'intent' | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Agent conversation switcher. Lists the user's agent chat sessions (from
 * /chat/sessions) with a pinned Personal Agent (negotiator) DM on top and a
 * "New conversation" action. Relocated from the retired sidebar so the Agent
 * view carries its own history. Shown in the shell aside on /agent and /d
 * routes.
 */
export default function AgentSessionsPanel() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, features } = useAuthContext();
  const { sessionsVersion } = useAIChatSessions();
  const { indexes } = useNetworksState();
  const { error } = useNotifications();
  const { personalAgentPending } = useQuestions();

  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const negotiatorEnabled = features?.negotiatorChat === true;
  const [negotiatorSession, setNegotiatorSession] = useState<{ id: string; title: string | null } | null>(null);
  const [openingNegotiator, setOpeningNegotiator] = useState(false);

  const currentSessionId = pathname?.match(/^\/d\/([^/]+)/)?.[1] || null;
  const isNegotiatorView = !!negotiatorSession && currentSessionId === negotiatorSession.id;

  // Resolve the existing negotiator DM (if bootstrapped) so the pinned entry can
  // show the agent's name and highlight when active — without creating one as a
  // side effect of rendering.
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
      .catch((err) => {
        logger.error('Failed to fetch negotiator session', { error: err });
      });
    return () => { active = false; };
  }, [user?.id, negotiatorEnabled]);

  // One persistent DM per user: get-or-create on click, then navigate.
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

  useEffect(() => {
    if (!user?.id) return;
    const isInitialLoad = sessionsVersion === 0;
    const fetchSessions = async () => {
      try {
        if (isInitialLoad) setLoadingSessions(true);
        const data = await apiClient.get<{ sessions: ChatSession[] }>('/chat/sessions');
        setChatSessions(data.sessions.slice(0, 20));
      } catch (err) {
        logger.error('Failed to fetch chat sessions', { error: err });
      } finally {
        if (isInitialLoad) setLoadingSessions(false);
      }
    };
    fetchSessions();
  }, [sessionsVersion, user?.id]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-shrink-0 px-4 py-4 border-b border-gray-100">
        <button
          onClick={() => navigate('/agent/chat')}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium text-black hover:bg-gray-50 transition-colors border border-gray-200"
        >
          <Plus className="w-4 h-4" />
          New conversation
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {negotiatorEnabled && (
          <div
            className={`group flex items-center rounded-md transition-colors ${
              isNegotiatorView ? 'bg-gray-100' : 'hover:bg-gray-50'
            }`}
          >
            <button
              onClick={handleNegotiatorClick}
              disabled={openingNegotiator}
              className={`min-w-0 flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm text-black ${
                isNegotiatorView ? 'font-bold' : 'font-medium'
              } ${openingNegotiator ? 'opacity-50 cursor-wait' : ''}`}
            >
              <BotMessageSquare className="w-4 h-4 shrink-0" />
              <span className="flex-1 text-left truncate">{negotiatorLabel}</span>
              {/* Personal Agent combines the global inbox with successfully
                  delivered pool pushes; the Questions page remains global-only. */}
              {personalAgentPending > 0 && (
                <span
                  data-testid="negotiator-question-badge"
                  className="bg-[#041729] text-white text-xs px-2 py-0.5 rounded-full min-w-[20px] text-center"
                >
                  {personalAgentPending > 99 ? '99+' : personalAgentPending}
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

        {loadingSessions ? (
          <div className="text-sm text-gray-400 py-4 px-3">Loading…</div>
        ) : chatSessions.filter((s) => s.id !== negotiatorSession?.id).length === 0 ? (
          <div className="text-sm text-gray-400 py-4 px-3">No conversations yet</div>
        ) : (
          chatSessions
            .filter((session) => session.id !== negotiatorSession?.id)
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
