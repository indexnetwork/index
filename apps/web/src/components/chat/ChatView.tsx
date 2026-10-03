import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { Link } from 'react-router';
import UserAvatar from '@/components/UserAvatar';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatChatClock, formatChatDayLabel } from '@/lib/utils';
import { useAuthContext } from '@/contexts/AuthContext';
import { useConversation } from '@/contexts/ConversationContext';
import { useOpportunities } from '@/contexts/APIContext';
import type { ChatContextOpportunity } from '@/services/opportunities';
import { buildChatTimeline } from './timeline';
import OpportunityDivider, { OpportunityDividerSkeleton } from './OpportunityDivider';
import { log } from '@/lib/logger';

const logger = log.ui.from('ChatView');

interface ChatViewProps {
  userId: string;
  userName: string;
  userAvatar?: string;
  initialGroupId?: string;
  /** Pre-fill the message input. */
  initialMessage?: string;
  /** If true, auto-send initialMessage when the conversation is ready instead of just prefilling. */
  autoSend?: boolean;
  /** Called once after the first message is successfully sent (used to accept a pending opportunity). */
  onFirstMessageSent?: () => void;
  onClose: () => void;
  onBack?: () => void;
  /** Third window on a signal: the window already has the name header. */
  embedded?: boolean;
  /** Match write-up shown above the thread, the way the desktop chat opens. */
  opener?: { headline?: string; detail?: string };
}

