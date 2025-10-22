"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import * as Tabs from "@radix-ui/react-tabs";
import { Upload } from "lucide-react";
import { useConnections, useSynthesis, useDiscover } from "@/contexts/APIContext";
import { useIndexFilter } from "@/contexts/IndexFilterContext";
import { useDiscoveryFilter } from "@/contexts/DiscoveryFilterContext";
import { StakesByUserResponse, UserConnection } from "@/lib/types";
import { getAvatarUrl } from "@/lib/file-utils";
import { formatDate } from "@/lib/utils";
import ClientLayout from "@/components/ClientLayout";
import ConnectionActions, { ConnectionAction } from "@/components/ConnectionActions";
import DiscoveryForm from "@/components/DiscoveryForm";
import SynthesisMarkdown from "@/components/SynthesisMarkdown";

const validTabs = ['discover', 'requests'];

export default function InboxPage() {
  // URL & Navigation State
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(
    urlTab && validTabs.includes(urlTab) ? urlTab : 'discover'
  );

  // Data State
  const [discoverStakes, setDiscoverStakes] = useState<StakesByUserResponse[]>([]);
  const [inboxConnections, setInboxConnections] = useState<UserConnection[]>([]);
  const [pendingConnections, setPendingConnections] = useState<UserConnection[]>([]);
  const [syntheses, setSyntheses] = useState<Record<string, string>>({});
  const [synthesisLoading, setSynthesisLoading] = useState<Record<string, boolean>>({});

  // UI State
  const [loading, setLoading] = useState(true);
  const [requestsView, setRequestsView] = useState<'received' | 'sent'>('received');
  const [isDragging, setIsDragging] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);

  // Refs
  const fetchedSynthesesRef = useRef<Set<string>>(new Set());
  const lastDataRef = useRef<string>('');
  const lastRefreshTimeRef = useRef<number>(0);
  const dragCounterRef = useRef(0);
  const discoveryFormRef = useRef<{ handleFileDrop: (files: FileList) => void }>(null);
  const popoverControlRef = useRef<{ close: () => void } | null>(null);

  // Context Hooks
  const { selectedIndexIds } = useIndexFilter();
  const { discoveryIntents, setDiscoveryIntents } = useDiscoveryFilter();

  // Service Hooks
  const connectionsService = useConnections();
  const synthesisService = useSynthesis();
  const discoverService = useDiscover();

  // Fetch synthesis for a user
  const fetchSynthesis = useCallback(async (targetUserId: string, intentIds?: string[], indexIds?: string[]) => {
    const cacheKey = `${targetUserId}-${(indexIds || []).sort().join(',')}`;
    if (fetchedSynthesesRef.current.has(cacheKey)) {
      return;
    }

    fetchedSynthesesRef.current.add(cacheKey);
    setSynthesisLoading(prev => ({ ...prev, [targetUserId]: true }));

    try {
      const response = await synthesisService.generateVibeCheck({
        targetUserId,
        intentIds,
        indexIds
      });
      setSyntheses(prev => ({ ...prev, [targetUserId]: response.synthesis }));
    } catch (error) {
      console.error('Error fetching synthesis:', error);
      setSyntheses(prev => ({ ...prev, [targetUserId]: "" }));
    } finally {
      setSynthesisLoading(prev => ({ ...prev, [targetUserId]: false }));
    }
  }, [synthesisService]);

  // Fetch all inbox data
  const fetchData = useCallback(async () => {
    try {
      const apiIndexIds = selectedIndexIds.length > 0 ? selectedIndexIds : undefined;
      
      const [inboxData, pendingData, discoverData] = await Promise.all([
        connectionsService.getConnectionsByUser('inbox', apiIndexIds),
        connectionsService.getConnectionsByUser('pending', apiIndexIds),
        discoverService.discoverUsers({ 
          indexIds: apiIndexIds, 
          intentIds: discoveryIntents?.map(i => i.id),
          excludeDiscovered: true, 
          limit: 50 
        })
      ]);

      // Transform discover data
      const transformedStakesData: StakesByUserResponse[] = (discoverData?.results || []).map(result => ({
        user: {
          id: result.user.id,
          name: result.user.name,
          avatar: result.user.avatar || '',
        },
        intents: (result.intents || []).map(stake => ({
          intent: {
            id: stake.intent.id,
            summary: stake.intent.summary,
            payload: stake.intent.payload,
            updatedAt: stake.intent.createdAt,
          },
          totalStake: String(stake.totalStake),
          agents: []
        }))
      }));

      // Check if data has changed
      const currentDataHash = JSON.stringify({
        discover: transformedStakesData.map(s => ({ userId: s.user.id, intentIds: s.intents.map(i => i.intent.id) })),
        inbox: inboxData.connections.map(c => c.user.id),
        pending: pendingData.connections.map(c => c.user.id)
      });
      
      if (currentDataHash !== lastDataRef.current) {
        lastDataRef.current = currentDataHash;
        
        setDiscoverStakes(transformedStakesData);
        setInboxConnections(inboxData.connections);
        setPendingConnections(pendingData.connections);

        // Clear and refetch synthesis
        fetchedSynthesesRef.current.clear();
        setSyntheses({});

        const allUserIds = new Set<string>();
        transformedStakesData.forEach(stake => allUserIds.add(stake.user.id));
        [...inboxData.connections, ...pendingData.connections]
          .forEach(connection => allUserIds.add(connection.user.id));

        allUserIds.forEach(userId => {
          fetchSynthesis(userId, undefined, apiIndexIds);
        });
      }
      
      lastRefreshTimeRef.current = Date.now();

    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, [connectionsService, discoverService, fetchSynthesis, selectedIndexIds, discoveryIntents]);

  // Tab change handler
  const handleTabChange = (newTab: string) => {
    if (!validTabs.includes(newTab)) return;
    
    setActiveTab(newTab);
    const params = new URLSearchParams(searchParams.toString());
    
    if (newTab === 'discover') {
      params.delete('tab');
      const queryString = params.toString();
      router.push(`/inbox${queryString ? `?${queryString}` : ''}`);
    } else {
      params.set('tab', newTab);
      router.push(`/inbox?${params.toString()}`);
    }
  };

  // Connection action handler
  const handleConnectionAction = async (action: ConnectionAction, userId: string) => {
    try {
      switch (action) {
        case 'REQUEST':
          await connectionsService.requestConnection(userId);
          break;
        case 'SKIP':
          await connectionsService.skipConnection(userId);
          break;
        case 'ACCEPT':
          await connectionsService.acceptConnection(userId);
          break;
        case 'DECLINE':
          await connectionsService.declineConnection(userId);
          break;
        case 'CANCEL':
          await connectionsService.cancelConnection(userId);
          break;
      }
      await fetchData();
    } catch (error) {
      console.error('Error handling connection action:', error);
    }
  };

  // Helper: Get connection status for rendering
  const getConnectionStatus = (tabType: 'discover' | 'requests', viewType?: 'received' | 'sent'): 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'declined' | 'skipped' => {
    if (tabType === 'discover') {
      return 'none';
    }
    if (tabType === 'requests') {
      return viewType === 'sent' ? 'pending_sent' : 'pending_received';
    }
    return 'none';
  };

  // Sync tab state with URL changes
  useEffect(() => {
    const urlTab = searchParams.get('tab');
    if (urlTab && validTabs.includes(urlTab)) {
      setActiveTab(urlTab);
    } else if (!urlTab) {
      setActiveTab('discover');
    }
  }, [searchParams]);

  // Initial data fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const intervalId = setInterval(() => {
      const timeSinceLastRefresh = Date.now() - lastRefreshTimeRef.current;
      if (timeSinceLastRefresh >= 5000) {
        fetchData();
      }
    }, 5000);

    return () => clearInterval(intervalId);
  }, [fetchData]);

  // Drag and drop for file upload
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (activeTab !== 'discover' || discoveryIntents) return;
      
      dragCounterRef.current++;
      if (e.dataTransfer?.types.includes('Files')) {
        setIsDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current--;
      if (dragCounterRef.current === 0) {
        setIsDragging(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);
      
      if (activeTab !== 'discover' || discoveryIntents) return;
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        discoveryFormRef.current?.handleFileDrop(e.dataTransfer.files);
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [activeTab, discoveryIntents]);

  // Render user card component
  const renderUserCard = (
    data: StakesByUserResponse | UserConnection, 
    tabType: 'discover' | 'requests'
  ) => {
    const isStakeCard = 'intents' in data;
    const user = data.user;
    const intents = isStakeCard ? data.intents : undefined;
    const lastUpdated = !isStakeCard ? (data as UserConnection).lastUpdated : undefined;

    return (
      <div key={user.id} className="p-0 mt-0 bg-white border border-b-2 border-gray-800 mb-4">
        <div className="py-4 px-2 sm:px-4 ">
          {/* User Header */}
          <div className="flex flex-wrap sm:flex-nowrap justify-between items-start mb-4">
            <div className="flex items-center gap-4 w-full sm:w-auto mb-2 sm:mb-0">
              <Image
                src={getAvatarUrl(user)}
                alt={user.name}
                width={48}
                height={48}
                className="rounded-full"
              />
              <div>
                <h2 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">{user.name}</h2>
                <div className="flex items-center gap-4 text-sm text-gray-500 font-ibm-plex-mono">
                  {intents !== undefined ? (
                    intents.length > 0 ? (
                      <span>{intents.length} mutual intent{intents.length !== 1 ? 's' : ''}</span>
                    ) : (
                      <span>Potential connection</span>
                    )
                  ) : (
                    <span>{formatDate(lastUpdated!)}</span>
                  )}
                </div>
              </div>
            </div>
            {/* Connection Actions */}
            <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
              <ConnectionActions
                userId={user.id}
                userName={user.name}
                connectionStatus={getConnectionStatus(tabType, requestsView)}
                onAction={handleConnectionAction}
                size="sm"
              />
            </div>
          </div>

          {/* Synthesis Section */}
          {(synthesisLoading[user.id] || syntheses[user.id]) && (
            <div className="mb-4">
              <h3 className="font-medium text-gray-700 mb-2 text-sm">What could happen here</h3>
              {synthesisLoading[user.id] ? (
                <div className="animate-pulse space-y-2">
                  <div className="h-3 bg-gray-200 rounded w-full"></div>
                  <div className="h-3 bg-gray-200 rounded w-full"></div>
                  <div className="h-3 bg-gray-200 rounded w-11/12"></div>
                  <div className="h-3 bg-gray-200 rounded w-full"></div>
                  <div className="h-3 bg-gray-200 rounded w-10/12"></div>
                  <div className="h-3 bg-gray-200 rounded w-full"></div>
                  <div className="h-3 bg-gray-200 rounded w-9/12"></div>
                  <div className="mt-3 pt-2">
                    <div className="h-3 bg-gray-200 rounded w-3/4"></div>
                  </div>
                </div>
              ) : (
                <SynthesisMarkdown 
                  content={syntheses[user.id]}
                  className="text-gray-700 text-sm leading-relaxed prose prose-sm max-w-none [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mb-1 [&_p]:mb-2 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-sm"
                  onArchive={fetchData}
                  popoverControlRef={popoverControlRef}
                />
              )}            </div>
          )}

          {/* Mutual Intents */}
          {intents && intents.length > 0 && (
            <div className="mb-4">
              <h3 className="font-medium text-gray-700 mb-2 text-sm">Mutual intents ({intents.length})</h3>
              <div className="flex flex-wrap gap-2">
                {intents.map((intentConnection) => (
                  <div key={intentConnection.intent.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200">
                    <h4 className="text-sm font-ibm-plex-mono font-light text-gray-900">
                      {intentConnection.intent.summary || 'Untitled Intent'}
                    </h4>
                    <span className="text-gray-400 text-xs">({intentConnection.totalStake})</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Loading state
  if (loading) {
    return (
      <ClientLayout>
        <div className="w-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
          backgroundImage: 'url(/grid.png)',
          backgroundColor: 'white',
          backgroundSize: '888px'
        }}>
          <div className="p-0 mt-0 bg-white border border-b-2 border-gray-800 py-2 text-center text-gray-500">
            <div className="py-8 text-center text-gray-500">Loading...</div>
          </div>
        </div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      {/* Drag and Drop Overlay */}
      {isDragging && (
        <div
          className="fixed inset-0 z-[99999] flex items-center justify-center transition-opacity backdrop-blur-xs"
          style={{
            minHeight: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.2)'
          }}
        >
          <div 
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundImage: 'url(/noise.jpg)',
              backgroundSize: 'auto',
              opacity: 0.1
            }}
          />
          <div className="relative z-10 bg-white border-1 rounded-sm  border-black px-6 py-4 flex flex-col items-center gap-3  w-[340px]">
            <Upload className="w-8 h-8 text-black" />
            <p className="text-base font-ibm-plex-mono text-gray-700 text-center leading-snug">
              Drop file(s) here to discover relevant connections
            </p>
          </div>
        </div>
      )}

      <div className="w-full border border-gray-800 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
          backgroundImage: 'url(/grid.png)',
          backgroundColor: 'white',
          backgroundSize: '888px'
        }}>

        <div className="flex flex-col justify-between mb-4">
          {/* Header section */}
          <div className="space-y-4">
            {/* Discovery input section */}
            {activeTab === 'discover' && (
              <div className="flex gap-4 items-start">
                {!discoveryIntents ? (
                  <div className="flex-1">
                    <DiscoveryForm 
                      ref={discoveryFormRef}
                      onSubmit={(intents) => {
                        setDiscoveryIntents(intents);
                        setShowSuccessMessage(true);
                        setTimeout(() => setShowSuccessMessage(false), 20000);
                      }}
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 px-4 py-3 bg-black text-white border border-b-2 border-black font-ibm-plex-mono text-sm h-[54px]">
                      <span>{discoveryIntents[0]?.summary || discoveryIntents[0]?.payload || 'Discovery filter'}</span>
                      <button
                        onClick={() => setDiscoveryIntents(undefined)}
                        className="ml-2 hover:opacity-70 transition-opacity flex-shrink-0"
                        aria-label="Clear filter"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M12 4L4 12M4 4L12 12" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                      </button>
                    </div>
                    <div className="flex-1"></div>
                  </>
                )}
                <button
                  onClick={() => handleTabChange('requests')}
                  className="font-ibm-plex-mono px-4 py-3 border border-b-2 border-black bg-white hover:bg-gray-50 flex items-center gap-2 text-black whitespace-nowrap h-[54px]"
                >
                  View Requests
                  <span className="bg-black text-white text-xs px-2 py-1 rounded">
                    {inboxConnections.length + pendingConnections.length}
                  </span>
                </button>
              </div>
            )}
            
            {/* Requests view button */}
            {activeTab === 'requests' && (
              <div className="flex justify-end">
                <button
                  onClick={() => handleTabChange('discover')}
                  className="font-ibm-plex-mono px-4 py-3 border border-black bg-black text-white hover:bg-gray-800 flex items-center gap-2"
                >
                  Back to Discovery
                  <span className="bg-white text-black text-xs px-2 py-1 rounded">
                    {discoverStakes.length}
                  </span>
                </button>
                </div>
            )}
            </div>

          <Tabs.Root value={activeTab} onValueChange={handleTabChange} className="flex-grow">

            {/* Discover Content */}
            {activeTab === 'discover' && (
              <div className="mt-4">
                {discoverStakes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center bg-white border border-black border-b-0 border-b-2 px-6 pb-8">
                    <Image 
                      className="h-auto"
                      src={'/loading2.gif'} 
                      alt="Loading..." 
                      width={300} 
                      height={200} 
                      style={{ imageRendering: 'auto' }}
                    />
                    {showSuccessMessage ? (
                      <>
                        <h3 className="text-gray-900 font-bold font-ibm-plex-mono text-lg px-8 mt-4 text-center">
                          Got the signal!
                        </h3>
                        <p className="text-gray-900 font-500 font-ibm-plex-mono text-sm px-8 mt-2 text-center">
                          Passing it along to the right folks, let's see what unfolds.
                        </p>
                      </>
                    ) : (
                      <>
                        <h3 className="text-gray-900 font-semibold font-ibm-plex-mono text-lg px-8 mt-4 text-center">
                          No relevant connections for now.
                        </h3>
                        <p className="text-gray-900 font-500 font-ibm-plex-mono text-sm px-8 mt-2 text-center">
                          It's not you, the world's just being shy. Don't worry, I'll keep looking.
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  discoverStakes.map((userStake) => renderUserCard(userStake, 'discover'))
                )}
              </div>
            )}

            {/* Requests Content */}
            {activeTab === 'requests' && (
              <div>
                <Tabs.Root value={requestsView} onValueChange={(value) => setRequestsView(value as 'received' | 'sent')}>
                  <Tabs.List className="overflow-x-auto inline-flex text-sm text-black">
                    <Tabs.Trigger 
                      value="received" 
                      className="font-ibm-plex-mono cursor-pointer border border-b-0 border-r-0 border-black px-3 py-2 bg-white data-[state=active]:bg-black data-[state=active]:text-white"
                    >
                      Incoming
                      {inboxConnections.length > 0 && (
                        <span className="ml-2 bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full data-[state=active]:bg-white data-[state=active]:text-black">
                          {inboxConnections.length}
                        </span>
                      )}
                    </Tabs.Trigger>
                    <Tabs.Trigger 
                      value="sent" 
                      className="font-ibm-plex-mono cursor-pointer border border-b-0 border-black px-3 py-2 bg-white data-[state=active]:bg-black data-[state=active]:text-white"
                    >
                      Sent
                      {pendingConnections.length > 0 && (
                        <span className="ml-2 bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full data-[state=active]:bg-white data-[state=active]:text-black">
                          {pendingConnections.length}
                        </span>
                      )}
                    </Tabs.Trigger>
                  </Tabs.List>

                  <Tabs.Content value="received" className="p-0 mt-0 bg-white border border-b-2 border-gray-800">
                    {inboxConnections.length === 0 ? (
                      <div className="py-8 text-center text-gray-500">
                        No incoming connection requests. All caught up!
                      </div>
                    ) : (
                      inboxConnections.map((connection) => renderUserCard(connection, 'requests'))
                    )}
                  </Tabs.Content>

                  <Tabs.Content value="sent" className="p-0 mt-0 bg-white">
                    {pendingConnections.length === 0 ? (
                      <div className="py-8 text-center text-gray-500">No sent requests.</div>
                    ) : (
                      pendingConnections.map((connection) => renderUserCard(connection, 'requests'))
                    )}
                  </Tabs.Content>
                </Tabs.Root>
              </div>
            )}
          </Tabs.Root>
        </div>
      </div>
    </ClientLayout>
  );
}
