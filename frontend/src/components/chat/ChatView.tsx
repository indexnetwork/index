'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useXMTP } from '@/contexts/XMTPContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { Loader2, ArrowUp, MoreHorizontal, Trash2 } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { getAvatarUrl } from '@/lib/file-utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { ContentContainer } from '@/components/layout';
import { SystemMessageCard, type SystemMessagePresentation } from './SystemMessageCard';
import { parseContent, type StructuredContent } from '@/lib/content-types';
import { GroupMessageKind } from '@xmtp/browser-sdk';
import type { Group, DecodedMessage } from '@xmtp/browser-sdk';

interface ChatMessage {
  id: string;
  text?: string;
  senderInboxId: string;
  created_at?: Date;
  status?: string;
  /** Structured content parsed from JSON text messages */
  structuredContent?: StructuredContent | null;
  /** Legacy fields for backward-compat with SystemMessageCard */
  introType?: string;
  presentation?: SystemMessagePresentation;
}

/**
 * Transform an XMTP DecodedMessage into our internal ChatMessage shape.
 * Structured messages (opportunity cards, updates) are encoded as JSON text.
 */
const transformMessage = (msg: DecodedMessage): ChatMessage => {
  const text = typeof msg.content === 'string' ? msg.content : '';
  const structured = parseContent(text);

  // Map structured content types to legacy introType for SystemMessageCard
  let introType: string | undefined;
  let presentation: SystemMessagePresentation | undefined;
  if (structured) {
    if (structured.type === 'opportunity_card') {
      introType = 'opportunity_intro';
      presentation = {
        headline: structured.headline,
        personalizedSummary: structured.summary,
        suggestedAction: 'Start a conversation',
      };
    } else if (structured.type === 'opportunity_update') {
      introType = 'opportunity_update';
    }
  }

  return {
    id: msg.id,
    text,
    senderInboxId: msg.senderInboxId,
    created_at: msg.sentAt,
    status: String(msg.deliveryStatus),
    structuredContent: structured,
    introType,
    presentation,
  };
};

interface ChatViewProps {
  userId: string;
  userName: string;
  userAvatar?: string;
  userTitle?: string;
  /** XMTP conversation (group) ID for this DM */
  conversationId?: string;
  onClose: () => void;
  onBack?: () => void;
}

