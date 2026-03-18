import { useEffect, useRef, useState, useCallback } from 'react';
import { useXMTP } from '@/contexts/XMTPClientContext';
import { Loader2, ArrowUp, MoreHorizontal, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { Link } from 'react-router';
import UserAvatar from '@/components/UserAvatar';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { ContentContainer } from '@/components/layout';
import { useAuthContext } from '@/contexts/AuthContext';
import type { XmtpChatContext } from '@/services/xmtp';

interface ChatViewProps {
  userId: string;
  userName: string;
  userAvatar?: string;
  userTitle?: string;
  initialGroupId?: string;
  /** Pre-fill the message input (e.g. invite text for ghost users). */
  initialMessage?: string;
  onClose: () => void;
  onBack?: () => void;
}

export default function ChatView({ userId, userName, userAvatar, initialGroupId, initialMessage, onClose, onBack }: ChatViewProps) {
  const { user } = useAuthContext();
  const { isConnected, myInboxId, sendMessage: xmtpSend, loadMessages, messages: allMessages, getChatContext, deleteConversation } = useXMTP();
  const [groupId, setGroupId] = useState<string | null>(initialGroupId ?? null);
  const [chatContext, setChatContext] = useState<XmtpChatContext | null>(null);
  const [messageText, setMessageText] = useState(initialMessage ?? '');
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [contextLoading, setContextLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const messages = groupId ? (allMessages.get(groupId) || []) : [];

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Load messages eagerly (fast — XMTP local)
  useEffect(() => {
    if (!isConnected) return;
    const gid = initialGroupId ?? groupId;
    if (gid) {
      loadMessages(gid, 50).finally(() => setMessagesLoading(false));
    } else {
      setMessagesLoading(false);
    }
  }, [isConnected, initialGroupId, groupId, loadMessages]);

  // Load chat context independently (slow — involves LLM presenter)
  useEffect(() => {
    if (!isConnected) return;

    let mounted = true;
    const init = async () => {
      try {
        const ctx = await getChatContext(userId);
        if (!mounted) return;
        setChatContext(ctx);
        const gid = initialGroupId ?? ctx?.groupId ?? null;
        if (gid && !groupId) setGroupId(gid);
      } catch (err) {
        console.error('[ChatView] Chat context error:', err);
      } finally {
        if (mounted) setContextLoading(false);
      }
    };

    init();
    return () => { mounted = false; };
  }, [isConnected, userId, initialGroupId, getChatContext]);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const handleSend = useCallback(async () => {
    if (!messageText.trim() || sending) return;
    const text = messageText.trim();
    setMessageText('');
    setSending(true);
    try {
      const newGroupId = await xmtpSend(
        groupId
          ? { groupId, text }
          : { peerUserId: userId, text },
      );
      if (!groupId && newGroupId) {
        setGroupId(newGroupId);
        loadMessages(newGroupId, 50);
      }
      inputRef.current?.focus();
    } catch (err) {
      console.error('[ChatView] Send error:', err);
      setMessageText(text);
    } finally {
      setSending(false);
    }
  }, [groupId, userId, messageText, sending, xmtpSend]);

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

  const formatTime = (sentAt: string | undefined) => {
    if (!sentAt) return '';
    const ms = Number(sentAt) / 1_000_000;
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const opportunityCards = chatContext?.opportunities ?? [];
  const [activeCardIndex, setActiveCardIndex] = useState(0);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const carouselRef = useRef<HTMLDivElement>(null);

  const toggleExpand = useCallback((oppId: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(oppId)) next.delete(oppId);
      else next.add(oppId);
      return next;
    });
  }, []);

  const handleCarouselScroll = useCallback(() => {
    const el = carouselRef.current;
    if (!el) return;
    const index = Math.round(el.scrollLeft / el.offsetWidth);
    setActiveCardIndex(index);
  }, []);

  return (
    <>
      {/* Header */}
      <div className="sticky top-0 bg-white z-10 px-4 py-3 flex items-center justify-between min-h-[68px]">
        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="text-[#3D3D3D] hover:text-black transition-colors text-xl mr-2">&larr;</button>
          <Link to={`/u/${userId}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <UserAvatar avatar={userAvatar} id={userId} name={userName} size={44} />
            <h2 className="font-ibm-plex-mono font-bold text-lg text-black">{userName}</h2>
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
                  if (groupId) await deleteConversation(groupId);
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
              {/* Opportunity cards — skeleton while loading, carousel when ready */}
              {contextLoading ? (
                <div className="mt-6 mb-6 max-w-[72%] mx-auto">
                  <div className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.04)] animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-3/4 mb-3" />
                    <div className="h-3 bg-gray-100 rounded w-full mb-2" />
                    <div className="h-3 bg-gray-100 rounded w-5/6" />
                  </div>
                </div>
              ) : opportunityCards.length > 0 ? (
                <div className="mt-6 mb-6 max-w-[72%] mx-auto">
                  <div
                    ref={carouselRef}
                    onScroll={handleCarouselScroll}
                    className={cn(
                      'flex gap-3 overflow-x-auto scrollbar-hide snap-x snap-mandatory p-2 -m-2',
                      opportunityCards.length === 1 && 'overflow-x-hidden'
                    )}
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  >
                    {opportunityCards.map((opp) => {
                      const isExpanded = expandedCards.has(opp.opportunityId);
                      return (
                        <div
                          key={opp.opportunityId}
                          className="snap-center shrink-0 w-full bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.08),0_0_0_1px_rgba(0,0,0,0.04)]"
                        >
                          {opp.headline && (
                            <p className="text-sm font-bold text-[#1A1A1A] mb-2">{opp.headline}</p>
                          )}
                          <p className={cn('text-sm text-[#3D3D3D] leading-relaxed', !isExpanded && 'line-clamp-2')}>
                            {opp.personalizedSummary}
                          </p>
                          {opp.personalizedSummary && opp.personalizedSummary.length > 100 && (
                            <button
                              onClick={() => toggleExpand(opp.opportunityId)}
                              className="mt-1 inline-flex items-center gap-0.5 text-xs text-[#666] hover:text-[#333] transition-colors"
                            >
                              {isExpanded ? (
                                <><ChevronUp className="w-3 h-3" /> Show less</>
                              ) : (
                                <><ChevronDown className="w-3 h-3" /> Read more</>
                              )}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Dot indicators */}
                  {opportunityCards.length > 1 && (
                    <div className="flex justify-center gap-1.5 mt-3">
                      {opportunityCards.map((opp, i) => (
                        <button
                          key={opp.opportunityId}
                          aria-label={`Go to card ${i + 1} of ${opportunityCards.length}`}
                          aria-current={i === activeCardIndex ? 'true' : undefined}
                          onClick={() => {
                            carouselRef.current?.children[i]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                          }}
                          className={cn(
                            'w-1.5 h-1.5 rounded-full transition-colors',
                            i === activeCardIndex ? 'bg-[#3D3D3D]' : 'bg-[#D4D4D4]'
                          )}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              {messagesLoading ? (
                <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
              ) : messages.length === 0 && !contextLoading && opportunityCards.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-[#3D3D3D]">
                  <p className="text-sm">Start a conversation with {userName}</p>
                </div>
              ) : null}

              {messages.map((message, index) => {
                const isOwn = message.senderInboxId === 'self' || (myInboxId != null && message.senderInboxId === myInboxId);
                const content = typeof message.content === 'string' ? message.content : String(message.content ?? '');
                if (!content.trim()) return null;
                const showTimestamp = index === 0 || (messages[index - 1] && Number(message.sentAt) - Number(messages[index - 1].sentAt) > 300_000_000_000);

                return (
                  <div key={message.id}>
                    {showTimestamp && message.sentAt && (
                      <div className="text-center text-xs text-gray-400 uppercase tracking-wider my-4">Today, {formatTime(message.sentAt)}</div>
                    )}
                    <div className={cn('flex items-end gap-2', isOwn ? 'justify-end' : 'justify-start')}>
                      {!isOwn && <UserAvatar avatar={userAvatar} id={userId} name={userName} size={32} className="flex-shrink-0" />}
                      <div className={cn('max-w-[70%] rounded-2xl px-4 py-2', isOwn ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-900')}>
                        <article className={cn('text-sm', isOwn && 'text-white')}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                        </article>
                      </div>
                      {isOwn && (
                        <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 text-xs font-bold text-[#3D3D3D]">
                          {user?.name?.charAt(0) || 'U'}
                        </div>
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
              <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex items-center gap-3 bg-[#FCFCFC] border border-[#E9E9E9] rounded-4xl px-4 py-3">
                <input
                  ref={inputRef}
                  type="text"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder={`Type a message to ${userName}...`}
                  disabled={sending}
                  autoFocus
                  className="flex-1 bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 h-6"
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