function normText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export default function ChatView({ userId, userName, userAvatar, initialGroupId, initialMessage, autoSend = false, onFirstMessageSent, onClose, onBack, embedded = false, opener }: ChatViewProps) {
  const { user } = useAuthContext();
  const opportunitiesService = useOpportunities();
  const {
    messages: allMessages,
    conversations,
    sendMessage: conversationSend,
    loadMessages,
    loadSessionHistory,
    sessionHistory,
    getOrCreateDm,
    markConversationRead,
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
  const [acceptedOpportunitiesLoading, setAcceptedOpportunitiesLoading] = useState(true);
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
      setAcceptedOpportunitiesLoading(true);
      hasAutoSentRef.current = false;
      hasFiredFirstMessageRef.current = false;
    }
  }, [userId]);

  const messages = useMemo(
    () => (conversationId ? allMessages.get(conversationId) ?? [] : []),
    [conversationId, allMessages],
  );
  const conversationSummary = conversationId
    ? conversations.find((conversation) => conversation.id === conversationId) ?? null
    : null;
  const via = conversationSummary?.via ?? [];
  const latestVia = via[0] ?? null;
  const history = conversationId ? sessionHistory.get(conversationId) : undefined;

  useEffect(() => {
    if (!conversationId || (conversationSummary?.unreadCount ?? 0) <= 0) return;
    void markConversationRead(conversationId);
  }, [conversationId, conversationSummary?.unreadCount, markConversationRead]);

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
        logger.error('Failed to load chat context', { error: err });
      })
      .finally(() => {
        if (!controller.signal.aborted) setAcceptedOpportunitiesLoading(false);
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
      loadMessages(cid).finally(() => setMessagesLoading(false));
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
        const conv = await getOrCreateDm(userId);
        if (!mounted) return;
        const cid = initialGroupId ?? conv.id;
        if (cid && !conversationId) setConversationId(cid);
      } catch (err) {
        logger.error('DM init error', { error: err });
      } finally {
        if (mounted) setContextLoading(false);
      }
    };

    init();
    return () => { mounted = false; };
  }, [userId, initialGroupId, getOrCreateDm, conversationId]);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // The conversation is open once the DM exists. Land in the composer then,
  // including after accept navigates here (autoFocus alone loses that race).
  useEffect(() => {
    if (contextLoading) return;
    inputRef.current?.focus();
  }, [contextLoading, userId]);

  // Auto-resize textarea (handles both typing and prefilled values)
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [messageText]);

  // Auto-send initialMessage once the conversation is ready
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
          const conv = await getOrCreateDm(userId);
          setConversationId(conv.id);
          await conversationSend(conv.id, [{ text }]);
          loadSessionHistory(conv.id);
        }
        if (!hasFiredFirstMessageRef.current) {
          hasFiredFirstMessageRef.current = true;
          onFirstMessageSent?.();
        }
      } catch (err) {
        hasAutoSentRef.current = false;
        logger.error('Auto-send error', { error: err });
      } finally {
        setSending(false);
      }
    })();
  }, [autoSend, contextLoading, conversationId, initialMessage, conversationSend, getOrCreateDm, userId, loadSessionHistory, onFirstMessageSent]);

  const handleSend = useCallback(async () => {
    if (!messageText.trim() || sending) return;
    const text = messageText.trim();
    setMessageText('');
    setSending(true);
    try {
      if (conversationId) {
        await conversationSend(conversationId, [{ text }]);
      } else {
        const conv = await getOrCreateDm(userId);
        setConversationId(conv.id);
        await conversationSend(conv.id, [{ text }]);
        loadSessionHistory(conv.id);
      }
      if (!hasFiredFirstMessageRef.current) {
        hasFiredFirstMessageRef.current = true;
        onFirstMessageSent?.();
      }
      inputRef.current?.focus();
    } catch (err) {
      logger.error('Send error', { error: err });
      setMessageText(text);
    } finally {
      setSending(false);
    }
  }, [conversationId, userId, messageText, sending, conversationSend, getOrCreateDm, loadSessionHistory, onFirstMessageSent]);

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

  const timeline = useMemo(
    () => buildChatTimeline(messages, acceptedOpportunities),
    [messages, acceptedOpportunities],
  );
  const openerHeadline = opener?.headline?.trim() ?? "";
  const openerBody = opener?.detail?.trim() || openerHeadline;
  const showOpenerHeadline = Boolean(openerHeadline && openerBody && normText(openerHeadline) !== normText(openerBody));

  return (
    <>
      {!embedded && (
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #000", display: "flex", gap: 12, alignItems: "center" }}>
          <UserAvatar avatar={userAvatar} id={userId} name={userName} size={34} />
          <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
            <Link to={`/u/${userId}`} style={{ fontFamily: "var(--amiga-title)", fontSize: 15, fontWeight: 600, color: "#000", textDecoration: "none" }}>{userName}</Link>
            {(conversationSummary?.createdAt || latestVia) && (
              <div style={{ fontFamily: "var(--mac-mono)", fontSize: 10, color: "var(--ink-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {conversationSummary?.createdAt ? `started ${formatChatDayLabel(conversationSummary.createdAt)}` : ""}
                {conversationSummary?.createdAt && latestVia ? " · " : ""}
                {latestVia ? <Link to={`/i/${latestVia.intentId}`} style={{ color: "inherit", textDecoration: "none" }}>{latestVia.title}</Link> : null}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="mac-scroll" style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {history?.hasPreviousSession && conversationId && history.loadingPrevious && (
              <p style={{ textAlign: "center", fontFamily: "var(--mac-mono)", fontSize: 11 }}>loading…</p>
            )}
            {openerBody && (
              <div style={{ border: "1px solid var(--ink-4)", background: "#FBFAF7", padding: "12px 14px", display: "grid", gap: 7, marginBottom: 6 }}>
                {showOpenerHeadline && (
                  <span style={{ fontFamily: "var(--mac-sans)", fontSize: 13.5, fontWeight: 600, color: "#000", lineHeight: 1.35, letterSpacing: -0.1 }}>{openerHeadline}</span>
                )}
                <span style={{ fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>{openerBody}</span>
              </div>
            )}
            {messagesLoading ? (
              <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
            ) : messages.length === 0 && via.length > 0 && !openerBody ? (
              <div className="text-center py-5 text-[13px] text-gray-400 font-ibm-plex-mono">
                agents matched you on this signal — say hi.
              </div>
            ) : null}

            {messages.length === 0 && acceptedOpportunitiesLoading && <OpportunityDividerSkeleton />}

            {!acceptedOpportunitiesLoading && timeline.map((item, index) => {
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
                const previousMessage = [...timeline.slice(0, index)].reverse().find((candidate) => candidate.type === 'message')?.message;
                const isOwn = message.senderId === user?.id;
                const textPart = (message.parts as { text?: string }[] | undefined)?.find((p) => p.text)?.text;
                const content = textPart ?? '';
                if (!content.trim()) return null;
                const day = message.createdAt ? formatChatDayLabel(message.createdAt) : "";
                const prevDay = previousMessage?.createdAt ? formatChatDayLabel(previousMessage.createdAt) : "";
                const clock = message.createdAt ? formatChatClock(message.createdAt) : "";

                return (
                  <div key={message.id}>
                    {day && day !== prevDay && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: index === 0 ? "0 0 2px" : "6px 0 2px" }}>
                        <span style={{ flex: 1, height: 1, background: "var(--ink-4)" }} />
                        <span style={{ fontFamily: "var(--mac-mono)", fontSize: 10, color: "var(--ink-3)", letterSpacing: 0.3 }}>{day}</span>
                        <span style={{ flex: 1, height: 1, background: "var(--ink-4)" }} />
                      </div>
                    )}
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, justifyContent: isOwn ? "flex-end" : "flex-start" }}>
                      {isOwn && clock && <time style={{ fontFamily: "var(--mac-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: 0.2, whiteSpace: "nowrap" }}>{clock}</time>}
                      <div className="wb-chat" style={{
                        maxWidth: "82%",
                        border: "1px solid #000",
                        background: isOwn ? "#000" : "#fff",
                        color: isOwn ? "#fff" : "#000",
                        padding: "8px 11px",
                        fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.4,
                        boxShadow: isOwn ? "none" : "inset 1px 1px 0 #fff, inset -1px -1px 0 var(--ink-3)",
                      }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                      </div>
                      {!isOwn && clock && <time style={{ fontFamily: "var(--mac-mono)", fontSize: 9, color: "var(--ink-3)", letterSpacing: 0.2, whiteSpace: "nowrap" }}>{clock}</time>}
                    </div>
                  </div>
                );
            })}
            <div ref={messagesEndRef} />
          </div>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} style={{ borderTop: "1px solid #000", background: "#fff", padding: "7px 12px 8px", display: "flex", gap: 10, alignItems: "flex-end" }}>
        <textarea
          ref={inputRef}
          rows={1}
          value={messageText}
          onChange={(e) => setMessageText(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder={embedded ? `message ${userName}…` : "write a message…"}
          disabled={sending}
          autoFocus
          style={{ flex: 1, minWidth: 0, border: "none", outline: "none", resize: "none", fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.4, background: "transparent", padding: "4px 0" }}
        />
        <button type="submit" disabled={!messageText.trim() || sending} aria-label="send" title="send" style={{ background: "none", border: "none", padding: 0, cursor: messageText.trim() ? "pointer" : "default", color: messageText.trim() ? "#111" : "#b9b3a4" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="square">
            <line x1="12" y1="20" x2="12" y2="5" />
            <polyline points="5,12 12,5 19,12" />
          </svg>
        </button>
      </form>
    </>
  );
}