export default function ChatView({
  userId,
  userName,
  userAvatar,
  userTitle,
  conversationId,
  onClose,
  onBack,
}: ChatViewProps) {
  const { client, isReady, humanChats, refreshConversations, agentAddress } =
    useXMTP();
  const { success, error: showError } = useNotifications();

  const [conversation, setConversation] = useState<Group | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sendingMessageId, setSendingMessageId] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const streamCleanupRef = useRef<(() => void) | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // ---------------------------------------------------------------------------
  // Initialize conversation & load messages
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isReady || !client) {
      setConversation(null);
      setMessages([]);
      setLoading(false);
      return;
    }

    let mounted = true;

    const initConversation = async () => {
      try {
        let group: Group | undefined;

        // If we have a specific conversation ID, fetch it directly
        if (conversationId) {
          const conv = await client.conversations.getConversationById(
            conversationId,
          );
          if (conv && 'members' in conv) {
            group = conv as Group;
          }
        }

        // If no conversationId or not found, look through humanChats for a
        // conversation that includes the target user's inbox ID.
        // We can't easily map userId -> inboxId on the frontend alone, so
        // we fall back to matching from the pre-categorized humanChats list.
        if (!group) {
          // Refresh to pick up recently created conversations
          await refreshConversations();
        }

        if (!group && humanChats.length > 0) {
          // Try to find by checking members - we need to find the conversation
          // where the target userId's inbox is a member. Since we don't have
          // a direct userId -> inboxId mapping on the frontend, we use the
          // conversation list which is already synced.
          // For now, if conversationId was provided, we already got it above.
          // Otherwise the page.tsx should provide the conversationId.
        }

        if (!mounted) return;

        if (group) {
          // Sync latest messages from the network
          await group.sync();
          const xmtpMessages = await group.messages();

          // Filter to application messages only (skip membership changes)
          const appMessages = xmtpMessages.filter(
            (m) => m.kind === GroupMessageKind.Application,
          );

          if (!mounted) return;

          setConversation(group);
          setMessages(appMessages.map(transformMessage));
          setLoading(false);

          // Set up real-time message streaming
          const stream = await group.stream();

          const readStream = async () => {
            try {
              for await (const value of stream) {
                if (!mounted) break;

                if (value && value.kind === GroupMessageKind.Application) {
                  const incoming = transformMessage(value);
                  setMessages((prev) => {
                    // Deduplicate
                    if (prev.some((m) => m.id === incoming.id)) {
                      return prev.map((m) =>
                        m.id === incoming.id ? incoming : m,
                      );
                    }
                    return [...prev, incoming];
                  });
                  scrollToBottom();
                }
              }
            } catch (err) {
              if (mounted) {
                console.error('[ChatView] Stream error:', err);
              }
            }
          };

          readStream();

          streamCleanupRef.current = () => {
            stream.return().catch(() => {});
          };
        } else {
          // No conversation found - show empty state
          if (mounted) {
            setLoading(false);
          }
        }
      } catch (error) {
        console.error('Error initializing conversation:', error);
        if (mounted) setLoading(false);
      }
    };

    initConversation();

    return () => {
      mounted = false;
      if (streamCleanupRef.current) {
        streamCleanupRef.current();
        streamCleanupRef.current = null;
      }
    };
  }, [
    isReady,
    client,
    conversationId,
    humanChats,
    refreshConversations,
    scrollToBottom,
  ]);

  // Scroll to bottom when messages change
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // ---------------------------------------------------------------------------
  // Send message
  // ---------------------------------------------------------------------------
  const handleSend = useCallback(async () => {
    if (!messageText.trim() || sendingMessageId) return;
    const text = messageText.trim();
    setMessageText('');
    setSendingMessageId(text);

    try {
      if (!conversation) {
        inputRef.current?.focus();
        return;
      }
      await conversation.sendText(text);
      setSendingMessageId(null);
      inputRef.current?.focus();
    } catch (error) {
      console.error('Error sending message:', error);
      setSendingMessageId(null);
      setMessageText(text);
      showError(
        'Failed to send',
        error instanceof Error ? error.message : 'Please try again.',
      );
      inputRef.current?.focus();
    }
  }, [conversation, messageText, sendingMessageId, showError]);

  // Auto-focus input on keydown anywhere
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length === 1 || e.key === 'Backspace') {
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const avatarUrl = getAvatarUrl({
    avatar: userAvatar || null,
    id: userId,
    name: userName,
  });

  const handleBack = () => {
    if (onBack) onBack();
    else onClose();
  };

  const formatTime = (date: Date | string | undefined) => {
    if (!date) return '';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const handleDeleteChat = async () => {
    if (!conversation || isDeleting) return;
    setIsDeleting(true);
    try {
      // In XMTP, we can't truly delete a group; we remove ourselves
      // For now, just close and navigate away
      success('Chat closed', `Conversation with ${userName} has been closed.`);
      onClose();
    } catch (err) {
      console.error('Failed to close chat:', err);
      showError(
        'Failed to close',
        err instanceof Error ? err.message : 'Please try again.',
      );
    } finally {
      setIsDeleting(false);
      setShowMenu(false);
    }
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  // Determine the agent's inbox ID so we can identify system/bot messages
  const agentInboxId = agentAddress ?? '';

  return (
    <>
      {/* Sticky header - full width */}
      <div className="sticky top-0 bg-white z-10 px-4 py-3 flex items-center justify-between min-h-[68px]">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="text-[#3D3D3D] hover:text-black transition-colors text-xl mr-2"
          >
            ←
          </button>
          <Link
            href={`/u/${userId}`}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <div className="relative">
              <Image
                src={avatarUrl}
                alt={userName}
                width={44}
                height={44}
                className="rounded-full"
              />
            </div>
            <h2 className="font-ibm-plex-mono font-bold text-lg text-black">
              {userName}
            </h2>
          </Link>
        </div>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <MoreHorizontal className="w-5 h-5 text-[#3D3D3D]" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[160px] z-20">
              <button
                onClick={handleDeleteChat}
                disabled={isDeleting || !conversation}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                {isDeleting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Trash2 className="w-4 h-4" />
                )}
                Delete chat
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Scrollable content - flex-1 pushes input to bottom */}
      <div className="px-6 lg:px-8 pb-32 flex-1">
        <ContentContainer>
          {/* Messages */}
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-[#3D3D3D]">
              <p className=" text-sm">
                Start a conversation with {userName}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((message, index) => {
                const isOwn =
                  message.senderInboxId === client?.inboxId;
                const isSystemMessage =
                  message.senderInboxId === agentInboxId &&
                  (message.structuredContent != null || message.introType != null);

                const showTimestamp =
                  index === 0 ||
                  (messages[index - 1] &&
                    (message.created_at?.getTime() ?? 0) -
                      (messages[index - 1].created_at?.getTime() ?? 0) >
                      300000);

                return (
                  <div key={message.id}>
                    {showTimestamp && message.created_at && (
                      <div className="text-center text-xs text-gray-400  uppercase tracking-wider my-4">
                        Today, {formatTime(message.created_at)}
                      </div>
                    )}
                    {isSystemMessage ? (
                      <SystemMessageCard
                        text={message.text}
                        introType={message.introType}
                        presentation={message.presentation}
                      />
                    ) : (
                      <div
                        className={cn(
                          'flex items-end gap-2',
                          isOwn ? 'justify-end' : 'justify-start',
                        )}
                      >
                        {!isOwn && (
                          <Image
                            src={avatarUrl}
                            alt={userName}
                            width={32}
                            height={32}
                            className="rounded-full flex-shrink-0"
                          />
                        )}
                        <div
                          className={cn(
                            'max-w-[70%] rounded-2xl px-4 py-2',
                            isOwn
                              ? 'bg-gray-900 text-white'
                              : 'bg-gray-100 text-gray-900',
                          )}
                        >
                          <article
                            className={cn(
                              ' text-sm',
                              isOwn && 'text-white',
                            )}
                          >
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {message.text || ''}
                            </ReactMarkdown>
                          </article>
                        </div>
                        {isOwn && (
                          <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 text-xs  font-bold text-[#3D3D3D]">
                            {client?.accountIdentifier?.identifier?.charAt(
                              0,
                            ) || 'U'}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </ContentContainer>
      </div>

      {/* Sticky input at bottom - matches ChatContent */}
      <div className="sticky bottom-0 z-20">
        <div className="px-6 lg:px-8">
          <ContentContainer>
            <div className="bg-[linear-gradient(to_bottom,transparent_50%,#ffffff_50%)]">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-center gap-3 bg-[#F8F8F8] border border-[#E9E9E9] rounded-[32px] px-4 py-3"
              >
                <input
                  ref={inputRef}
                  type="text"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder={`Type a message to ${userName}...`}
                  disabled={sendingMessageId !== null}
                  autoFocus
                  className="flex-1 bg-transparent border-none outline-none text-gray-900 placeholder-gray-500 h-6"
                />
                <button
                  type="submit"
                  disabled={
                    !messageText.trim() || sendingMessageId !== null
                  }
                  className="shrink-0 h-8 w-8 rounded-full bg-[#041729] text-white flex items-center justify-center hover:bg-[#0a2d4a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </form>
            </div>
            <div className="pb-3 bg-white" />
          </ContentContainer>
        </div>
      </div>
    </>
  );
}
