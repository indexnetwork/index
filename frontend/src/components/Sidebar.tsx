'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useIndexesState } from '@/contexts/IndexesContext';
import LibraryModal from '@/components/modals/LibraryModal';
import { Shield, ArrowLeft, Inbox, Users, Settings } from 'lucide-react';
import { useAdmin, useIntents } from '@/contexts/APIContext';

interface LatestIntent {
  id: string;
  payload: string;
  summary?: string | null;
  createdAt: string;
}

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { indexes: rawIndexes } = useIndexesState();
  const adminService = useAdmin();
  const intentsService = useIntents();
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [latestIntents, setLatestIntents] = useState<LatestIntent[]>([]);
  const [loadingIntents, setLoadingIntents] = useState(false);
  const [libraryModalOpen, setLibraryModalOpen] = useState(false);
  
  // Check if we're in admin mode
  const isAdminMode = pathname?.startsWith('/admin/');
  const adminIndexId = isAdminMode ? pathname?.split('/admin/')[1]?.split('/')[0] : null;
  const adminIndex = rawIndexes?.find(idx => idx.id === adminIndexId);

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

  // Fetch latest intents (only in normal mode, not admin mode)
  useEffect(() => {
    if (isAdminMode) return;
    
    const fetchLatestIntents = async () => {
      try {
        setLoadingIntents(true);
        const response = await intentsService.getIntents(1, 5, false);
        // API returns { intents, pagination } not { data, pagination }
        setLatestIntents((response as { intents?: LatestIntent[] }).intents?.slice(0, 5) || []);
      } catch (error) {
        console.error('Failed to fetch latest intents:', error);
      } finally {
        setLoadingIntents(false);
      }
    };

    fetchLatestIntents();
  }, [isAdminMode, intentsService]);

  return (
    <div className="space-y-6 font-mono">
      {/* Admin Mode Sidebar */}
      {isAdminMode && adminIndex ? (
        <div className="bg-white rounded-sm border-black border p-4">
          <button
            onClick={() => router.push('/')}
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
      ) : (
        /* Latest Intents Section */
        <div className="bg-white rounded-sm border-black border p-3 pb-6 pt-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-black font-ibm-plex-mono">Latest</h3>
            <button
              onClick={() => setLibraryModalOpen(true)}
              className="text-xs text-gray-600 hover:text-black font-ibm-plex-mono transition-colors"
            >
              View all
            </button>
          </div>
          {loadingIntents ? (
            <div className="text-center text-gray-500 py-4 text-sm">
              Loading...
            </div>
          ) : latestIntents.length === 0 ? (
            <div className="text-center text-gray-500 py-4 text-sm">
              No intents yet
            </div>
          ) : (
            <div className="space-y-2">
              {latestIntents.map((intent) => (
                <button
                  key={intent.id}
                  onClick={() => router.push(`/i/${intent.id}`)}
                  className="w-full text-left px-2 py-2 rounded hover:bg-gray-50 transition-colors group"
                >
                  <div className="text-sm text-black font-ibm-plex-mono line-clamp-2 mb-1 group-hover:text-gray-700">
                    {intent.summary || intent.payload}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <LibraryModal
        open={libraryModalOpen}
        onOpenChange={setLibraryModalOpen}
      />
    </div>
  );
}
