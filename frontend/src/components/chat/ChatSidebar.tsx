'use client';

import { useEffect, useState, useCallback } from 'react';
import { Channel } from 'stream-chat';
import { useStreamChat } from '@/contexts/StreamChatContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { MessageSquare, Inbox, Check, X, SkipForward, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { getAvatarUrl } from '@/lib/file-utils';

interface ChannelMember {
  user?: {
    id: string;
    name?: string;
    image?: string;
  };
}

export default function ChatSidebar() {
  const { 
    client, 
    isReady, 
    openChat, 
    activeChatId, 
    setActiveChat,
    messageRequests,
    messageRequestsLoading,
    respondToMessageRequest,
  } = useStreamChat();
  const { success, error: showError } = useNotifications();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);

  // Calculate total unread count
  const totalUnreadCount = channels.reduce((sum, ch) => sum + (ch.state?.unreadCount || 0), 0);

  // Fetch channels/conversations
  useEffect(() => {
    if (!isReady || !client) {
      setLoading(false);
      return;
    }

    const fetchChannels = async () => {
      try {
        // Get channels where current user is a member
        const filter = {
          type: 'messaging',
          members: { $in: [client.userID || ''] },
        };

        const sort = [{ last_message_at: -1 }];

        const response = await client.queryChannels(filter, sort, {
          watch: true,
          state: true,
          message_limit: 100,
          member_limit: 100,
        });

        setChannels(response);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching channels:', error);
        setLoading(false);
      }
    };

    fetchChannels();

    // Listen for new messages to update channel list
    const handleEvent = () => {
      fetchChannels();
    };

    client.on('message.new', handleEvent);
    client.on('channel.updated', handleEvent);

    return () => {
      client.off('message.new', handleEvent);
      client.off('channel.updated', handleEvent);
    };
  }, [isReady, client]);

  const handleChannelClick = useCallback(
    (channel: Channel) => {
      // Get the other member (not current user)
      const members = Object.values(channel.state.members || {}) as ChannelMember[];
      const otherMember = members.find(
        (m) => m.user?.id !== client?.userID
      );

      if (otherMember?.user) {
        // Open chat and set as active
        openChat(
          otherMember.user.id,
          otherMember.user.name || 'User',
          otherMember.user.image
        );
        setActiveChat(otherMember.user.id);
      }
    },
    [client, openChat, setActiveChat]
  );

  // Handle responding to message requests
  const handleMessageRequestResponse = useCallback(async (
    channelId: string, 
    action: 'ACCEPT' | 'DECLINE' | 'SKIP',
    requesterName: string
  ) => {
    setRespondingTo(channelId);
    try {
      await respondToMessageRequest(channelId, action);
      
      switch (action) {
        case 'ACCEPT':
          success('Request accepted', `You can now chat with ${requesterName}`);
          break;
        case 'DECLINE':
          success('Request declined', 'The message request has been declined.');
          break;
        case 'SKIP':
          success('Request skipped', 'You can revisit this later.');
          break;
      }
    } catch (err) {
      console.error('Failed to respond to message request:', err);
      showError('Failed', err instanceof Error ? err.message : 'Please try again later.');
    } finally {
      setRespondingTo(null);
    }
  }, [respondToMessageRequest, success, showError]);

  if (!isReady) {
    return (
      <div className="bg-white rounded-sm border-black border p-3">
        <div className="flex items-center gap-2 mb-4">
          <MessageSquare className="w-5 h-5 text-gray-600" />
          <h2 className="font-bold text-sm text-black font-ibm-plex-mono">Conversations</h2>
        </div>
        <div className="text-center text-gray-500 text-sm py-8">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-sm border-black border overflow-hidden flex flex-col">
      {/* Message Requests section */}
      {messageRequests.length > 0 && (
        <div className="border-b border-gray-200">
          <div className="flex items-center gap-2 px-3 py-3 bg-amber-50">
            <Inbox className="w-5 h-5 text-amber-600" />
            <h2 className="font-bold text-sm text-black font-ibm-plex-mono">
              Message Requests
            </h2>
            <span className="ml-auto text-xs px-2 py-1 rounded bg-amber-600 text-white">
              {messageRequests.length}
            </span>
          </div>
          <div className="max-h-[200px] overflow-y-auto">
            {messageRequestsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {messageRequests.map((request) => {
                  const isResponding = respondingTo === request.channelId;
                  return (
                    <div
                      key={request.channelId}
                      className="px-3 py-3 bg-white hover:bg-gray-50"
                    >
                      <div className="flex items-start gap-3">
                        <Image
                          src={getAvatarUrl({ 
                            avatar: request.requester?.avatar, 
                            id: request.requester?.id || '', 
                            name: request.requester?.name || 'User' 
                          })}
                          alt={request.requester?.name || 'User'}
                          width={40}
                          height={40}
                          className="rounded-full flex-shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="font-bold text-sm font-ibm-plex-mono text-gray-900 block truncate">
                            {request.requester?.name || 'User'}
                          </span>
                          {request.firstMessage && (
                            <p className="text-xs text-gray-500 font-ibm-plex-mono truncate mt-0.5">
                              {request.firstMessage}
                            </p>
                          )}
                          <div className="flex items-center gap-1 mt-2">
                            <button
                              onClick={() => handleMessageRequestResponse(
                                request.channelId, 
                                'ACCEPT',
                                request.requester?.name || 'User'
                              )}
                              disabled={isResponding}
                              className="flex items-center gap-1 px-2 py-1 bg-green-600 hover:bg-green-700 text-white text-xs rounded transition-colors disabled:opacity-50"
                            >
                              {isResponding ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Check className="w-3 h-3" />
                              )}
                              Accept
                            </button>
                            <button
                              onClick={() => handleMessageRequestResponse(
                                request.channelId, 
                                'SKIP',
                                request.requester?.name || 'User'
                              )}
                              disabled={isResponding}
                              className="flex items-center gap-1 px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs rounded transition-colors disabled:opacity-50"
                            >
                              <SkipForward className="w-3 h-3" />
                              Skip
                            </button>
                            <button
                              onClick={() => handleMessageRequestResponse(
                                request.channelId, 
                                'DECLINE',
                                request.requester?.name || 'User'
                              )}
                              disabled={isResponding}
                              className="flex items-center gap-1 px-2 py-1 text-red-500 hover:bg-red-50 text-xs rounded transition-colors disabled:opacity-50"
                            >
                              <X className="w-3 h-3" />
                              Decline
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Conversations header */}
      <div className="flex items-center gap-2 px-3 py-3">
        <MessageSquare className="w-5 h-5 text-gray-600" />
        <h2 className="font-bold text-sm text-black font-ibm-plex-mono">Conversations</h2>
        {totalUnreadCount > 0 && (
          <span className="ml-auto text-xs px-2 py-1 rounded-full bg-black text-white font-ibm-plex-mono">
            {totalUnreadCount}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto min-h-[300px]">
        {loading ? (
          <div className="text-center text-gray-500 text-sm py-8">
            Loading conversations...
          </div>
        ) : channels.length === 0 ? (
          <div className="text-center text-gray-500 text-sm py-8 px-3">
            No conversations yet
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {channels.map((channel) => {
              const members = Object.values(channel.state.members || {}) as ChannelMember[];
              const otherMember = members.find(
                (m) => m.user?.id !== client?.userID
              );
              const otherUser = otherMember?.user;

              if (!otherUser) return null;

              const lastMessage = channel.state.messages[channel.state.messages.length - 1];
              const unreadCount = channel.state.unreadCount || 0;
              const hasUnread = unreadCount > 0;
              const isActive = activeChatId === otherUser.id;

              return (
                <button
                  key={channel.id}
                  onClick={() => handleChannelClick(channel)}
                  className={`w-full px-3 py-3 transition-colors text-left ${
                    isActive
                      ? 'bg-gray-100 border-l-2 border-black'
                      : hasUnread
                        ? 'bg-gray-50'
                        : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Image
                      src={getAvatarUrl({ avatar: otherUser.image, id: otherUser.id, name: otherUser.name })}
                      alt={otherUser.name || 'User'}
                      width={40}
                      height={40}
                      className="rounded-full flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-sm font-ibm-plex-mono truncate ${
                          hasUnread ? 'font-bold text-black' : 'font-medium text-gray-900'
                        }`}>
                          {otherUser.name || 'User'}
                        </span>
                        {hasUnread && (
                          <span className="bg-black text-white text-xs px-2 py-0.5 rounded-full font-ibm-plex-mono">
                            {unreadCount}
                          </span>
                        )}
                      </div>
                      {lastMessage && (
                        <p className={`text-xs font-ibm-plex-mono truncate ${
                          hasUnread ? 'text-gray-800' : 'text-gray-500'
                        }`}>
                          {lastMessage.text || 'Attachment'}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
