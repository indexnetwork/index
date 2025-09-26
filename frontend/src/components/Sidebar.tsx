'use client';

import { useState, useEffect, useCallback } from 'react';
import { useIndexFilter } from '@/contexts/IndexFilterContext';
import { useIndexesState } from '@/contexts/IndexesContext';
import { Index as IndexType } from '@/lib/types';
import { useAuthenticatedAPI } from '@/lib/api';
import MemberSettingsModal from '@/components/modals/MemberSettingsModal';
import OwnerSettingsModal from '@/components/modals/OwnerSettingsModal';
import ContextMenu from '@/components/ContextMenu';
import { Settings, User, Crown, MoreVertical, Link2, Check } from 'lucide-react';

interface IndexItem {
  id: string;
  name: string;
  isSelectAll?: boolean;
  isSelected?: boolean;
  fullIndex?: IndexType;
}

export default function Sidebar() {
  const { indexes: rawIndexes, loading } = useIndexesState();
  const [indexes, setIndexes] = useState<IndexItem[]>([]);
  const [selectedIndexId, setSelectedIndexId] = useState<string>('all');
  const [memberSettingsIndex, setMemberSettingsIndex] = useState<IndexType | null>(null);
  const [ownerSettingsIndex, setOwnerSettingsIndex] = useState<IndexType | null>(null);
  const [memberSettingsCache, setMemberSettingsCache] = useState<Record<string, { isOwner: boolean }>>({});
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const { setSelectedIndexIds } = useIndexFilter();
  const api = useAuthenticatedAPI();
  
  
  // Transform raw indexes into sidebar items whenever rawIndexes changes
  useEffect(() => {
    if (!rawIndexes) {
      setIndexes([{ id: 'all', name: 'All Indexes', isSelectAll: true, isSelected: selectedIndexId === 'all' }]);
      return;
    }
    
    const indexItems: IndexItem[] = [
      { 
        id: 'all', 
        name: 'All Indexes', 
        isSelectAll: true,
        isSelected: selectedIndexId === 'all'
      },
      ...rawIndexes.map((index: IndexType) => ({
        id: index.id,
        name: index.title,
        isSelected: selectedIndexId === index.id,
        fullIndex: index
      }))
    ];
    setIndexes(indexItems);
    
    // Pre-fetch member settings for all indexes
    rawIndexes.forEach(async (index: IndexType) => {
      try {
        const memberSettings = await api.get<{ isOwner: boolean }>(`/indexes/${index.id}/member-settings`);
        setMemberSettingsCache(prev => ({ 
          ...prev, 
          [index.id]: { isOwner: memberSettings.isOwner } 
        }));
      } catch (error) {
        console.error(`Failed to fetch member settings for ${index.id}:`, error);
      }
    });
  }, [rawIndexes, selectedIndexId, api]);

  // Update selection state without refetching indexes
  useEffect(() => {
    setIndexes(prevIndexes => 
      prevIndexes.map(index => ({
        ...index,
        isSelected: index.id === selectedIndexId
      }))
    );
  }, [selectedIndexId]);

  const handleIndexClick = (indexId: string) => {
    console.log('Index clicked:', indexId);
    setSelectedIndexId(indexId);
    if (indexId === 'all') {
      console.log('Setting filter to empty array (show all)');
      setSelectedIndexIds([]);
    } else {
      console.log('Setting filter to:', [indexId]);
      setSelectedIndexIds([indexId]);
    }
  };

  // Fetch member settings for a specific index
  const fetchMemberSettings = useCallback(async (indexId: string) => {
    if (memberSettingsCache[indexId]) {
      return memberSettingsCache[indexId];
    }
    
    try {
      const response = await api.get<{ isOwner: boolean }>(`/indexes/${indexId}/member-settings`);
      const settings = { isOwner: response.isOwner };
      setMemberSettingsCache(prev => ({ ...prev, [indexId]: settings }));
      return settings;
    } catch (error) {
      console.error('Failed to fetch member settings:', error);
      return { isOwner: false };
    }
  }, [api, memberSettingsCache]);

  // Handle context menu actions
  const handleMemberSettings = async (index: IndexType) => {
    setMemberSettingsIndex(index);
  };

  const handleOwnerSettings = async (index: IndexType) => {
    setOwnerSettingsIndex(index);
  };

  // Handle copy link functionality
  const handleCopyLink = async (index: IndexType) => {
    if (!index.linkPermissions?.code) {
      return;
    }

    // Determine which link to copy based on permissions
    let linkUrl = '';
    const hasPublicAccess = index.linkPermissions.permissions.includes('can-discover');
    const anyoneCanJoin = index.linkPermissions.permissions.includes('can-write-intents');

    if (anyoneCanJoin) {
      // If anyone can join, copy the matchlist link
      linkUrl = `${window.location.origin}/matchlist/${index.linkPermissions.code}`;
    } else if (hasPublicAccess) {
      // If only public access, copy the vibecheck link
      linkUrl = `${window.location.origin}/vibecheck/${index.linkPermissions.code}`;
    }

    if (linkUrl) {
      try {
        await navigator.clipboard.writeText(linkUrl);
        setCopiedLink(index.id);
        setTimeout(() => setCopiedLink(null), 2000);
      } catch (error) {
        console.error('Failed to copy link:', error);
      }
    }
  };

  return (
    <div className="space-y-6 font-mono">
      <div className="bg-white rounded-sm border-black border p-3 pb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-black">Networks</h2>
        </div>
        
        <div className="space-y-1.5">
          {loading ? (
            <div className="text-center text-gray-500 py-4">
              Loading indexes...
            </div>
          ) : (
            indexes.map((index) => {
              if (index.isSelectAll) {
                return (
                  <div
                    key={index.id}
                    onClick={() => handleIndexClick(index.id)}
                    className={`flex items-center justify-between group rounded cursor-pointer px-3 h-10 ${
                      index.isSelected ? 'bg-gray-200' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center min-w-0">
                      <span
                        className={`text-[14px] text-black truncate ${index.isSelected ? 'font-bold' : ''}`}
                        title={index.name}
                      >
                        {index.name}
                      </span>
                    </div>
                  </div>
                );
              }

              // Create context menu items for non-"All Indexes" items
              const contextMenuItems = [];

              // 1. Copy Link (if sharing is enabled)
              if (index.fullIndex?.linkPermissions?.code && index.fullIndex.linkPermissions.permissions.length > 0) {
                const isCopied = copiedLink === index.id;
                contextMenuItems.push({
                  id: 'copy-link',
                  label: isCopied ? 'Copied!' : 'Copy Link',
                  icon: isCopied ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />,
                  onClick: () => index.fullIndex && handleCopyLink(index.fullIndex),
                  disabled: isCopied
                });
              }

              // 2. Configure Index (if user is owner)
              const memberSettings = memberSettingsCache[index.id];
              if (memberSettings?.isOwner) {
                contextMenuItems.push({
                  id: 'index-settings',
                  label: 'Configure Index',
                  icon: <Crown className="w-4 h-4" />,
                  onClick: () => index.fullIndex && handleOwnerSettings(index.fullIndex)
                });
              }

              // 3. Member Settings (always available)
              contextMenuItems.push({
                id: 'member-settings',
                label: 'Member Settings',
                icon: <User className="w-4 h-4" />,
                onClick: () => index.fullIndex && handleMemberSettings(index.fullIndex)
              });

              return (
                <div
                  key={index.id}
                  onClick={() => handleIndexClick(index.id)}
                  className={`flex items-center justify-between group rounded cursor-pointer px-3 h-10 ${
                    index.isSelected ? 'bg-gray-200' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center min-w-0">
                    <span
                      className={`text-[14px] text-black truncate ${index.isSelected ? 'font-bold' : ''}`}
                      title={index.name}
                    >
                      {index.name}
                    </span>
                  </div>
                  <ContextMenu items={contextMenuItems} trigger="click">
                    <button
                      className="p-1 cursor-pointer hover:bg-gray-200 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <MoreVertical className="w-4 h-4 text-black" />
                    </button>
                  </ContextMenu>
                </div>
              );
            })
          )}
        </div>
      </div>

      {memberSettingsIndex && (
        <MemberSettingsModal
          open={!!memberSettingsIndex}
          onOpenChange={(open) => !open && setMemberSettingsIndex(null)}
          index={memberSettingsIndex}
        />
      )}

      {ownerSettingsIndex && (
        <OwnerSettingsModal
          open={!!ownerSettingsIndex}
          onOpenChange={(open) => !open && setOwnerSettingsIndex(null)}
          index={ownerSettingsIndex}
          onIndexUpdate={(updatedIndex) => {
            // Index is already updated in global state by OwnerSettingsModal
          }}
        />
      )}
    </div>
  );
}
