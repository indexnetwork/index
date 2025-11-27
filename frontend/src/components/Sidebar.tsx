'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useIndexFilter } from '@/contexts/IndexFilterContext';
import { useIndexesState } from '@/contexts/IndexesContext';
import { useAuthContext } from '@/contexts/AuthContext';
import { Index as IndexType } from '@/lib/types';
import MemberSettingsModal from '@/components/modals/MemberSettingsModal';
import { Shield, ArrowLeft, Inbox, Users, Settings, Crown } from 'lucide-react';
import { useAdmin } from '@/contexts/APIContext';

interface IndexItem {
  id: string;
  name: string;
  isSelectAll?: boolean;
  isSelected?: boolean;
  fullIndex?: IndexType;
}

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { indexes: rawIndexes, loading } = useIndexesState();
  const { user: currentUser } = useAuthContext();
  const adminService = useAdmin();
  const [indexes, setIndexes] = useState<IndexItem[]>([]);
  const [selectedIndexId, setSelectedIndexId] = useState<string>('all');
  const [memberSettingsIndex, setMemberSettingsIndex] = useState<IndexType | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const { setSelectedIndexIds } = useIndexFilter();
  
  // Check if we're in admin mode
  const isAdminMode = pathname?.startsWith('/admin/');
  const adminIndexId = isAdminMode ? pathname?.split('/admin/')[1]?.split('/')[0] : null;
  const adminIndex = rawIndexes?.find(idx => idx.id === adminIndexId);
  
  
  // Transform raw indexes into sidebar items whenever rawIndexes changes
  useEffect(() => {
    if (!rawIndexes) {
      setIndexes([{ id: 'all', name: 'All Indexes', isSelectAll: true, isSelected: selectedIndexId === 'all' }]);
      return;
    }

    // Deduplication if needed
    const uniqueIndexes = Array.from(
      new Map(rawIndexes.map((index: IndexType) => [index.id, index])).values()
    );
    
    const indexItems: IndexItem[] = [
      { 
        id: 'all', 
        name: 'All Indexes', 
        isSelectAll: true,
        isSelected: selectedIndexId === 'all'
      },
      ...uniqueIndexes.map((index: IndexType) => ({
        id: index.id,
        name: index.title,
        isSelected: selectedIndexId === index.id,
        fullIndex: index
      }))
    ];
    setIndexes(indexItems);
  }, [rawIndexes, selectedIndexId]);

  // Update selection state without refetching indexes
  useEffect(() => {
    setIndexes(prevIndexes => 
      prevIndexes.map(index => ({
        ...index,
        isSelected: index.id === selectedIndexId
      }))
    );
  }, [selectedIndexId]);

  // Fetch pending count when in admin mode and approval is enabled
  useEffect(() => {
    if (isAdminMode && adminIndexId && adminIndex?.permissions?.requireApproval) {
      const fetchPendingCount = async () => {
        try {
          const response = await adminService.getPendingCount(adminIndexId);
          setPendingCount(response.count);
        } catch (error) {
          console.error('Failed to fetch pending count:', error);
        }
      };
      fetchPendingCount();
      // Poll every 30 seconds
      const interval = setInterval(fetchPendingCount, 30000);
      return () => clearInterval(interval);
    }
  }, [isAdminMode, adminIndexId, adminIndex?.permissions?.requireApproval, adminService]);

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

  // Handle context menu actions
  const handleMemberSettings = async (index: IndexType) => {
    setMemberSettingsIndex(index);
  };

  return (
    <div className="space-y-6 font-mono">
      {/* Admin Mode Sidebar */}
      {isAdminMode && adminIndex ? (
        <>
          <div className="bg-white rounded-sm border-black border p-4">
            <button
              onClick={() => router.push('/inbox')}
              className="flex items-center gap-2 text-blue-600 hover:text-blue-700 font-ibm-plex-mono text-sm mb-6 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to User Mode
            </button>
            
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
                <Shield className="w-5 h-5 text-gray-600" />
              </div>
              <div>
                <h2 className="font-bold text-lg text-black font-ibm-plex-mono">
                  {adminIndex.title}
                </h2>
                <p className="text-sm text-gray-600 font-ibm-plex-mono">
                  Admin Mode
                </p>
              </div>
            </div>

            {/* Admin Menu */}
            <div className="space-y-1">
              {adminIndex.permissions?.requireApproval && (
                <div
                  onClick={() => router.push(`/admin/${adminIndexId}/approvals`)}
                  className={`flex items-center justify-between px-3 py-2 rounded cursor-pointer transition-colors ${
                    pathname?.includes('/approvals') ? 'bg-gray-200' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Inbox className="w-4 h-4 text-gray-600" />
                    <span className="text-sm text-black font-ibm-plex-mono">Approval</span>
                  </div>
                  {pendingCount > 0 && (
                    <span className="bg-blue-100 text-blue-600 text-xs px-2 py-0.5 rounded-full font-ibm-plex-mono">
                      {pendingCount}
                    </span>
                  )}
                </div>
              )}

              <div
                onClick={() => router.push(`/admin/${adminIndexId}/directory`)}
                className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-colors ${
                  pathname?.includes('/directory') ? 'bg-gray-200' : 'hover:bg-gray-50'
                }`}
              >
                <Users className="w-4 h-4 text-gray-600" />
                <span className="text-sm text-black font-ibm-plex-mono">Directory</span>
              </div>

              <div
                onClick={() => router.push(`/admin/${adminIndexId}/settings`)}
                className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer transition-colors ${
                  pathname?.includes('/settings') ? 'bg-gray-200' : 'hover:bg-gray-50'
                }`}
              >
                <Settings className="w-4 h-4 text-gray-600" />
                <span className="text-sm text-black font-ibm-plex-mono">Settings</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        /* Normal Sidebar */
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

                const isOwner = currentUser && index.fullIndex?.user && currentUser.id === index.fullIndex.user.id;

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
                    <div className="flex items-center gap-1">
                      {/* Admin button for owners */}
                      {isOwner && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/admin/${index.id}`);
                          }}
                          className="p-1 cursor-pointer rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-200"
                          title="Admin - Approve Connections"
                        >
                          <Crown className="w-4 h-4 text-blue-600" />
                        </button>
                      )}
                      {/* Manage what you're sharing button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (index.fullIndex) {
                            handleMemberSettings(index.fullIndex);
                          }
                        }}
                        className="p-1 cursor-pointer rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-200"
                        title="Manage what you're sharing"
                      >
                        <Users className="w-4 h-4 text-gray-600" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {memberSettingsIndex && (
        <MemberSettingsModal
          open={!!memberSettingsIndex}
          onOpenChange={(open) => !open && setMemberSettingsIndex(null)}
          index={memberSettingsIndex}
        />
      )}
    </div>
  );
}
