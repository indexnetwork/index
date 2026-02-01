'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams, usePathname } from 'next/navigation';
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
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const { 
    client, 
    isReady, 
    openChat, 
    messageRequests,
    messageRequestsLoading,
    respondToMessageRequest,
  } = useStreamChat();
  
  // Get active chat user ID from route params when on chat route (e.g., /u/[id]/chat)
  const activeChatUserId = pathname?.endsWith('/chat') && params?.id 
    ? (params.id as string) 
    : null;
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

        // Filter out empty channels (opened but never messaged)
        const channelsWithMessages = response;//response.filter(ch => ch.state.messages.length > 0);
        setChannels(channelsWithMessages);
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
        // Register in open chats for sidebar state
        openChat(
          otherMember.user.id,
          otherMember.user.name || 'User',
          otherMember.user.image
        );
        // Navigate to chat page
        router.push(`/u/${otherMember.user.id}/chat`);
      }
    },
    [client, openChat, router]
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
      <div className="flex flex-col">
        <div className="flex items-center gap-3 mb-3 min-h-[54px] flex-shrink-0 px-3">
          <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
            <MessageSquare className="w-5 h-5 text-muted-foreground" />
          </div>
          <h2 className="font-bold text-sm text-foreground font-ibm-plex-mono">Conversations</h2>
        </div>
        <div className="text-center text-muted-foreground text-sm py-8">
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Message Requests section */}
      {messageRequests.length > 0 && (
        <div>
          <div className="flex items-center gap-2 px-3 py-3 bg-amber-50 dark:bg-amber-950">
            <Inbox className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <h2 className="font-bold text-sm text-foreground font-ibm-plex-mono">
              Message Requests
            </h2>
            <span className="ml-auto text-xs px-2 py-1 rounded bg-amber-600 text-white">
              {messageRequests.length}
            </span>
          </div>
          <div className="max-h-[200px] overflow-y-auto">
            {messageRequestsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="divide-y divide-border">
                {messageRequests.map((request) => {
                  const isResponding = respondingTo === request.channelId;
                  return (
                    <div
                      key={request.channelId}
                      className="px-3 py-3 bg-card hover:bg-muted"
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
                          <span className="font-bold text-sm font-ibm-plex-mono text-foreground block truncate">
                            {request.requester?.name || 'User'}
                          </span>
                          {request.firstMessage && (
                            <p className="text-xs text-muted-foreground font-ibm-plex-mono truncate mt-0.5">
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
                              className="flex items-center gap-1 px-2 py-1 bg-muted hover:bg-muted/80 text-muted-foreground text-xs rounded transition-colors disabled:opacity-50"
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
                              className="flex items-center gap-1 px-2 py-1 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 text-xs rounded transition-colors disabled:opacity-50"
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

      {/* Conversations header - min-h-[54px] aligns with ChatView header bar; w-10 matches avatar width for alignment */}
      <div className="flex items-center gap-3 mb-3 min-h-[54px] flex-shrink-0 px-3">
        <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
          <MessageSquare className="w-5 h-5 text-muted-foreground" />
        </div>
        <h2 className="font-bold text-sm text-foreground font-ibm-plex-mono flex-1 min-w-0">Conversations</h2>
        {totalUnreadCount > 0 && (
          <span className="ml-auto text-xs px-2 py-1 rounded-full bg-primary text-primary-foreground font-ibm-plex-mono">
            {totalUnreadCount}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto min-h-[300px]">
        {loading ? (
          <div className="text-center text-muted-foreground text-sm py-8">
            Loading conversations...
          </div>
        ) : channels.length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-8 px-3">
            No conversations yet
          </div>
        ) : (
          <div>
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
              const isActive = activeChatUserId === otherUser.id;

              return (
                <button
                  key={channel.id}
                  onClick={() => handleChannelClick(channel)}
                  className={`w-full py-3 px-3 transition-colors text-left ${
                    isActive
                      ? 'bg-muted'
                      : hasUnread
                        ? 'bg-muted/50'
                        : 'hover:bg-muted/50'
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
                          hasUnread ? 'font-bold text-foreground' : 'font-medium text-foreground'
                        }`}>
                          {otherUser.name || 'User'}
                        </span>
                        {hasUnread && (
                          <span className="bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded-full font-ibm-plex-mono">
                            {unreadCount}
                          </span>
                        )}
                      </div>
                      {lastMessage && (
                        <p className={`text-xs font-ibm-plex-mono truncate ${
                          hasUnread ? 'text-foreground/80' : 'text-muted-foreground'
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
