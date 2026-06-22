import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Loader2, ArrowUp, MoreHorizontal, Trash2 } from 'lucide-react';
import { Link } from 'react-router';
import UserAvatar from '@/components/UserAvatar';
import GhostBadge from '@/components/GhostBadge';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn, formatChatDayLabel } from '@/lib/utils';
import { ContentContainer } from '@/components/layout';
import { useAuthContext } from '@/contexts/AuthContext';
import { useConversation } from '@/contexts/ConversationContext';
import { useOpportunities } from '@/contexts/APIContext';
import type { ChatContextOpportunity } from '@/services/opportunities';
import { buildChatTimeline } from './timeline';
import OpportunityDivider from './OpportunityDivider';

interface ChatViewProps {
  userId: string;
  userName: string;
  userAvatar?: string;
  isGhost?: boolean;
  initialGroupId?: string;
  /** Pre-fill the message input. */
  initialMessage?: string;
  /** If true, auto-send initialMessage when the conversation is ready instead of just prefilling. */
  autoSend?: boolean;
  /** Called once after the first message is successfully sent (used to accept a pending opportunity). */
  onFirstMessageSent?: () => void;
  onClose: () => void;
  onBack?: () => void;
}

export default function ChatView({ userId, userName, userAvatar, isGhost = false, initialGroupId, initialMessage, autoSend = false, onFirstMessageSent, onClose, onBack }: ChatViewProps) {
  const { user } = useAuthContext();
  const opportunitiesService = useOpportunities();
  const {
    messages: allMessages,
    sendMessage: conversationSend,
    loadMessages,
    getOrCreateDM,
    hideConversation,
  } = useConversation();

  const [conversationId, setConversationId] = useState<string | null>(initialGroupId ?? null);
  const [messageText, setMessageText] = useState(autoSend ? '' : (initialMessage ?? ''));
  const hasAutoSentRef = useRef(false);
  const hasFiredFirstMessageRef = useRef(false);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [contextLoading, setContextLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [acceptedOpportunities, setAcceptedOpportunities] = useState<ChatContextOpportunity[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Reset conversation state when userId changes (component reused by React Router)
  const prevUserIdRef = useRef(userId);
  useEffect(() => {
    if (prevUserIdRef.current !== userId) {
      prevUserIdRef.current = userId;
      setConversationId(null);
      setMessagesLoading(true);
      setContextLoading(true);
      setAcceptedOpportunities([]);
      hasAutoSentRef.current = false;
      hasFiredFirstMessageRef.current = false;
    }
  }, [userId]);

  const messages = useMemo(
    () => (conversationId ? allMessages.get(conversationId) ?? [] : []),
    [conversationId, allMessages],
  );

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    opportunitiesService
      .getChatContext(userId, { signal: controller.signal })
      .then((list) => {
        if (!controller.signal.aborted) setAcceptedOpportunities(list);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error('[ChatView] Failed to load chat context:', err);
      });
    return () => {
      controller.abort();
    };
  }, [userId, opportunitiesService]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load messages when we have a conversationId
  useEffect(() => {
    const cid = initialGroupId ?? conversationId;
    if (cid) {
      loadMessages(cid, { limit: 50 }).finally(() => setMessagesLoading(false));
    } else {
      // No conversation yet: clear the initial loading state via microtask
      // to satisfy react-hooks/set-state-in-effect.
      queueMicrotask(() => setMessagesLoading(false));
    }
  }, [initialGroupId, conversationId, loadMessages]);

  // Get or create DM conversation
  useEffect(() => {
    let mounted = true;
    const init = async () => {
      try {
        const conv = await getOrCreateDM(userId);
        if (!mounted) return;
        const cid = initialGroupId ?? conv.id;
        if (cid && !conversationId) setConversationId(cid);
      } catch (err) {
        console.error('[ChatView] DM init error:', err);
      } finally {
        if (mounted) setContextLoading(false);
      }
    };

    init();
    return () => { mounted = false; };
  }, [userId, initialGroupId, getOrCreateDM, conversationId]);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // Auto-resize textarea (handles both typing and prefilled values)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [messageText]);

  // Auto-send initialMessage once the conversation is ready (ghost invite flow only)
  useEffect(() => {
    if (!autoSend) return;
    if (hasAutoSentRef.current) return;
    if (!initialMessage?.trim()) return;
    if (contextLoading) return;

    const text = initialMessage.trim();
    hasAutoSentRef.current = true;
    (async () => {
      setSending(true);
      try {
        if (conversationId) {
          await conversationSend(conversationId, [{ text }]);
        } else {
          const conv = await getOrCreateDM(userId);
          setConversationId(conv.id);
          await conversationSend(conv.id, [{ text }]);
          loadMessages(conv.id, { limit: 50 });
        }
        if (!hasFiredFirstMessageRef.current) {
          hasFiredFirstMessageRef.current = true;
          onFirstMessageSent?.();
        }
      } catch (err) {
        hasAutoSentRef.current = false;
        console.error('[ChatView] Auto-send error:', err);
      } finally {
        setSending(false);
      }
    })();
  }, [autoSend, contextLoading, conversationId, initialMessage, conversationSend, getOrCreateDM, userId, loadMessages, onFirstMessageSent]);

  const handleSend = useCallback(async () => {
    if (!messageText.trim() || sending) return;
    const text = messageText.trim();
    setMessageText('');
    setSending(true);
    try {
      if (conversationId) {
        await conversationSend(conversationId, [{ text }]);
      } else {
        const conv = await getOrCreateDM(userId);
        setConversationId(conv.id);
        await conversationSend(conv.id, [{ text }]);
        loadMessages(conv.id, { limit: 50 });
      }
      if (!hasFiredFirstMessageRef.current) {
        hasFiredFirstMessageRef.current = true;
        onFirstMessageSent?.();
      }
      inputRef.current?.focus();
    } catch (err) {
      console.error('[ChatView] Send error:', err);
      setMessageText(text);
    } finally {
      setSending(false);
    }
  }, [conversationId, userId, messageText, sending, conversationSend, getOrCreateDM, loadMessages, onFirstMessageSent]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1 || e.key === 'Backspace') inputRef.current?.focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setShowMenu(false);
    };
    if (showMenu) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  const handleBack = () => { if (onBack) onBack(); else onClose(); };

  const formatTime = (createdAt: string) => {
    if (!createdAt) return '';
    return new Date(createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const timeline = useMemo(
    () => buildChatTimeline(messages, acceptedOpportunities),
    [messages, acceptedOpportunities],
  );

  return (
    <>
      {/* Header */}
      <div className="sticky top-0 bg-white z-10 px-4 py-3 flex items-center justify-between min-h-[68px]">
        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="text-[#3D3D3D] hover:text-black transition-colors text-xl mr-2">&larr;</button>
          <Link to={`/u/${userId}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <UserAvatar avatar={userAvatar} id={userId} name={userName} size={44} blur={isGhost} />
            <div>
              <h2 className="font-ibm-plex-mono font-bold text-lg text-black flex items-center gap-1.5">
                {userName}
                {isGhost && <GhostBadge />}
              </h2>
              {isGhost && <p className="text-xs text-gray-400 -mt-0.5">Not yet on Index</p>}
            </div>
          </Link>
        </div>
        <div className="relative" ref={menuRef}>
          <button onClick={() => setShowMenu(!showMenu)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
            <MoreHorizontal className="w-5 h-5 text-[#3D3D3D]" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px] z-20">
              <button
                onClick={async () => {
                  setShowMenu(false);
                  if (conversationId) await hideConversation(conversationId);
                  onClose();
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-4 h-4" /> Delete chat
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="px-6 lg:px-8 pb-32 flex-1">
        <ContentContainer>
          <div className="space-y-4">
            {messagesLoading ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
            ) : messages.length === 0 && !contextLoading && acceptedOpportunities.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-[#3D3D3D]">
                {isGhost ? (
                  <>
                    <p className="text-sm font-medium">{userName} hasn&apos;t joined Index yet.</p>
                    <p className="text-xs text-gray-400 mt-1">Send a message and we&apos;ll let you know when they join.</p>
                  </>
                ) : (
                  <p className="text-sm">Start a conversation with {userName}</p>
                )}
              </div>
            ) : null}

            {isGhost && messages.length > 0 && (
              <div className="text-center py-3">
                <p className="text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5 inline-block">
                  <span className="font-medium text-gray-500">{userName}</span> is invited by you &mdash; we&apos;ll let you know when they join Index.
                </p>
              </div>
            )}

            {timeline.map((item, index) => {
                const prev = timeline[index - 1];
                const showTimestamp =
                  item.type === 'message' &&
                  (index === 0 ||
                    (prev && prev.type === 'message' &&
                      new Date(item.at).getTime() - new Date(prev.at).getTime() > 300_000));

                if (item.type === 'opportunity') {
                  return (
                    <OpportunityDivider
                      key={`opp-${item.opportunities[0].opportunityId}`}
                      opportunities={item.opportunities}
                      defaultExpanded={messages.length === 0}
                    />
                  );
                }

                const message = item.message;
                const isOwn = message.senderId === user?.id;
                const textPart = (message.parts as { text?: string }[] | undefined)?.find((p) => p.text)?.text;
                const content = textPart ?? '';
                if (!content.trim()) return null;

                return (
                  <div key={message.id}>
                    {showTimestamp && message.createdAt && (
                      <div className="text-center text-xs text-gray-400 uppercase tracking-wider my-4">
                        {`${formatChatDayLabel(message.createdAt)}, ${formatTime(message.createdAt)}`}
                      </div>
                    )}
                    <div className={cn('flex items-end gap-2', isOwn ? 'justify-end' : 'justify-start')}>
                      {!isOwn && (
                        <Link to={`/u/${userId}`} className="flex-shrink-0">
                          <UserAvatar avatar={userAvatar} id={userId} name={userName} size={32} />
                        </Link>
                      )}
                      <div className={cn('max-w-[70%] rounded-2xl px-4 py-2', isOwn ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-900')}>
                        <article className={cn('text-sm', isOwn && 'text-white')}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                        </article>
                      </div>
                      {isOwn && (
                        <Link to={`/u/${user?.id}`} className="flex-shrink-0">
                          <UserAvatar avatar={user?.avatar} id={user?.id} name={user?.name} size={32} />
                        </Link>
                      )}
                    </div>
                  </div>
                );
            })}
            <div ref={messagesEndRef} />
          </div>
        </ContentContainer>
      </div>

      {/* Input */}
      <div className="sticky bottom-0 z-20">
        <div className="px-6 lg:px-8">
          <ContentContainer>
            <div className="bg-[linear-gradient(to_bottom,transparent_50%,#ffffff_50%)]">
              <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex items-end gap-3 bg-[#FCFCFC] border border-[#E9E9E9] rounded-4xl px-4 py-3">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder={`Type a message to ${userName}...`}
                  disabled={sending}
                  autoFocus
                  className="flex-1 bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 resize-none overflow-hidden leading-6 py-0.5 max-h-40"
                />
                <button
                  type="submit"
                  disabled={!messageText.trim() || sending}
                  className="shrink-0 h-8 w-8 rounded-full bg-[#041729] text-white flex items-center justify-center hover:bg-[#0a2d4a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </form>
            </div>
            <div className="bg-white py-2"></div>
          </ContentContainer>
        </div>
      </div>
    </>
  );
}
