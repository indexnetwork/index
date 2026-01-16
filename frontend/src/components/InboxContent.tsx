"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import { Upload, Sparkles } from "lucide-react";
import { useConnections, useSynthesis, useDiscover } from "@/contexts/APIContext";
import { useIndexFilter } from "@/contexts/IndexFilterContext";
import { useDiscoveryFilter } from "@/contexts/DiscoveryFilterContext";
import { StakesByUserResponse, UserConnection } from "@/lib/types";
import { getAvatarUrl } from "@/lib/file-utils";
import { formatDate } from "@/lib/utils";
import ClientLayout from "@/components/ClientLayout";
import ConnectionActions, { ConnectionAction } from "@/components/ConnectionActions";
import DiscoveryForm, { DiscoveryFormRef } from "@/components/DiscoveryForm";
import SynthesisMarkdown from "@/components/SynthesisMarkdown";
import { InboxProvider, setGlobalInboxState } from "@/contexts/InboxContext";

const validTabs = ['discover', 'requests', 'history'];

export default function InboxContent() {
  // URL & Navigation State
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<'discover' | 'requests' | 'history'>(
    urlTab && validTabs.includes(urlTab) ? urlTab as 'discover' | 'requests' | 'history' : 'discover'
  );

  // Data State
  const [discoverStakes, setDiscoverStakes] = useState<StakesByUserResponse[]>([]);
  const [inboxConnections, setInboxConnections] = useState<UserConnection[]>([]);
  const [pendingConnections, setPendingConnections] = useState<UserConnection[]>([]);
  const [historyConnections, setHistoryConnections] = useState<UserConnection[]>([]);
  const [syntheses, setSyntheses] = useState<Record<string, string>>({});
  const [synthesisLoading, setSynthesisLoading] = useState<Record<string, boolean>>({});

  // UI State
  const [discoveryLoading, setDiscoveryLoading] = useState(true);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [requestsView, setRequestsView] = useState<'received' | 'sent' | 'history'>('received');
  const [isDragging, setIsDragging] = useState(false);
  const [showSuccessMessage] = useState(false);
  const [optimisticStatus, setOptimisticStatus] = useState<Record<string, ConnectionAction | null>>({});

  // Refs
  const fetchedSynthesesRef = useRef<Set<string>>(new Set());
  const lastRefreshTimeRef = useRef<number>(0);
  const dragCounterRef = useRef(0);
  const discoveryFormRef = useRef<DiscoveryFormRef>(null);
  const popoverControlRef = useRef<{ close: () => void } | null>(null);
  const hasInitialFetchRef = useRef(false);
  const isFetchingRef = useRef(false);
  const prevFiltersRef = useRef<string>('');

  // Context Hooks
  const { selectedIndexIds } = useIndexFilter();
  const { discoveryIntents, setDiscoveryIntents } = useDiscoveryFilter();

  // Service Hooks
  const connectionsService = useConnections();
  const synthesisService = useSynthesis();
  const discoverService = useDiscover();

  // Memoize API parameters to prevent unnecessary recreations
  const apiIndexIds = useMemo(() =>
    selectedIndexIds.length > 0 ? selectedIndexIds : undefined,
    [selectedIndexIds]
  );

  const apiIntentIds = useMemo(() =>
    discoveryIntents?.map(i => i.id),
    [discoveryIntents]
  );

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

  // Fetch discovery data (default tab - priority)
  const fetchDiscovery = useCallback(async () => {
    try {
      const discoverData = await discoverService.discoverUsers({
        indexIds: apiIndexIds,
        intentIds: apiIntentIds,
        excludeDiscovered: true,
        limit: 25
      });

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

      setDiscoverStakes(transformedStakesData);

      // Fetch synthesis for discovery users
      transformedStakesData.forEach(stake => {
        fetchSynthesis(stake.user.id, undefined, apiIndexIds);
      });

      lastRefreshTimeRef.current = Date.now();
    } catch (error) {
      console.error('Error fetching discovery:', error);
    } finally {
      setDiscoveryLoading(false);
    }
  }, [discoverService, fetchSynthesis, apiIndexIds, apiIntentIds]);

  // Fetch connections data (non-blocking background load)
  const fetchConnections = useCallback(async () => {
    try {
      const [inboxData, pendingData, historyData] = await Promise.all([
        connectionsService.getConnectionsByUser('inbox', apiIndexIds),
        connectionsService.getConnectionsByUser('pending', apiIndexIds),
        connectionsService.getConnectionsByUser('history', apiIndexIds),
      ]);

      setInboxConnections(inboxData.connections);
      setPendingConnections(pendingData.connections);
      setHistoryConnections(historyData.connections);

      // Fetch synthesis for connection users
      [...inboxData.connections, ...pendingData.connections, ...historyData.connections].forEach(connection => {
        fetchSynthesis(connection.user.id, undefined, apiIndexIds);
      });

    } catch (error) {
      console.error('Error fetching connections:', error);
    } finally {
      setConnectionsLoading(false);
    }
  }, [connectionsService, fetchSynthesis, apiIndexIds]);

  // Unified fetch function - handles both initial load and refresh
  const fetchData = useCallback(async (options?: {
    showLoading?: boolean;
    clearSyntheses?: boolean;
  }) => {
    // Prevent concurrent fetches
    if (isFetchingRef.current) {
      return;
    }
    isFetchingRef.current = true;

    const { showLoading = true, clearSyntheses = true } = options || {};

    try {
      if (showLoading) {
        setDiscoveryLoading(true);
        setConnectionsLoading(true);
      }

      if (clearSyntheses) {
        fetchedSynthesesRef.current.clear();
        setSyntheses({});
      }

      // Load discovery and connections in parallel
      await Promise.all([fetchDiscovery(), fetchConnections()]);
    } finally {
      isFetchingRef.current = false;
    }
  }, [fetchDiscovery, fetchConnections]);

  // Tab change handler
  const handleTabChange = useCallback((newTab: 'discover' | 'requests' | 'history') => {
    if (!validTabs.includes(newTab)) return;

    setActiveTab(newTab);
    const params = new URLSearchParams(searchParams.toString());

    if (newTab === 'discover') {
      params.delete('tab');
      const queryString = params.toString();
      router.push(`/${queryString ? `?${queryString}` : ''}`);
    } else {
      params.set('tab', newTab);
      router.push(`/?${params.toString()}`);
    }
  }, [searchParams, router]);

  // Connection action handler
  const handleConnectionAction = useCallback(async (action: ConnectionAction, userId: string) => {
    // Optimistic update helper
    const updateLocalState = () => {
      // Find the user in any of the lists
      const inboxUser = inboxConnections.find(c => c.user.id === userId);
      const pendingUser = pendingConnections.find(c => c.user.id === userId);
      const historyUser = historyConnections.find(c => c.user.id === userId);
      const userConnection = inboxUser || pendingUser || historyUser;

      if (!userConnection) return;

      // Remove from all lists initially
      setInboxConnections(prev => prev.filter(c => c.user.id !== userId));
      setPendingConnections(prev => prev.filter(c => c.user.id !== userId));
      setHistoryConnections(prev => prev.filter(c => c.user.id !== userId));

      // Add to appropriate list based on action
      const now = new Date().toISOString();
      const updatedConnection = { ...userConnection, lastUpdated: now, status: action };

      switch (action) {
        case 'ACCEPT':
          setHistoryConnections(prev => [updatedConnection, ...prev]);
          break;
        case 'DECLINE':
          setHistoryConnections(prev => [updatedConnection, ...prev]);
          break;
        case 'SKIP':
          setHistoryConnections(prev => [updatedConnection, ...prev]);
          break;
        case 'REQUEST':
          setPendingConnections(prev => [updatedConnection, ...prev]);
          break;
        case 'CANCEL':
          setHistoryConnections(prev => [updatedConnection, ...prev]);
          break;
      }
    };

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

      // Update local state after successful server response
      updateLocalState();
      setOptimisticStatus(prev => ({ ...prev, [userId]: action }));

      // Refresh data in background without loading state
      await fetchData({ showLoading: false, clearSyntheses: false });
    } catch (error) {
      console.error('Error handling connection action:', error);

      // Refresh to get true state
      await fetchData({ showLoading: false, clearSyntheses: false });

      // Re-throw so the UI component can handle it
      throw error;
    }
  }, [connectionsService, fetchData, inboxConnections, pendingConnections, historyConnections]);

  // Handler for navigating to user profile page
  const handleUserClick = useCallback((user: { id: string; name: string; avatar: string | null }) => {
    router.push(`/u/${user.id}`);
  }, [router]);

  // Helper: Get connection status for rendering
  const getConnectionStatus = useCallback((tabType: 'discover' | 'requests', viewType: 'received' | 'sent' | 'history' | undefined, userId: string): 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'declined' | 'skipped' => {
    // Check optimistic status first
    if (optimisticStatus[userId]) {
      const action = optimisticStatus[userId];
      switch (action) {
        case 'REQUEST': return 'pending_sent';
        case 'SKIP': return 'skipped';
        case 'ACCEPT': return 'connected';
        case 'DECLINE': return 'declined';
        case 'CANCEL': return 'none'; // effectively resets to none for discover
      }
    }

    if (tabType === 'discover') {
      return 'none';
    }
    if (tabType === 'requests') {
      if (viewType === 'sent') return 'pending_sent';
      if (viewType === 'received') return 'pending_received';
      if (viewType === 'history') return 'connected';
    }
    return 'none';
  }, [optimisticStatus]);

  // Sync tab state with URL changes
  useEffect(() => {
    const urlTab = searchParams.get('tab');
    if (urlTab && validTabs.includes(urlTab)) {
      setActiveTab(urlTab as 'discover' | 'requests' | 'history');
    } else if (!urlTab) {
      setActiveTab('discover');
    }
  }, [searchParams]);

  // Initial data fetch - only run once on mount
  useEffect(() => {
    if (!hasInitialFetchRef.current) {
      hasInitialFetchRef.current = true;
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Refetch when filters change (but not on initial mount)
  useEffect(() => {
    if (!hasInitialFetchRef.current) {
      return;
    }

    // Serialize filter values for comparison
    const currentFilters = JSON.stringify({
      indexIds: apiIndexIds?.sort() || [],
      intentIds: apiIntentIds?.sort() || []
    });

    // Only refetch if filters actually changed
    if (prevFiltersRef.current !== currentFilters) {
      prevFiltersRef.current = currentFilters;
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiIndexIds, apiIntentIds]); // Only depend on actual filter values

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const intervalId = setInterval(() => {
      // Don't trigger if there's a pending request
      if (isFetchingRef.current) {
        return;
      }

      const timeSinceLastRefresh = Date.now() - lastRefreshTimeRef.current;
      if (timeSinceLastRefresh >= 5000) {
        // Auto-refresh: preserve syntheses and don't show loading to avoid UI glitches
        fetchData({ showLoading: false, clearSyntheses: false });
      }
    }, 10000);

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
  const renderUserCard = useCallback((
    data: StakesByUserResponse | UserConnection,
    tabType: 'discover' | 'requests'
  ) => {
    const isStakeCard = 'intents' in data;
    const user = data.user;
    const intents = isStakeCard ? data.intents : undefined;
    const lastUpdated = !isStakeCard ? (data as UserConnection).lastUpdated : undefined;

    return (
      <div key={user.id} className="pt-4">
        {/* User Header */}
        <div className="flex flex-wrap sm:flex-nowrap justify-between items-start mb-4">
          <div className="flex items-center gap-4 w-full sm:w-auto mb-2 sm:mb-0">
            <button
              onClick={() => handleUserClick(user)}
              className="flex-shrink-0 cursor-pointer transition-opacity hover:opacity-80"
            >
              <Image
                src={getAvatarUrl(user)}
                alt={user.name}
                width={36}
                height={36}
                className="rounded-full"
              />
            </button>
            <div>
              <button
                onClick={() => handleUserClick(user)}
                className="cursor-pointer transition-opacity hover:opacity-80"
              >
                <h2 className="font-bold text-md text-gray-900 font-ibm-plex-mono text-left">{user.name}</h2>
              </button>
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
              userAvatar={user.avatar || undefined}
              connectionStatus={getConnectionStatus(tabType, requestsView, user.id)}
              onAction={handleConnectionAction}
              size="sm"
            />
          </div>
        </div>

        {/* Synthesis Section */}
        {(synthesisLoading[user.id] || syntheses[user.id]) && (
          <div className="mb-4">
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
                className="text-gray-700 text-sm leading-relaxed prose prose-sm max-w-none [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mb-1 [&_p]:mb-2 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-sm synthesis-markdown-content"
                onArchive={fetchData}
                popoverControlRef={popoverControlRef}
              />
            )}
          </div>
        )}
      </div>
    );
  }, [synthesisLoading, syntheses, requestsView, handleConnectionAction, handleUserClick, fetchData, getConnectionStatus]);


  // Create context value
  const inboxContextValue = useMemo(() => ({
    activeTab,
    setActiveTab: handleTabChange,
    requestsView,
    setRequestsView,
    inboxConnectionsCount: inboxConnections.length,
    pendingConnectionsCount: pendingConnections.length,
    historyConnectionsCount: historyConnections.length,
    connectionsLoading,
    discoverStakesCount: discoverStakes.length,
  }), [activeTab, handleTabChange, requestsView, inboxConnections.length, pendingConnections.length, historyConnections.length, connectionsLoading, discoverStakes.length]);

  // Update global state so ChatSidebar can access it
  useEffect(() => {
    setGlobalInboxState(inboxContextValue);
    return () => {
      setGlobalInboxState(null);
    };
  }, [inboxContextValue]);

  // Handle back navigation - clear intent and navigate to root
  const handleBackToInbox = useCallback(() => {
    setDiscoveryIntents(undefined);
    router.push('/');
  }, [router, setDiscoveryIntents]);

  return (
    <InboxProvider value={inboxContextValue}>
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
              backgroundSize: 'cover',
              opacity: 0.3
            }}
          />
          <div className="relative z-10 bg-white border-1 rounded-sm border-black px-6 py-4 flex flex-col items-center gap-3 w-[340px]">
            <Upload className="w-8 h-8 text-black" />
            <p className="text-base font-ibm-plex-mono text-gray-700 text-center leading-snug">
              Drop file(s) here to discover relevant connections
            </p>
          </div>
        </div>
      )}

      {/* Discovery input - separate row above content when no intent selected */}
      {activeTab === 'discover' && !discoveryIntents && (
        <DiscoveryForm
          ref={discoveryFormRef}
          floating={false}
          onSubmit={(intents) => {
            if (intents && intents.length > 0) {
              router.push(`/i/${intents[0].id}`);
            }
          }}
        />
      )}

      <div className="bg-white w-full h-full border border-gray-800 rounded-sm px-4 py-2 flex flex-col">
        {!discoveryIntents && (
          <div className="font-ibm-plex-mono text-black text-sm font-bold mb-4 flex items-center gap-2" style={{ marginTop: '8px' }}>
            <Sparkles className="w-4 h-4" />
            Waiting for action
          </div>
        )}

        <div className="flex flex-col justify-between mb-4 flex-1">
          {/* Header section - Intent title display when intent is selected */}
          {activeTab === 'discover' && discoveryIntents && (
            <div className="bg-white pb-2 border-b border-gray-200 mb-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleBackToInbox}
                  className="cursor-pointer transition-opacity hover:opacity-80 text-black text-xl font-bold mr-2"
                >
                  ←
                </button>
                <div className="font-ibm-plex-mono text-black text-lg" style={{ fontWeight: 'bold', marginTop: '8px' }}>
                  {discoveryIntents[0]?.summary || discoveryIntents[0]?.payload || 'Discovery filter'}
                </div>
              </div>
            </div>
          )}

          {/* Discover Content */}
          {activeTab === 'discover' && (
            <div className={`bg-white ${discoveryIntents ? 'flex-1 overflow-y-auto' : ''}`}>
              {discoveryLoading ? (
                <div className="flex flex-col items-center justify-center px-6 pb-8">
                  <Image
                    className="h-auto"
                    src="/loading2.gif"
                    alt="Loading..."
                    width={300}
                    height={200}
                    style={{ imageRendering: 'auto' }}
                  />
                  <h3 className="text-gray-900 font-semibold font-ibm-plex-mono text-lg px-8 mt-4 text-center">
                    Finding your people...
                  </h3>
                </div>
              ) : discoverStakes.length === 0 ? (
                <div className="flex flex-col items-center justify-center  px-6 pb-8">
                  <Image
                    className="h-auto"
                    src={!discoveryIntents ? '/generic.png' : '/loading2.gif'}
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
                  ) : !discoveryIntents ? (
                    <>
                      <button
                        onClick={() => discoveryFormRef.current?.focus()}
                        className="border border-gray-300 py-2 mb-2 text-gray-900 font-semibold font-ibm-plex-mono text-lg px-8 mt-4 hover:text-black transition-colors"
                      >
                        Find your people
                      </button>
                      <p className="text-gray-900 font-500 font-ibm-plex-mono text-sm px-8 mt-2 text-center">
                        Share what you're looking for or drop a file above to discover relevant connections.
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
            <div className="mt-4">
              {/* Back to discovery button */}
              <div className="mb-4">
                <button
                  onClick={() => handleTabChange('discover')}
                  className="bg-black text-white px-4 py-2 font-ibm-plex-mono text-sm hover:bg-gray-800 transition-colors"
                >
                  ← Back to discovery
                </button>
              </div>
              
              {requestsView === 'received' && (
                <>
                  {inboxConnections.length === 0 ? (
                    <div className="py-8 text-center text-gray-500 bg-white border border-b-2 border-gray-800">
                      No incoming connection requests. All caught up!
                    </div>
                  ) : (
                    inboxConnections.map((connection) => renderUserCard(connection, 'requests'))
                  )}
                </>
              )}

              {requestsView === 'sent' && (
                <>
                  {pendingConnections.length === 0 ? (
                    <div className="py-8 text-center text-gray-500 bg-white border border-b-2 border-gray-800">
                      No sent requests.
                    </div>
                  ) : (
                    pendingConnections.map((connection) => renderUserCard(connection, 'requests'))
                  )}
                </>
              )}

              {requestsView === 'history' && (
                <>
                  {historyConnections.length === 0 ? (
                    <div className="py-8 text-center text-gray-500 bg-white border border-b-2 border-gray-800">
                      No connection history yet.
                    </div>
                  ) : (
                    historyConnections.map((connection) => renderUserCard(connection, 'requests'))
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Discovery input - inline at bottom when intent is selected (for refinement) */}
        {activeTab === 'discover' && discoveryIntents && (
          <DiscoveryForm
            ref={discoveryFormRef}
            floating={true}
            intentId={discoveryIntents[0]?.id}
            onRefine={(updatedIntent) => {
              setDiscoveryIntents([{
                id: updatedIntent.id,
                payload: updatedIntent.payload,
                summary: updatedIntent.summary || undefined,
                createdAt: updatedIntent.createdAt
              }]);
            }}
          />
        )}
      </div>
    </ClientLayout>
    </InboxProvider>
  );
}

