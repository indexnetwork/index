'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Channel, MessageResponse, LocalMessage } from 'stream-chat';
import { useStreamChat } from '@/contexts/StreamChatContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useDiscover } from '@/contexts/APIContext';
import { X, ArrowLeft, Clock, Check, SkipForward, Loader2, ArrowUp } from 'lucide-react';
import Image from 'next/image';
import { getAvatarUrl } from '@/lib/file-utils';

interface ChatMessage {
  id: string;
  text?: string;
  user?: { id: string; name?: string } | null;
  created_at?: Date | string;
  status?: string;
}

// Transform MessageResponse or LocalMessage to ChatMessage
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
  minimized: boolean; // Kept for compatibility but not used
  onClose: () => void;
  onToggleMinimize: () => void; // Kept for compatibility but not used
}

interface ChannelPendingState {
  isPending: boolean;
  isRequester: boolean;
  awaitingAdminApproval: boolean;
}

export default function ChatView({
  userId,
  userName,
  userAvatar,
  minimized: _minimized,
  onClose,
  onToggleMinimize: _onToggleMinimize,
}: ChatViewProps) {
  // Suppress unused variable warnings - kept for API compatibility
  void _minimized;
  void _onToggleMinimize;
  const { client, isReady, getOrCreateChannel, clearActiveChat, respondToMessageRequest, refreshMessageRequests, sendMessageRequest, checkCanMessage } = useStreamChat();
  const { success, error: showError } = useNotifications();
  const discoverService = useDiscover();
  const [channel, setChannel] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingState, setPendingState] = useState<ChannelPendingState>({ isPending: false, isRequester: false, awaitingAdminApproval: false });
  const [respondingAction, setRespondingAction] = useState<string | null>(null);
  const [isNewConversation, setIsNewConversation] = useState(false); // True when user needs to send a message request
  const [mutualIntentCount, setMutualIntentCount] = useState<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [sendingMessageId, setSendingMessageId] = useState<string | null>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, []);

  // Initialize channel
  useEffect(() => {
    if (!isReady || !client) {
      setChannel(null);
      setMessages([]);
      setLoading(false);
      return;
    }

    let mounted = true;
    let currentChannel: Channel | null = null;
    let handleMessage: ((event: ChannelEvent) => void) | null = null;
    let handleMessageUpdated: ((event: ChannelEvent) => void) | null = null;
    let syncMessagesHandler: (() => void) | null = null;

    const initChannel = async () => {
      try {
        // First, check if users are connected
        let canMessageDirectly = false;
        try {
          const canMessageResponse = await checkCanMessage(userId);
          canMessageDirectly = canMessageResponse.canMessageDirectly;
          
          // If there's already a pending request, we'll load the channel
          if (canMessageResponse.connectionStatus === 'REQUEST' && canMessageResponse.isInitiator) {
            // User already sent a request, channel should exist
            canMessageDirectly = true; // Allow loading the channel
          }
        } catch (err) {
          console.error('Failed to check message permission:', err);
        }

        const ch = await getOrCreateChannel(userId, userName, userAvatar);
        if (!ch) {
          setLoading(false);
          return;
        }

        currentChannel = ch;
        
        try {
          await ch.watch();
        } catch (watchError) {
          // Channel might not exist yet for new conversations
          const err = watchError as { message?: string; code?: number };
          if (err?.message?.includes('does not exist') || err?.code === 16) {
            // This is a new conversation - channel doesn't exist yet
            if (!canMessageDirectly) {
              setIsNewConversation(true);
              setChannel(ch);
              setMessages([]);
              setLoading(false);
              return;
            }
          }
          throw watchError;
        }

        if (!mounted) return;

        setChannel(ch);

        // Check pending state from channel data
        const channelData = ch.data as { pending?: boolean; requestedBy?: string; awaitingAdminApproval?: boolean };
        if (channelData?.pending) {
          setPendingState({
            isPending: true,
            isRequester: channelData.requestedBy === client?.userID,
            awaitingAdminApproval: channelData.awaitingAdminApproval || false
          });
        } else {
          setPendingState({ isPending: false, isRequester: false, awaitingAdminApproval: false });
        }

        // Load messages
        const response = await ch.query({
          messages: { limit: 50 },
        });
        
        if (!mounted) return;
        
        // Check if this is a new conversation (no messages and not connected)
        if (!canMessageDirectly && (response.messages || []).length === 0 && !channelData?.pending) {
          setIsNewConversation(true);
        }
        
        setMessages((response.messages || []).map(transformMessage));
        setLoading(false);

        // Sync messages from channel state
        syncMessagesHandler = () => {
          if (mounted && ch.state.messages) {
            setMessages(ch.state.messages.map(transformMessage));
            scrollToBottom();
          }
        };

        // Listen for new messages
        handleMessage = (event: ChannelEvent) => {
          if (mounted && event.channel?.id === ch.id) {
            syncMessagesHandler?.();
          }
        };

        // Listen for message updates (including sent messages)
        handleMessageUpdated = (event: ChannelEvent) => {
          if (mounted && event.channel?.id === ch.id) {
            syncMessagesHandler?.();
          }
        };

        ch.on('message.new', handleMessage);
        ch.on('message.updated', handleMessageUpdated);
        
        // Also listen to channel state changes
        ch.on('channel.updated', syncMessagesHandler);
      } catch (error) {
        console.error('Error initializing channel:', error);
        if (mounted) {
          setLoading(false);
        }
      }
    };

    initChannel();

    return () => {
      mounted = false;
      if (currentChannel) {
        if (handleMessage) {
          currentChannel.off('message.new', handleMessage);
        }
        if (handleMessageUpdated) {
          currentChannel.off('message.updated', handleMessageUpdated);
        }
        if (syncMessagesHandler) {
          currentChannel.off('channel.updated', syncMessagesHandler);
        }
      }
    };
  }, [isReady, client, userId, userName, userAvatar, getOrCreateChannel, scrollToBottom, checkCanMessage]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = useCallback(async () => {
    if (!messageText.trim() || sendingMessageId) return;

    const text = messageText.trim();
    setMessageText('');
    
    // Optimistic update - add message immediately
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: ChatMessage = {
      id: tempId,
      text,
      user: client?.userID ? { id: client.userID, name: client?.user?.name } : null,
      created_at: new Date(),
      status: 'sending',
    };
    
    setSendingMessageId(tempId);
    setMessages((prev) => [...prev, optimisticMessage]);
    scrollToBottom();

    try {
      // If this is a new conversation with non-connected user, use sendMessageRequest
      if (isNewConversation) {
        const response = await sendMessageRequest(userId, text, userName, userAvatar);
        
        // Update state after successful request
        setIsNewConversation(false);
        setPendingState({
          isPending: true,
          isRequester: true,
          awaitingAdminApproval: response.awaitingAdminApproval || false
        });
        
        // Keep the optimistic message but mark it as sent
        setMessages((prev) => 
          prev.map((m) => m.id === tempId ? { ...m, status: 'sent' } : m)
        );
        
        success('Message request sent', `${userName} will see this in their message requests.`);
        setSendingMessageId(null);
        scrollToBottom();
        inputRef.current?.focus();
        return;
      }

      // Regular message send for connected users
      if (!channel) return;
      
      const response = await channel.sendMessage({
        text,
      });
      
      // Replace optimistic message with real one
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== tempId);
        return [...filtered, transformMessage(response.message)];
      });
      setSendingMessageId(null);
      scrollToBottom();
      inputRef.current?.focus();
    } catch (error) {
      console.error('Error sending message:', error);
      // Remove failed optimistic message
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setSendingMessageId(null);
      setMessageText(text); // Restore message text
      showError('Failed to send', error instanceof Error ? error.message : 'Please try again.');
    }
  }, [channel, messageText, client, sendingMessageId, scrollToBottom, isNewConversation, sendMessageRequest, userId, userName, userAvatar, success, showError]);

  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const avatarUrl = getAvatarUrl({ avatar: userAvatar || null, id: userId, name: userName });

  // Fetch mutual intent count
  useEffect(() => {
    const fetchMutualIntents = async () => {
      try {
        const result = await discoverService.discoverUsers({
          userIds: [userId],
          limit: 1
        });
        const userResult = result.results.find(r => r.user.id === userId);
        if (userResult) {
          setMutualIntentCount(userResult.intents.length);
        } else {
          setMutualIntentCount(0);
        }
      } catch (error) {
        console.error('Error fetching mutual intents:', error);
        setMutualIntentCount(null);
      }
    };
    
    if (isReady && userId) {
      fetchMutualIntents();
    }
  }, [isReady, userId, discoverService]);

  const handleBack = () => {
    clearActiveChat();
  };

  // Handle responding to message request from within chat view
  const handleRespondToRequest = async (action: 'ACCEPT' | 'DECLINE' | 'SKIP') => {
    if (!channel?.id || respondingAction) return;
    
    setRespondingAction(action);
    try {
      await respondToMessageRequest(channel.id, action);
      
      // Update local pending state
      if (action === 'ACCEPT') {
        setPendingState({ isPending: false, isRequester: false, awaitingAdminApproval: false });
        success('Request accepted', `You can now chat with ${userName}`);
      } else {
        // For decline/skip, close the chat
        success(action === 'DECLINE' ? 'Request declined' : 'Request skipped', 
          action === 'DECLINE' ? 'The message request has been declined.' : 'You can revisit this later.');
        onClose();
      }
      
      // Refresh the message requests list
      await refreshMessageRequests();
    } catch (err) {
      console.error('Failed to respond to request:', err);
      showError('Failed', err instanceof Error ? err.message : 'Please try again later.');
    } finally {
      setRespondingAction(null);
    }
  };

  return (
    <div className="w-full rounded-md  flex flex-col" style={{
      minHeight: 'calc(100vh - 150px)'
    }}>
      <div className="bg-white border border-gray-800 rounded-sm flex flex-col flex-1 overflow-hidden">
        {/* Header - exactly like profile card */}
        <div className="py-4 px-2 sm:px-4 ">
          <div className="flex flex-wrap sm:flex-nowrap justify-between items-start mb-4">
            <div className="flex items-center gap-4 w-full sm:w-auto mb-2 sm:mb-0">
              <Image
                src={avatarUrl}
                alt={userName}
                width={48}
                height={48}
                className="rounded-full"
              />
              <div>
                <h2 className="font-bold text-lg text-gray-900 font-ibm-plex-mono text-left">{userName}</h2>
                <div className="flex items-center gap-4 text-sm text-gray-500 font-ibm-plex-mono">
                  {mutualIntentCount !== null ? (
                    mutualIntentCount > 0 ? (
                      <span>{mutualIntentCount} mutual intent{mutualIntentCount !== 1 ? 's' : ''}</span>
                    ) : (
                      <span>Potential connection</span>
                    )
                  ) : (
                    <span>Direct message</span>
                  )}
                </div>
              </div>
            </div>
            {/* Back button - replacing message button */}
            <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={handleBack}
                className="flex items-center gap-2 px-3 py-1.5 bg-black text-white text-sm font-ibm-plex-mono hover:bg-gray-800 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
            </div>
          </div>
        </div>

      {/* Pending state banners */}
      {pendingState.isPending && (
        <div className={`px-4 py-3 border-b ${
          pendingState.awaitingAdminApproval 
            ? 'bg-amber-50 border-amber-200' 
            : pendingState.isRequester 
              ? 'bg-blue-50 border-blue-200'
              : 'bg-green-50 border-green-200'
        }`}>
          {pendingState.awaitingAdminApproval ? (
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-600" />
              <span className="text-sm text-amber-800 font-ibm-plex-mono">
                Awaiting admin approval before {userName} can see your message
              </span>
            </div>
          ) : pendingState.isRequester ? (
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-blue-600" />
              <span className="text-sm text-blue-800 font-ibm-plex-mono">
                Message request pending. {userName} hasn't responded yet.
              </span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-green-800 font-ibm-plex-mono">
                  {userName} wants to connect with you
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleRespondToRequest('ACCEPT')}
                  disabled={!!respondingAction}
                  className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors disabled:opacity-50"
                >
                  {respondingAction === 'ACCEPT' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Accept
                </button>
                <button
                  onClick={() => handleRespondToRequest('SKIP')}
                  disabled={!!respondingAction}
                  className="flex items-center gap-1 px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-sm rounded transition-colors disabled:opacity-50"
                >
                  {respondingAction === 'SKIP' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <SkipForward className="w-4 h-4" />
                  )}
                  Skip
                </button>
                <button
                  onClick={() => handleRespondToRequest('DECLINE')}
                  disabled={!!respondingAction}
                  className="flex items-center gap-1 px-3 py-1.5 text-red-600 hover:bg-red-50 text-sm rounded transition-colors disabled:opacity-50"
                >
                  {respondingAction === 'DECLINE' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <X className="w-4 h-4" />
                  )}
                  Decline
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Chat container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 flex flex-col">
        {loading ? (
          <div className="text-center text-gray-500 text-sm py-8">
            Loading...
          </div>
        ) : messages.length === 0 && isNewConversation ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-gray-500 text-sm py-8 px-4">
              <p className="mb-2">Start a conversation with {userName}</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-8">
            No messages yet. Start the conversation!
          </div>
        ) : (
          <>
            {messages.map((message) => {
              const isOwn = message.user?.id === client?.userID;
              return (
                <div
                  key={message.id}
                  className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[75%] px-3 py-2 rounded-sm ${
                      isOwn
                        ? 'bg-black text-white font-ibm-plex-mono'
                        : 'bg-gray-100 text-gray-900 font-ibm-plex-mono'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap break-words">
                      {message.text}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Message input */}
      <div className="">
        {/* Notice for new conversations */}
        {isNewConversation && (
          <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
            <p className="text-sm text-blue-800 font-ibm-plex-mono">
              Write your first message. {userName} will see this in their message requests and can choose to accept or decline.
            </p>
          </div>
        )}
        
        <div className="p-4">
          {pendingState.isPending && pendingState.isRequester ? (
            <div className="text-center text-gray-500 text-sm font-ibm-plex-mono py-2">
              Waiting for {userName} to accept your message request
            </div>
          ) : pendingState.isPending && !pendingState.isRequester ? (
            <div className="text-center text-gray-500 text-sm font-ibm-plex-mono py-2">
              Accept the request to continue the conversation
            </div>
          ) : (
            <div className="bg-white border border-gray-800 rounded-sm shadow-lg flex flex-col">
              <div className="flex items-center px-4 py-2 min-h-[54px]">
                <input
                  ref={inputRef}
                  type="text"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder={isNewConversation ? `Say hi to ${userName}...` : "Type a message..."}
                  className="flex-1 font-ibm-plex-mono text-black text-lg focus:outline-none bg-transparent"
                  disabled={sendingMessageId !== null}
                />
                {sendingMessageId ? (
                  <button
                    onClick={() => setSendingMessageId(null)}
                    className="h-9 w-9 rounded-full bg-black text-white flex items-center justify-center hover:bg-gray-800 transition-colors cursor-pointer ml-2"
                  >
                    <X className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!messageText.trim()}
                    className="h-9 w-9 rounded-full bg-black text-white flex items-center justify-center hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ml-2"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
