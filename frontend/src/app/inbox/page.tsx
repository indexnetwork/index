"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import { Upload, ArrowLeft, MessageCircle } from "lucide-react";
import { useConnections, useSynthesis, useDiscover, useAPI } from "@/contexts/APIContext";
import { useIndexFilter } from "@/contexts/IndexFilterContext";
import { useDiscoveryFilter } from "@/contexts/DiscoveryFilterContext";
import { StakesByUserResponse, UserConnection } from "@/lib/types";
import { getAvatarUrl } from "@/lib/file-utils";
import { formatDate } from "@/lib/utils";
import ClientLayout from "@/components/ClientLayout";
import ConnectionActions, { ConnectionAction } from "@/components/ConnectionActions";
import DiscoveryForm, { DiscoveryFormRef } from "@/components/DiscoveryForm";
import SynthesisMarkdown from "@/components/SynthesisMarkdown";
import UserProfileModal from "@/components/modals/UserProfileModal";
import FloatingChatInput, { IntentChange } from "@/components/FloatingChatInput";

const validTabs = ['discover', 'requests', 'history'];

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
  const [historyConnections, setHistoryConnections] = useState<UserConnection[]>([]);
  const [syntheses, setSyntheses] = useState<Record<string, string>>({});
  const [synthesisLoading, setSynthesisLoading] = useState<Record<string, boolean>>({});

  // UI State
  const [discoveryLoading, setDiscoveryLoading] = useState(true);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [requestsView, setRequestsView] = useState<'received' | 'sent' | 'history'>('received');
  const [isDragging, setIsDragging] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string; avatar: string | null } | null>(null);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [optimisticStatus, setOptimisticStatus] = useState<Record<string, ConnectionAction | null>>({});
  const [intentHistory, setIntentHistory] = useState<IntentChange[]>([]);
  const [currentIntentText, setCurrentIntentText] = useState<string>('');
  const [historyIndex, setHistoryIndex] = useState<number>(-1); // -1 means current/latest

  // Conversations list - derived from connections
  const conversations = useMemo(() => {
    // Combine all connections for conversations list
    const allConnections = [...inboxConnections, ...pendingConnections, ...historyConnections];
    // Sort by lastUpdated, most recent first
    return allConnections
      .sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime())
      .slice(0, 10) // Limit to 10 most recent
      .map(conn => ({
        id: conn.user.id,
        name: conn.user.name,
        avatar: conn.user.avatar,
        status: conn.status,
        lastUpdated: conn.lastUpdated,
        preview: conn.status === 'ACCEPT' ? 'Connection established' : 
                 conn.status === 'REQUEST' ? 'Connection request sent' :
                 conn.status === 'DECLINE' ? 'Connection declined' :
                 'Pending connection'
      }));
  }, [inboxConnections, pendingConnections, historyConnections]);

  // Network connections for "Your network can help" section - derived from history connections
  const networkConnectionsForDisplay = useMemo(() => {
    // Filter out people already shown in discoverStakes and limit to 2
    const discoverUserIds = discoverStakes.map(stake => stake.user.id);
    return historyConnections
      .filter(conn => !discoverUserIds.includes(conn.user.id))
      .slice(0, 2)
      .map(conn => ({
        user: conn.user,
        intents: [] // History connections don't have intents
      }));
  }, [discoverStakes, historyConnections]);

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
  const apiContext = useAPI();
  const intentsService = apiContext.intentsService;

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

      // Limit to max 5 people
      setDiscoverStakes(transformedStakesData.slice(0, 5));

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

  // Handler for opening user profile modal
  const handleUserClick = useCallback((user: { id: string; name: string; avatar: string | null }, connectionStatus?: string) => {
    // If clicking from conversations sidebar, switch to requests tab
    if (connectionStatus) {
      handleTabChange('requests');
      // Set the appropriate view based on connection status
      if (connectionStatus === 'ACCEPT' || connectionStatus === 'DECLINE') {
        setRequestsView('history');
      } else if (inboxConnections.some(c => c.user.id === user.id)) {
        setRequestsView('received');
      } else if (pendingConnections.some(c => c.user.id === user.id)) {
        setRequestsView('sent');
      }
    }
    setSelectedUser(user);
    setProfileModalOpen(true);
  }, [inboxConnections, pendingConnections]);

  // Format time for changelog
  const formatTime = useCallback((date: Date): string => {
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  }, []);

  // Get change text for changelog
  const getChangeText = useCallback((change: IntentChange): string => {
    switch (change.type) {
      case 'location':
        return change.value;
      case 'timeframe':
        return change.value;
      case 'stage':
        return change.value;
      case 'role':
        return change.value;
      case 'refinement':
        return change.value.substring(0, 40) + (change.value.length > 40 ? '...' : '');
      default:
        return 'Intent updated';
    }
  }, []);

  // Get displayed intent text based on history index
  const getDisplayedIntent = useCallback((): string => {
    if (historyIndex === -1) {
      return currentIntentText || discoveryIntents?.[0]?.summary || discoveryIntents?.[0]?.payload || '';
    }
    if (historyIndex === 0) {
      return intentHistory[0]?.original || '';
    }
    return intentHistory[historyIndex - 1]?.newIntent || '';
  }, [historyIndex, currentIntentText, discoveryIntents, intentHistory]);

  // Navigate to previous version (older)
  const navigateHistoryPrevious = useCallback(() => {
    if (historyIndex === -1) {
      // Move from current to last change
      if (intentHistory.length > 0) {
        setHistoryIndex(intentHistory.length - 1);
      }
    } else if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
    }
  }, [historyIndex, intentHistory.length]);

  // Navigate to next version (newer)
  const navigateHistoryNext = useCallback(() => {
    if (historyIndex < intentHistory.length - 1) {
      setHistoryIndex(historyIndex + 1);
    } else if (historyIndex === intentHistory.length - 1) {
      // Move to current
      setHistoryIndex(-1);
    }
  }, [historyIndex, intentHistory.length]);

  // Restore intent to selected version
  const restoreIntentFromHistory = useCallback(async () => {
    if (historyIndex === -1 || !discoveryIntents?.[0]?.id) return;
    
    const restoredIntent = historyIndex === 0 
      ? intentHistory[0].original 
      : intentHistory[historyIndex - 1].newIntent;
    
    try {
      // Update intent via API
      await intentsService.updateIntent(discoveryIntents[0].id, restoredIntent);
      
      // Update local state
      setCurrentIntentText(restoredIntent);
      // Remove changes after this index
      setIntentHistory(prev => prev.slice(0, historyIndex));
      setHistoryIndex(-1);
      
      // Refresh discovery results
      await fetchData({ showLoading: false, clearSyntheses: false });
    } catch (err) {
      console.error('Failed to restore intent:', err);
    }
  }, [historyIndex, intentHistory, discoveryIntents, intentsService, fetchData]);

  // Undo intent change (kept for backward compatibility)
  const undoIntentChange = useCallback(async (index: number) => {
    if (index < 0 || index >= intentHistory.length || !discoveryIntents?.[0]?.id) return;
    
    const change = intentHistory[index];
    
    // Restore previous intent
    let restoredIntent: string;
    if (index === 0) {
      restoredIntent = change.original;
    } else {
      restoredIntent = intentHistory[index - 1].newIntent;
    }
    
    try {
      // Update intent via API
      await intentsService.updateIntent(discoveryIntents[0].id, restoredIntent);
      
      // Update local state
      setCurrentIntentText(restoredIntent);
      setIntentHistory(prev => prev.filter((_, i) => i !== index));
      setHistoryIndex(-1);
      
      // Refresh discovery results
      await fetchData({ showLoading: false, clearSyntheses: false });
    } catch (err) {
      console.error('Failed to undo change:', err);
    }
  }, [intentHistory, discoveryIntents, intentsService, fetchData]);

  // Helper: Get connection status for rendering
  const getConnectionStatus = (tabType: 'discover' | 'requests', viewType: 'received' | 'sent' | 'history' | undefined, userId: string): 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'declined' | 'skipped' => {
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
    const isDocumentStyle = tabType === 'discover' && discoveryIntents && discoveryIntents.length > 0;

    if (isDocumentStyle) {
      // Document style person entry
      return (
        <article key={user.id} className="person-entry">
          <div className="flex items-start gap-2 mb-1">
            <Image
              src={getAvatarUrl(user)}
              alt={user.name}
              width={48}
              height={48}
              className="w-12 h-12 rounded-full shrink-0 object-cover border-2 border-gray-200"
            />
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-bold text-gray-900 font-ibm-plex-mono mb-0.5">
                {user.name}
              </h3>
              <p className="text-sm text-gray-600 mb-2">
                {intents && intents.length > 0 ? (
                  <>
                    {(() => {
                      const summary = intents[0].intent.summary;
                      const payload = intents[0].intent.payload;
                      
                      // Check if summary or payload is a URL
                      const isUrl = (str: string) => str.startsWith('http://') || str.startsWith('https://');
                      
                      // Use summary if available and not a URL, otherwise use payload if not a URL
                      const displayText = summary && !isUrl(summary) 
                        ? summary 
                        : payload && !isUrl(payload) 
                        ? payload 
                        : null;
                      
                      if (displayText) {
                        const parts = displayText.split(' at ');
                        if (parts.length > 1) {
                          return (
                            <>
                              {parts[0]} at{' '}
                              <span className="document-link">{parts[1]}</span>
                            </>
                          );
                        } else {
                          return <span>{displayText}</span>;
                        }
                      } else {
                        return <span>Founder/Executive</span>;
                      }
                    })()}
                  </>
                ) : (
                  <span>Potential connection</span>
                )}
              </p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button
                onClick={(e) => {
                  e.preventDefault();
                  handleConnectionAction('REQUEST', user.id);
                }}
                className="px-2 py-1 text-xs font-medium rounded-sm bg-black text-white hover:bg-gray-800 transition-colors flex items-center gap-1"
              >
                <MessageCircle className="w-3 h-3" />
                Start Conversation
              </button>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  handleConnectionAction('SKIP', user.id);
                }}
                className="px-2 py-1 text-xs font-medium rounded-sm bg-white text-black hover:bg-gray-50 transition-colors border border-gray-300"
              >
                Pass
              </button>
            </div>
          </div>
          
          {(synthesisLoading[user.id] || syntheses[user.id]) && (
            <div className="text-sm text-gray-800 leading-relaxed mb-1">
              {synthesisLoading[user.id] ? (
                <span className="text-gray-400">Loading...</span>
              ) : (
                <SynthesisMarkdown
                  content={syntheses[user.id] || ''}
                  className="text-sm text-gray-800 leading-relaxed prose prose-sm max-w-none [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mb-1 [&_p]:mb-2 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-sm line-clamp-3"
                  onArchive={fetchData}
                  popoverControlRef={popoverControlRef}
                />
              )}
            </div>
          )}
          
          {intents && intents.length > 1 && (
            <div className="mb-1.5">
              <span className="text-xs text-gray-500">Also matches: </span>
              {intents.slice(1, 3).map((intent, idx) => {
                const isUrl = (str: string) => str.startsWith('http://') || str.startsWith('https://');
                const displayText = intent.intent.summary && !isUrl(intent.intent.summary)
                  ? intent.intent.summary
                  : intent.intent.payload && !isUrl(intent.intent.payload)
                  ? intent.intent.payload
                  : 'Intent';
                return (
                  <a key={idx} href="#" className="overlap-tag">
                    {displayText}
                  </a>
                );
              })}
            </div>
          )}
        </article>
      );
    }

    // Original card style for requests tab
    return (
      <div key={user.id} className="p-0 mt-0 bg-white border border-b-2 border-gray-800 mb-4">
        <div className="py-4 px-2 sm:px-4 ">
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
                  width={48}
                  height={48}
                  className="rounded-full"
                />
              </button>
              <div>
                <button
                  onClick={() => handleUserClick(user)}
                  className="cursor-pointer transition-opacity hover:opacity-80"
                >
                  <h2 className="font-bold text-lg text-gray-900 font-ibm-plex-mono text-left">{user.name}</h2>
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
                connectionStatus={getConnectionStatus(tabType, requestsView, user.id)}
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
        </div>
      </div>
    );
  }, [synthesisLoading, syntheses, requestsView, handleConnectionAction, handleUserClick, fetchData, getConnectionStatus, discoveryIntents]);


  return (
    <ClientLayout>
      {/* Drag and Drop Overlay */}
      {isDragging && (
        <div
          className="fixed inset-0 z-[99999] flex items-center justify-center transition-opacity bg-white"
          style={{
            minHeight: '100vh',
          }}
        >
          <div className="relative z-10 bg-white border-1 rounded-sm border-black px-6 py-4 flex flex-col items-center gap-3 w-[340px]">
            <Upload className="w-8 h-8 text-black" />
            <p className="text-base font-ibm-plex-mono text-gray-700 text-center leading-snug">
              Drop file(s) here to discover relevant connections
            </p>
          </div>
        </div>
      )}

      {/* Sidebar Line - only show on discover tab when intent is active */}
      {activeTab === 'discover' && discoveryIntents && discoveryIntents.length > 0 && (
        <div className="sidebar-line fixed left-0 top-0 bottom-0 w-1 z-[9998] hidden md:block" />
      )}

      {activeTab === 'discover' && discoveryIntents && discoveryIntents.length > 0 ? (
        /* Document Style Layout for Discover Tab */
          <div className="flex gap-6 w-full">
            {/* Main Content Area - matches inbox view width */}
            <div className="flex-1 border border-gray-800 rounded-md px-2 sm:px-4 py-4 sm:py-8 relative bg-white z-[9999] max-h-[calc(100vh-120px)] overflow-y-auto pb-32">
          {/* Back to inbox button */}
          <button
            onClick={() => {
              setDiscoveryIntents(undefined);
              setIntentHistory([]);
              setCurrentIntentText('');
            }}
            className="mb-6 flex items-center gap-1.5 px-2.5 py-1.5 bg-black text-white rounded-md hover:bg-gray-800 transition-colors font-ibm-plex-mono text-xs"
          >
            <ArrowLeft className="w-3 h-3" />
            Back to inbox
          </button>
          
          {/* Minimal Header */}
          <header className="mb-4 pb-3 border-b border-gray-400">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 font-ibm-plex-mono mb-2 leading-tight">
                  {getDisplayedIntent() || discoveryIntents[0]?.summary || discoveryIntents[0]?.payload || 'Discovery filter'}
                </h1>
              </div>
              <button
                onClick={() => {
                  setDiscoveryIntents(undefined);
                  setIntentHistory([]);
                  setCurrentIntentText('');
                  setHistoryIndex(-1);
                }}
                className="hover:opacity-70 transition-opacity shrink-0"
                aria-label="Clear filter"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </header>

          {/* Main Document Content */}
          <main className="space-y-3">
            {discoveryLoading ? (
              <div className="flex flex-col items-center justify-center py-8">
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
              <div className="flex flex-col items-center justify-center py-8">
                <Image
                  className="h-auto"
                  src="/loading2.gif"
                  alt="Loading..."
                  width={300}
                  height={200}
                  style={{ imageRendering: 'auto' }}
                />
                <h3 className="text-gray-900 font-semibold font-ibm-plex-mono text-lg px-8 mt-4 text-center">
                  No relevant connections for now.
                </h3>
                <p className="text-gray-900 font-500 font-ibm-plex-mono text-sm px-8 mt-2 text-center">
                  It's not you, the world's just being shy. Don't worry, I'll keep looking.
                </p>
              </div>
            ) : (
              <>
                {discoverStakes.map((userStake) => renderUserCard(userStake, 'discover'))}
                
                {/* Your network can help with this section */}
                {networkConnectionsForDisplay.length > 0 && (
                  <div className="mt-4 pt-4">
                    <h3 className="text-lg font-bold text-black font-ibm-plex-mono mb-4">
                      Your network can help with this
                    </h3>
                    <div className="flex flex-col gap-4">
                      {networkConnectionsForDisplay.map((networkStake) => {
                        const user = networkStake.user;
                        // Find the original connection to get intro/title
                        const originalConnection = historyConnections.find(c => c.user.id === user.id);
                        const displayTitle = originalConnection?.user.intro || 'Connected';
                        return (
                          <div
                            key={user.id}
                            className="flex items-center gap-3 p-3 border border-[#007EFF] rounded-sm bg-white"
                          >
                            <Image
                              src={getAvatarUrl(user)}
                              alt={user.name}
                              width={48}
                              height={48}
                              className="w-12 h-12 rounded-full shrink-0 object-cover"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-black font-ibm-plex-mono truncate">
                                {user.name}
                              </p>
                              <p className="text-xs text-gray-600 font-ibm-plex-mono truncate">
                                {displayTitle.length > 40 ? displayTitle.substring(0, 40) + '...' : displayTitle}
                              </p>
                            </div>
                            <button
                              onClick={(e) => {
                                e.preventDefault();
                                handleConnectionAction('REQUEST', user.id);
                              }}
                              className="px-3 py-1.5 text-xs font-medium rounded-sm bg-black text-white hover:bg-gray-800 transition-colors font-ibm-plex-mono whitespace-nowrap"
                            >
                              Let them know
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </main>
          </div>
          {/* Conversations Sidebar - Right Side */}
          <div className="w-80 bg-white border border-gray-200 rounded-md p-4 shrink-0 max-h-[calc(100vh-120px)] overflow-y-auto">
            {/* Conversations Header */}
            <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-200">
              <MessageCircle className="w-5 h-5 text-gray-700" />
              <h2 className="text-sm font-semibold text-gray-900 font-ibm-plex-mono">Conversations</h2>
            </div>
            
            {/* Conversations List */}
            <div className="space-y-3">
              {conversations.length === 0 ? (
                <p className="text-sm text-gray-500 font-ibm-plex-mono text-center py-8">
                  No conversations yet
                </p>
              ) : (
                conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    onClick={() => handleUserClick({
                      id: conversation.id,
                      name: conversation.name,
                      avatar: conversation.avatar
                    }, conversation.status)}
                    className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-gray-50 transition-colors text-left"
                  >
                    <Image
                      src={getAvatarUrl({ id: conversation.id, name: conversation.name, avatar: conversation.avatar })}
                      alt={conversation.name}
                      width={40}
                      height={40}
                      className="rounded-full shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 font-ibm-plex-mono truncate">
                        {conversation.name}
                      </p>
                      <p className="text-xs text-gray-600 truncate">
                        {conversation.preview}
                      </p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
          </div>
      ) : (
        /* Original Layout for other tabs or when no intent */
        <div className="flex gap-6 w-full">
          {/* Main Content Area */}
          <div className="flex-1 border border-gray-800 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
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
                          setCurrentIntentText(intents[0]?.summary || intents[0]?.payload || '');
                          setIntentHistory([]);
                          setShowSuccessMessage(true);
                          setTimeout(() => setShowSuccessMessage(false), 20000);
                        }}
                      />
                    </div>
                  ) : null}
                </div>
              )}

              {/* Requests view button */}
              {activeTab === 'requests' && (
              <div className="flex justify-between items-end">
                {/* Tab buttons */}
                <div className="flex gap-0">
                  <button
                    onClick={() => setRequestsView('received')}
                    className={`font-ibm-plex-mono px-6 py-2 border border-black  border-b-2 border-r-0 flex items-center gap-2 ${requestsView === 'received'
                      ? 'bg-black text-white'
                      : 'bg-white text-black hover:bg-gray-50'
                      }`}
                  >
                    Inbox
                    {inboxConnections.length > 0 && (
                      <span className={`text-xs px-2 py-1 rounded ${requestsView === 'received'
                        ? 'bg-white text-black'
                        : 'bg-black text-white'
                        }`}>
                        {inboxConnections.length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setRequestsView('sent')}
                    className={`font-ibm-plex-mono px-6 py-2 border border-black border-b-2 border-r-0 border-l-0 flex items-center gap-2 ${requestsView === 'sent'
                      ? 'bg-black text-white'
                      : 'bg-white text-black hover:bg-gray-50'
                      }`}
                  >
                    Sent
                    {pendingConnections.length > 0 && (
                      <span className={`text-xs px-2 py-1 rounded ${requestsView === 'sent'
                        ? 'bg-white text-black'
                        : 'bg-black text-white'
                        }`}>
                        {pendingConnections.length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setRequestsView('history')}
                    className={`font-ibm-plex-mono px-6 py-2 border border-b-2 border-black border-l-0 flex items-center gap-2 ${requestsView === 'history'
                      ? 'bg-black text-white'
                      : 'bg-white text-black hover:bg-gray-50'
                      }`}
                  >
                    History
                    {historyConnections.length > 0 && (
                      <span className={`text-xs px-2 py-1 rounded ${requestsView === 'history'
                        ? 'bg-white text-black'
                        : 'bg-black text-white'
                        }`}>
                        {historyConnections.length}
                      </span>
                    )}
                  </button>
                </div>

                {/* Back to Discovery button */}
                <button
                  onClick={() => handleTabChange('discover')}
                  className="font-ibm-plex-mono px-4 py-3 border border-b-2 border-black bg-black text-white hover:bg-gray-800 flex items-center gap-2"
                >
                  Back to Discovery
                  <span className="bg-white text-black text-xs px-2 py-1 rounded">
                    {discoverStakes.length}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* Discover Content */}
          {activeTab === 'discover' && (
            <div className="mt-4">
              {discoveryLoading ? (
                <div className="flex flex-col items-center justify-center bg-white border border-black border-b-0 border-b-2 px-6 pb-8">
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
                <div className="flex flex-col items-center justify-center bg-white border border-black border-b-0 border-b-2 px-6 pb-8">
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
          </div>

          {/* Conversations Sidebar - Right Side */}
          {activeTab === 'discover' && (
            <div className="w-80 bg-white border border-gray-200 rounded-md p-4 shrink-0">
              {/* Conversations Header */}
              <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-200">
                <MessageCircle className="w-5 h-5 text-gray-700" />
                <h2 className="text-sm font-semibold text-gray-900 font-ibm-plex-mono">Conversations</h2>
              </div>
              
              {/* Conversations List */}
              <div className="space-y-3">
                {conversations.length === 0 ? (
                  <p className="text-sm text-gray-500 font-ibm-plex-mono text-center py-8">
                    No conversations yet
                  </p>
                ) : (
                  conversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      onClick={() => handleUserClick({
                        id: conversation.id,
                        name: conversation.name,
                        avatar: conversation.avatar
                      }, conversation.status)}
                      className="w-full flex items-center gap-3 p-2 rounded-md hover:bg-gray-50 transition-colors text-left"
                    >
                      <Image
                        src={getAvatarUrl({ id: conversation.id, name: conversation.name, avatar: conversation.avatar })}
                        alt={conversation.name}
                        width={40}
                        height={40}
                        className="rounded-full shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 font-ibm-plex-mono truncate">
                          {conversation.name}
                        </p>
                        <p className="text-xs text-gray-600 truncate">
                          {conversation.preview}
                        </p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* User Profile Modal */}
      <UserProfileModal
        open={profileModalOpen}
        onOpenChange={setProfileModalOpen}
        user={selectedUser}
      />

      {/* Floating Chat Input - appears after discovery form submission */}
      {activeTab === 'discover' && discoveryIntents && discoveryIntents.length > 0 && (
        <FloatingChatInput
          intentId={discoveryIntents[0]?.id}
          currentIntent={currentIntentText || discoveryIntents[0]?.summary || discoveryIntents[0]?.payload || ''}
          onIntentUpdate={async (updatedIntent: string, change?: IntentChange) => {
            // Update local state - only update intent text, don't refresh results
            setCurrentIntentText(updatedIntent);
            if (change) {
              setIntentHistory(prev => [...prev, change]);
            }
            // Reset to latest version when new change is made
            setHistoryIndex(-1);
          }}
          onFeedback={async (feedback: string) => {
            // General feedback - just log for now
            console.log('Feedback received:', feedback);
          }}
        />
      )}
    </ClientLayout>
  );
}
