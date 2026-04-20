import { useState, useEffect, useCallback, useRef } from 'react';
import { useNetworksState } from '@/contexts/NetworksContext';
import { useNetworkService } from '@/services/networks';

export interface MentionableUser {
  id: string;
  display: string;
  avatar?: string | null;
}

interface UseMentionableUsersOptions {
  /** Whether to fetch users */
  enabled?: boolean;
}

interface UseMentionableUsersResult {
  users: MentionableUser[];
  isLoading: boolean;
  /** Search/filter users by query (for async data fetching) */
  searchUsers: (query: string, callback: (users: MentionableUser[]) => void) => void;
}

export function useMentionableUsers({
  enabled = true,
}: UseMentionableUsersOptions = {}): UseMentionableUsersResult {
  const [users, setUsers] = useState<MentionableUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { networks, loading: networksLoading } = useNetworksState();
  const networkService = useNetworkService();
  const fetchedRef = useRef(false);
  const cacheRef = useRef<Map<string, MentionableUser>>(new Map());

  const fetchAllMembers = useCallback(async () => {
    if (!enabled) {
      fetchedRef.current = false;
      setUsers([]);
      return;
    }

    if (networksLoading) return;

    // Avoid duplicate fetches
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    setIsLoading(true);
    try {
      const { members } = await networkService.getMyMembers();

      const userMap = new Map<string, MentionableUser>();
      for (const member of members) {
        if (!userMap.has(member.id)) {
          userMap.set(member.id, {
            id: member.id,
            display: member.name,
            avatar: member.avatar,
          });
        }
      }

      // Update cache
      cacheRef.current = userMap;
      setUsers(Array.from(userMap.values()));
    } catch (error) {
      console.error('Failed to fetch mentionable users:', error);
      setUsers([]);
    } finally {
      setIsLoading(false);
    }
  }, [enabled, networkService, networksLoading]);

  // Stable signature of index IDs so joins/leaves trigger refetch even when length is unchanged
  const networksSignature =
    networks.length === 0
      ? ''
      : [...networks]
          .map((i) => i.id)
          .sort()
          .join(',');

  useEffect(() => {
    fetchedRef.current = false; // Reset when indexes change so we refetch after join/leave
    fetchAllMembers();
  }, [fetchAllMembers, networksSignature, networksLoading]);

  // Search function for react-mentions async data fetching
  const searchUsers = useCallback(
    (query: string, callback: (users: MentionableUser[]) => void) => {
      const lowerQuery = query.toLowerCase();
      const filtered = Array.from(cacheRef.current.values()).filter(user =>
        user.display.toLowerCase().includes(lowerQuery)
      );
      callback(filtered);
    },
    []
  );

  return {
    users,
    isLoading,
    searchUsers,
  };
}
