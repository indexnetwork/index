'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Image from 'next/image';
import { MoreHorizontal } from 'lucide-react';
import { useXMTP } from '@/contexts/XMTPContext';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUsers } from '@/contexts/APIContext';
import { getAvatarUrl } from '@/lib/file-utils';
import type { Group } from '@xmtp/browser-sdk';

interface RecentChat {
  id: string;
  recipientId: string;
  name: string;
  avatar: string | null;
  lastMessage: string;
  sortTimestamp: number;
  unreadCount: number;
}

const formatConversationTime = (timestamp: number) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const isSameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isSameDay) {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(date);
};

const sortChats = (a: RecentChat, b: RecentChat) => {
  const aUnread = a.unreadCount > 0 ? 1 : 0;
  const bUnread = b.unreadCount > 0 ? 1 : 0;
  if (aUnread !== bUnread) return bUnread - aUnread;
  return b.sortTimestamp - a.sortTimestamp;
};

export default function ChatSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuthContext();
  const usersService = useUsers();
  const { isReady, humanChats, client } = useXMTP();

  const [recentChats, setRecentChats] = useState<RecentChat[]>([]);
  const [loadingChats, setLoadingChats] = useState(false);
  const [chatMenuOpen, setChatMenuOpen] = useState<string | null>(null);
  const chatMenuRef = useRef<HTMLDivElement>(null);
  const hasLoadedChatsRef = useRef(false);
  const getUserProfilesRef = useRef(usersService.getUserProfiles);

  const currentChatUserId =
    pathname?.match(/^\/u\/([^/]+)\/chat/)?.[1] || null;

  useEffect(() => {
    getUserProfilesRef.current = usersService.getUserProfiles;
  }, [usersService]);

  // ---------------------------------------------------------------------------
  // Build chat list from XMTP humanChats
  // ---------------------------------------------------------------------------
  const buildChatList = useCallback(async () => {
    if (!isReady || !client || !user?.id || humanChats.length === 0) {
      if (!hasLoadedChatsRef.current && isReady) {
        setLoadingChats(false);
        hasLoadedChatsRef.current = true;
      }
      return;
    }

    try {
      if (!hasLoadedChatsRef.current) {
        setLoadingChats(true);
      }

      const chatPromises = humanChats.map(async (group: Group) => {
        try {
          // Get the last message for preview & timestamp
          const lastMsg = await group.lastMessage();

          // Get members to find the other human participant
          const members = await group.members();
          // Filter out self and the agent
          const otherMembers = members.filter(
            (m) => m.inboxId !== client.inboxId,
          );

          return {
            groupId: group.id,
            lastMessageText:
              lastMsg && typeof lastMsg.content === 'string'
                ? lastMsg.content
                : '',
            lastMessageTime: lastMsg?.sentAt
              ? lastMsg.sentAt.getTime()
              : group.createdAt?.getTime() ?? 0,
            otherInboxIds: otherMembers.map((m) => m.inboxId),
            groupName: group.name,
          };
        } catch {
          return null;
        }
      });

      const chatInfos = (await Promise.all(chatPromises)).filter(
        Boolean,
      ) as NonNullable<Awaited<(typeof chatPromises)[number]>>[];

      // We don't have a direct inboxId -> userId mapping on the frontend,
      // so we use the group name (which may have been set during creation)
      // or show the conversation with available metadata.
      // For a richer experience, we could call a backend endpoint to resolve
      // inbox IDs to user profiles.

      const chats: RecentChat[] = chatInfos.map((info) => ({
        id: info.groupId,
        // recipientId is tricky without inbox->user mapping; use groupId as fallback
        recipientId: info.groupId,
        name: info.groupName || 'Chat',
        avatar: null,
        lastMessage: info.lastMessageText
          ? info.lastMessageText.replace(/[*_~`#>]/g, '')
          : 'No messages yet',
        sortTimestamp: info.lastMessageTime,
        unreadCount: 0, // XMTP doesn't have built-in unread tracking yet
      }));

      chats.sort(sortChats);
      setRecentChats(chats.slice(0, 10));
    } catch (error) {
      console.error('Failed to build chat list:', error);
    } finally {
      if (!hasLoadedChatsRef.current) {
        hasLoadedChatsRef.current = true;
        setLoadingChats(false);
      }
    }
  }, [isReady, client, user?.id, humanChats]);

  useEffect(() => {
    buildChatList();
  }, [buildChatList]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        chatMenuRef.current &&
        !chatMenuRef.current.contains(event.target as Node)
      ) {
        setChatMenuOpen(null);
      }
    };
    if (chatMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [chatMenuOpen]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Recent Chats Section */}
      <div className="flex-1 overflow-y-auto px-4 pt-4">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 font-ibm-plex-mono">
          Conversations
        </h3>
        {loadingChats ? (
          <div className="text-sm text-gray-400">Loading...</div>
        ) : recentChats.length === 0 ? (
          <div className="text-sm text-gray-400">No messages yet</div>
        ) : (
          <div className="space-y-1">
            {recentChats.map((chat) => {
              const isSelected = currentChatUserId === chat.recipientId;
              const isUnread = chat.unreadCount > 0;
              return (
                <div
                  key={chat.id}
                  className={`relative group flex items-center py-2 px-2 -mx-2 rounded-md transition-colors ${
                    isSelected ? 'bg-gray-100' : 'hover:bg-gray-50'
                  }`}
                >
                  <button
                    onClick={() =>
                      router.push(
                        `/u/${chat.recipientId}/chat?conversationId=${encodeURIComponent(chat.id)}`,
                      )
                    }
                    className={`flex-1 flex items-center gap-3 text-sm text-left pr-10 min-w-0 ${
                      isSelected
                        ? 'text-black font-semibold'
                        : isUnread
                          ? 'text-black font-bold'
                          : 'text-gray-700 hover:text-black'
                    }`}
                  >
                    <Image
                      src={getAvatarUrl({
                        avatar: chat.avatar,
                        id: chat.recipientId,
                        name: chat.name,
                      })}
                      alt={chat.name}
                      width={28}
                      height={28}
                      className="rounded-full flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <p
                        className={`truncate ${isUnread ? 'text-sm font-bold text-black' : 'text-sm font-medium text-black'}`}
                      >
                        {chat.name}
                      </p>
                      <p
                        className={`truncate ${isUnread ? 'text-sm font-semibold text-gray-900' : 'text-sm font-normal text-gray-500'}`}
                      >
                        {chat.lastMessage || 'No messages yet'}
                      </p>
                    </div>
                  </button>
                  <span
                    className={`absolute right-8 top-2 text-[11px] leading-none ${
                      isUnread
                        ? 'font-semibold text-gray-700'
                        : 'font-normal text-gray-400'
                    }`}
                  >
                    {formatConversationTime(chat.sortTimestamp)}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setChatMenuOpen(
                        chatMenuOpen === chat.id ? null : chat.id,
                      );
                    }}
                    className="p-1 opacity-0 group-hover:opacity-100 hover:bg-gray-100 rounded transition-all flex-shrink-0"
                  >
                    <MoreHorizontal className="w-4 h-4 text-gray-400" />
                  </button>
                  {chatMenuOpen === chat.id && (
                    <div
                      ref={chatMenuRef}
                      className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px] z-30"
                    >
                      <button
                        onClick={() => setChatMenuOpen(null)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 transition-colors"
                      >
                        Close
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
