'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Channel, MessageResponse, LocalMessage } from 'stream-chat';
import { useStreamChat } from '@/contexts/StreamChatContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { Clock, Check, SkipForward, Loader2, ArrowUp, X, MoreHorizontal, Trash2 } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { getAvatarUrl } from '@/lib/file-utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';
import { ContentContainer } from '@/components/layout';

interface ChatMessage {
  id: string;
  text?: string;
  user?: { id: string; name?: string } | null;
  created_at?: Date | string;
  status?: string;
}

const transformMessage = (msg: MessageResponse | LocalMessage): ChatMessage => ({
  id: msg.id,
  text: msg.text,
  user: msg.user ? { id: msg.user.id, name: msg.user.name } : null,
  created_at: msg.created_at instanceof Date ? msg.created_at : msg.created_at,
  status: msg.status,
});

interface ChannelEvent {
  channel?: { id: string };
}

interface ChatViewProps {
  userId: string;
  userName: string;
  userAvatar?: string;
  userTitle?: string;
  onClose: () => void;
  onBack?: () => void;
}

interface ChannelPendingState {
  isPending: boolean;
  isRequester: boolean;
  awaitingAdminApproval: boolean;
}

export default function ChatView({ userId, userName, userAvatar, userTitle, onClose, onBack }: ChatViewProps) {
  const { client, isReady, getOrCreateChannel, clearActiveChat, respondToMessageRequest, refreshMessageRequests, sendMessageRequest, checkCanMessage } = useStreamChat();
  const { success, error: showError } = useNotifications();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingState, setPendingState] = useState<ChannelPendingState>({ isPending: false, isRequester: false, awaitingAdminApproval: false });
  const [respondingAction, setRespondingAction] = useState<string | null>(null);
  const [isNewConversation, setIsNewConversation] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sendingMessageId, setSendingMessageId] = useState<string | null>(null);
  const [channelRefreshKey, setChannelRefreshKey] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, []);

  useEffect(() => {
    if (!isReady || !client) { setChannel(null); setMessages([]); setLoading(false); return; }

    let mounted = true;
    let currentChannel: Channel | null = null;
    let handleMessage: ((event: ChannelEvent) => void) | null = null;
    let handleMessageUpdated: ((event: ChannelEvent) => void) | null = null;
    let syncMessagesHandler: (() => void) | null = null;

    const initChannel = async () => {
      try {
        let canMessageDirectly = false;
        try {
          const canMessageResponse = await checkCanMessage(userId);
          canMessageDirectly = canMessageResponse.canMessageDirectly;
          if (canMessageResponse.connectionStatus === 'REQUEST' && canMessageResponse.isInitiator) canMessageDirectly = true;
        } catch (err) { console.error('Failed to check message permission:', err); }

        const sortedIds = [client.userID, userId].sort().join('_');
        const expectedChannelId = sortedIds.length > 64 
          ? (() => { let hash = 0; for (let i = 0; i < sortedIds.length; i++) { const char = sortedIds.charCodeAt(i); hash = ((hash << 5) - hash) + char; hash = hash & hash; } return Math.abs(hash).toString(36).slice(0, 63); })()
          : sortedIds;

        let existingChannels = await client.queryChannels({ type: 'messaging', id: expectedChannelId }, {}, { limit: 1, watch: true, state: true });

        if (existingChannels.length === 0 && channelRefreshKey > 0 && mounted) {
          await new Promise((r) => setTimeout(r, 500));
          if (!mounted) return;
          existingChannels = await client.queryChannels({ type: 'messaging', id: expectedChannelId }, {}, { limit: 1, watch: true, state: true });
        }

        if (existingChannels.length > 0) {
          const ch = existingChannels[0];
          currentChannel = ch;
          if (!mounted) return;
          await ch.watch();
          setChannel(ch);

          const channelData = ch.data as { pending?: boolean; requestedBy?: string; awaitingAdminApproval?: boolean };
          if (channelData?.pending) {
            setPendingState({ isPending: true, isRequester: channelData.requestedBy === client?.userID, awaitingAdminApproval: channelData.awaitingAdminApproval || false });
          } else {
            setPendingState({ isPending: false, isRequester: false, awaitingAdminApproval: false });
          }
          
          if (!canMessageDirectly && ch.state.messages.length === 0 && !channelData?.pending) setIsNewConversation(true);
          setMessages(ch.state.messages.map(transformMessage));
          setLoading(false);

          syncMessagesHandler = () => { if (mounted && ch.state.messages) { setMessages(ch.state.messages.map(transformMessage)); scrollToBottom(); } };
          handleMessage = (event: ChannelEvent) => { if (mounted && event.channel?.id === ch.id) syncMessagesHandler?.(); };
          handleMessageUpdated = (event: ChannelEvent) => { if (mounted && event.channel?.id === ch.id) syncMessagesHandler?.(); };

          ch.on('message.new', handleMessage);
          ch.on('message.updated', handleMessageUpdated);
          ch.on('channel.updated', syncMessagesHandler);
        } else {
          const newCh = await getOrCreateChannel(userId, userName, userAvatar);
          if (!newCh) { setLoading(false); return; }
          currentChannel = newCh;
          setIsNewConversation(true);
          setChannel(newCh);
          setMessages([]);
          setLoading(false);
          return;
        }
      } catch (error) { console.error('Error initializing channel:', error); if (mounted) setLoading(false); }
    };

    initChannel();

    return () => {
      mounted = false;
      if (currentChannel) {
        if (handleMessage) currentChannel.off('message.new', handleMessage);
        if (handleMessageUpdated) currentChannel.off('message.updated', handleMessageUpdated);
        if (syncMessagesHandler) currentChannel.off('channel.updated', syncMessagesHandler);
      }
    };
  }, [isReady, client, userId, userName, userAvatar, getOrCreateChannel, scrollToBottom, checkCanMessage, channelRefreshKey]);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  const handleSend = useCallback(async () => {
    if (!messageText.trim() || sendingMessageId) return;
    const text = messageText.trim();
    setMessageText('');
    
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: ChatMessage = { id: tempId, text, user: client?.userID ? { id: client.userID, name: client?.user?.name } : null, created_at: new Date(), status: 'sending' };
    
    setSendingMessageId(tempId);
    setMessages((prev) => [...prev, optimisticMessage]);
    scrollToBottom();

    try {
      if (isNewConversation) {
        const response = await sendMessageRequest(userId, text, userName, userAvatar);
        setIsNewConversation(false);
        setPendingState({ isPending: true, isRequester: true, awaitingAdminApproval: response.awaitingAdminApproval || false });
        setMessages((prev) => prev.map((m) => m.id === tempId ? { ...m, status: 'sent' } : m));
        success('Message request sent', `${userName} will see this in their message requests.`);
        setSendingMessageId(null);
        setChannelRefreshKey((k) => k + 1);
        scrollToBottom();
        inputRef.current?.focus();
        return;
      }

      if (!channel) return;
      const response = await channel.sendMessage({ text });
      setMessages((prev) => { const filtered = prev.filter((m) => m.id !== tempId); return [...filtered, transformMessage(response.message)]; });
      setSendingMessageId(null);
      scrollToBottom();
      inputRef.current?.focus();
    } catch (error) {
      console.error('Error sending message:', error);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setSendingMessageId(null);
      setMessageText(text);
      showError('Failed to send', error instanceof Error ? error.message : 'Please try again.');
    }
  }, [channel, messageText, client, sendingMessageId, scrollToBottom, isNewConversation, sendMessageRequest, userId, userName, userAvatar, success, showError]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }, [handleSend]);

  const avatarUrl = getAvatarUrl({ avatar: userAvatar || null, id: userId, name: userName });

  const handleBack = () => { if (onBack) onBack(); else clearActiveChat(); };

  const handleRespondToRequest = async (action: 'ACCEPT' | 'DECLINE' | 'SKIP') => {
    if (!channel?.id || respondingAction) return;
    setRespondingAction(action);
    try {
      await respondToMessageRequest(channel.id, action);
      if (action === 'ACCEPT') { setPendingState({ isPending: false, isRequester: false, awaitingAdminApproval: false }); success('Request accepted', `You can now chat with ${userName}`); }
      else { success(action === 'DECLINE' ? 'Request declined' : 'Request skipped', action === 'DECLINE' ? 'The message request has been declined.' : 'You can revisit this later.'); onClose(); }
      await refreshMessageRequests();
    } catch (err) { console.error('Failed to respond to request:', err); showError('Failed', err instanceof Error ? err.message : 'Please try again later.'); }
    finally { setRespondingAction(null); }
  };

  const formatTime = (date: Date | string | undefined) => {
    if (!date) return '';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const handleDeleteChat = async () => {
    if (!channel || isDeleting) return;
    setIsDeleting(true);
    try {
      await channel.delete();
      success('Chat deleted', `Conversation with ${userName} has been deleted.`);
      onClose();
    } catch (err) {
      console.error('Failed to delete chat:', err);
      showError('Failed to delete', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setIsDeleting(false);
      setShowMenu(false);
    }
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  return (
    <>
      {/* Sticky header - full width */}
      <div className="sticky top-0 bg-background z-10 px-4 py-3 flex items-center justify-between min-h-[68px]">
        <div className="flex items-center gap-3">
          <button onClick={handleBack} className="text-muted-foreground hover:text-foreground transition-colors text-xl mr-2">←</button>
          <Link href={`/u/${userId}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <div className="relative">
              <Image src={avatarUrl} alt={userName} width={44} height={44} className="rounded-full" />
            </div>
            <h2 className="font-ibm-plex-mono font-bold text-lg text-foreground">{userName}</h2>
          </Link>
        </div>
        <div className="relative" ref={menuRef}>
          <button 
            onClick={() => setShowMenu(!showMenu)}
            className="p-2 hover:bg-muted rounded-full transition-colors"
          >
            <MoreHorizontal className="w-5 h-5 text-muted-foreground" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-lg shadow-lg dark:shadow-none py-1 min-w-[160px] z-20">
              <button
                onClick={handleDeleteChat}
                disabled={isDeleting || !channel}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors disabled:opacity-50"
              >
                {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Delete chat
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Scrollable content - centered */}
      <div className="px-6 lg:px-8 py-6 pb-32">
        <ContentContainer>
          {/* Pending state banners */}
          {pendingState.isPending && (
            <div className={`px-4 py-3 rounded-lg mb-4 ${pendingState.awaitingAdminApproval ? 'bg-amber-50 border border-amber-200' : pendingState.isRequester ? 'bg-blue-50 border border-blue-200' : 'bg-green-50 border border-green-200'}`}>
              {pendingState.awaitingAdminApproval ? (
                <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-amber-600" /><span className="text-sm text-amber-800 font-ibm-plex-mono">Awaiting admin approval before {userName} can see your message</span></div>
              ) : pendingState.isRequester ? (
                <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-blue-600" /><span className="text-sm text-blue-800 font-ibm-plex-mono">Message request pending. {userName} hasn't responded yet.</span></div>
              ) : (
                <div className="space-y-2">
                  <span className="text-sm text-green-800 font-ibm-plex-mono">{userName} wants to connect with you</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleRespondToRequest('ACCEPT')} disabled={!!respondingAction} className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors disabled:opacity-50">
                      {respondingAction === 'ACCEPT' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Accept
                    </button>
                    <button onClick={() => handleRespondToRequest('SKIP')} disabled={!!respondingAction} className="flex items-center gap-1 px-3 py-1.5 bg-muted hover:bg-muted/80 text-muted-foreground text-sm rounded transition-colors disabled:opacity-50">
                      {respondingAction === 'SKIP' ? <Loader2 className="w-4 h-4 animate-spin" /> : <SkipForward className="w-4 h-4" />} Skip
                    </button>
                    <button onClick={() => handleRespondToRequest('DECLINE')} disabled={!!respondingAction} className="flex items-center gap-1 px-3 py-1.5 text-red-600 hover:bg-red-50 text-sm rounded transition-colors disabled:opacity-50">
                      {respondingAction === 'DECLINE' ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />} Decline
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Messages */}
          {loading ? (
            <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground"><p className="font-ibm-plex-mono text-sm">Start a conversation with {userName}</p></div>
          ) : (
            <div className="space-y-4">
              {messages.map((message, index) => {
                const isOwn = message.user?.id === client?.userID;
                const showTimestamp = index === 0 || (messages[index - 1] && new Date(message.created_at || '').getTime() - new Date(messages[index - 1].created_at || '').getTime() > 300000);

                return (
                  <div key={message.id}>
                    {showTimestamp && message.created_at && (
                      <div className="text-center text-xs text-muted-foreground font-ibm-plex-mono uppercase tracking-wider my-4">Today, {formatTime(message.created_at)}</div>
                    )}
                    <div className={cn('flex items-end gap-2', isOwn ? 'justify-end' : 'justify-start')}>
                      {!isOwn && <Image src={avatarUrl} alt={userName} width={32} height={32} className="rounded-full flex-shrink-0" />}
                      <div className={cn('max-w-[70%] rounded-2xl px-4 py-2', isOwn ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground')}>
                        <article className={cn('font-ibm-plex-mono text-sm', isOwn && 'text-primary-foreground')}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text || ''}</ReactMarkdown>
                        </article>
                      </div>
                      {isOwn && <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 text-xs font-ibm-plex-mono font-bold text-muted-foreground">{client?.user?.name?.charAt(0) || 'U'}</div>}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </ContentContainer>
      </div>

      {/* Fixed input at bottom */}
      <div className="fixed bottom-0 left-0 right-0 lg:left-64 z-20">
        <div className="px-6 lg:px-8 py-4">
          <ContentContainer>
            {pendingState.isPending && pendingState.isRequester ? (
              <div className="text-center text-muted-foreground font-ibm-plex-mono text-sm">Waiting for {userName} to accept your message request</div>
            ) : pendingState.isPending && !pendingState.isRequester ? (
              <div className="text-center text-muted-foreground font-ibm-plex-mono text-sm">Accept the request to continue the conversation</div>
            ) : (
              <>
                <div className="flex items-center gap-3 bg-muted rounded-full px-4 py-3">
                  <input
                    ref={inputRef}
                    type="text"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={handleKeyPress}
                    placeholder={`Type a message to ${userName}...`}
                    disabled={sendingMessageId !== null}
                    className="flex-1 bg-transparent border-none outline-none font-ibm-plex-mono text-foreground placeholder-muted-foreground h-6"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!messageText.trim() || sendingMessageId !== null}
                    className="shrink-0 h-8 w-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <ArrowUp className="h-4 w-4" />
                  </button>
                </div>
              </>
            )}
          </ContentContainer>
        </div>
      </div>
    </>
  );
}
