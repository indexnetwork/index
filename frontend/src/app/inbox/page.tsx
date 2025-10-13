"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import * as Tabs from "@radix-ui/react-tabs";
import { useConnections, useSynthesis, useDiscover } from "@/contexts/APIContext";
import { StakesByUserResponse, UserConnection } from "@/lib/types";
import { getAvatarUrl } from "@/lib/file-utils";
import { formatDate } from "@/lib/utils";
import ClientLayout from "@/components/ClientLayout";
import ConnectionActions, { ConnectionAction } from "@/components/ConnectionActions";
import DiscoveryForm from "@/components/DiscoveryForm";
import { useIndexFilter } from "@/contexts/IndexFilterContext";

const validTabs = ['discover', 'requests'];

export default function InboxPage() {
  const [discoverStakes, setDiscoverStakes] = useState<StakesByUserResponse[]>([]);
  const [inboxConnections, setInboxConnections] = useState<UserConnection[]>([]);
  const [pendingConnections, setPendingConnections] = useState<UserConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [syntheses, setSyntheses] = useState<Record<string, string>>({});
  const [synthesisLoading, setSynthesisLoading] = useState<Record<string, boolean>>({});
  const [requestsView, setRequestsView] = useState<'received' | 'sent'>('received');
  const [discoveryIntents, setDiscoveryIntents] = useState<Array<{id: string; payload: string; summary?: string; createdAt: string}> | undefined>(undefined);
  const fetchedSynthesesRef = useRef<Set<string>>(new Set());
  const { selectedIndexIds } = useIndexFilter();
  
  // URL parameter handling
  const searchParams = useSearchParams();
  const router = useRouter();
  const urlTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(
    urlTab && validTabs.includes(urlTab) ? urlTab : 'discover'
  );

  const connectionsService = useConnections();
  const synthesisService = useSynthesis();
  const discoverService = useDiscover();

  const handleTabChange = (newTab: string) => {
    if (!validTabs.includes(newTab)) return;
    
    setActiveTab(newTab);
    const params = new URLSearchParams(searchParams.toString());
    
    if (newTab === 'discover') {
      // Remove tab parameter for discover (default)
      params.delete('tab');
      const queryString = params.toString();
      router.push(`/inbox${queryString ? `?${queryString}` : ''}`);
    } else {
      params.set('tab', newTab);
      router.push(`/inbox?${params.toString()}`);
    }
  };

  const fetchSynthesis = useCallback(async (targetUserId: string, intentIds?: string[], indexIds?: string[]) => {
    const cacheKey = `${targetUserId}-${(indexIds || []).sort().join(',')}`;
    if (fetchedSynthesesRef.current.has(cacheKey)) {
      return; // Already fetched or in progress
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
      // Set empty synthesis on error to avoid infinite loading
      setSyntheses(prev => ({ ...prev, [targetUserId]: "" }));
    } finally {
      setSynthesisLoading(prev => ({ ...prev, [targetUserId]: false }));
    }
  }, [synthesisService]);

  const fetchData = useCallback(async () => {
    try {
      // Determine indexIds to pass to API calls
      const apiIndexIds = selectedIndexIds.length > 0 ? selectedIndexIds : undefined;
      
      // Fetch connections and discover data
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

      // Transform discover data to match StakesByUserResponse format
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
            updatedAt: stake.intent.createdAt, // Using createdAt as updatedAt not available
          },
          totalStake: String(stake.totalStake),
          agents: [] // The new API doesn't return agent-specific stakes
        }))
      }));

      // Set data for each tab
      setDiscoverStakes(transformedStakesData);
      setInboxConnections(inboxData.connections);
      setPendingConnections(pendingData.connections);

      // Clear previous synthesis cache when filters change
      fetchedSynthesesRef.current.clear();
      setSyntheses({});

      // Automatically fetch synthesis for all users
      const allUserIds = new Set<string>();
      
      // Collect user IDs from discover stakes
      transformedStakesData.forEach(stake => allUserIds.add(stake.user.id));
      
      // Collect user IDs from connections
      [...inboxData.connections, ...pendingData.connections]
        .forEach(connection => allUserIds.add(connection.user.id));

      // Fetch synthesis for all unique users with current index filter
      allUserIds.forEach(userId => {
        fetchSynthesis(userId, undefined, apiIndexIds);
      });

    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, [connectionsService, discoverService, fetchSynthesis, selectedIndexIds, discoveryIntents]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);


  // Sync tab state with URL changes
  useEffect(() => {
    const urlTab = searchParams.get('tab');
    if (urlTab && validTabs.includes(urlTab)) {
      setActiveTab(urlTab);
    } else if (!urlTab) {
      // Default to discover when no tab is specified
      setActiveTab('discover');
    }
  }, [searchParams]);

  const handleConnectionAction = async (action: ConnectionAction, userId: string) => {
    try {
      
      // Call the appropriate connection service method
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

      // Refresh the data to reflect the changes
      await fetchData();
    } catch (error) {
      console.error('Error handling connection action:', error);
      // You might want to show a toast or error message to the user
    }
  };


  const getConnectionStatus = (tabType: 'discover' | 'requests', viewType?: 'received' | 'sent'): 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'declined' | 'skipped' => {
    if (tabType === 'discover') {
        return 'none'; // suggestions for new connections
    }
    
    if (tabType === 'requests') {
      if (viewType === 'sent') {
        return 'pending_sent'; // you acted, awaiting them
      } else {
        return 'pending_received'; // items awaiting your response
      }
    }
    
    return 'none';
  };

  const renderStakeCard = (userStake: StakesByUserResponse, tabType: 'discover' | 'requests') => {
    return (
      <div key={userStake.user.id} className="p-0 mt-0 bg-white border border-b-2 border-gray-800 mb-4">
        <div className="py-4 px-2 sm:px-4 hover:bg-gray-50 transition-colors">
        {/* User Header */}
        <div className="flex flex-wrap sm:flex-nowrap justify-between items-start mb-4">
          <div className="flex items-center gap-4 w-full sm:w-auto mb-2 sm:mb-0">
            <Image
              src={getAvatarUrl(userStake.user)}
              alt={userStake.user.name}
              width={48}
              height={48}
              className="rounded-full"
            />
            <div>
              <h2 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">{userStake.user.name}</h2>
              <div className="flex items-center gap-4 text-sm text-gray-500 font-ibm-plex-mono">
                {userStake.intents.length > 0 ? (
                  <span>{userStake.intents.length} mutual intent{userStake.intents.length !== 1 ? 's' : ''}</span>
                ) : (
                  <span>Potential connection</span>
                )}
              </div>
            </div>
          </div>
          {/* Connection Actions */}
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <ConnectionActions
              userId={userStake.user.id}
              userName={userStake.user.name}
              connectionStatus={getConnectionStatus(tabType, requestsView)}
              onAction={handleConnectionAction}
              size="sm"
            />
          </div>
        </div>

        {/* What Could Happen Here */}
        {(synthesisLoading[userStake.user.id] || syntheses[userStake.user.id]) && (
          <div className="mb-4">
            <h3 className="font-medium text-gray-700 mb-2 text-sm">What could happen here</h3>
            <div className="space-y-2">
              {synthesisLoading[userStake.user.id] ? (
                <div className="text-gray-500 text-sm animate-pulse">
                  ...
                </div>
              ) : (
                <div className="text-gray-700 text-sm leading-relaxed prose prose-sm max-w-none [&_a]:text-[#ec6767] [&_a]:font-bold [&_a]:underline [&_a]:hover:opacity-80 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mb-1 [&_p]:mb-2 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-sm">
                  <ReactMarkdown>
                    {syntheses[userStake.user.id]}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )}

        {userStake.intents.length > 0 && (
          <div className="mb-4">
            <h3 className="font-medium text-gray-700 mb-2 text-sm">Mutual intents ({userStake.intents.length})</h3>
            <div className="flex flex-wrap gap-2">
              {userStake.intents.map((intentConnection) => (
                <div key={intentConnection.intent.id} className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200">
                  <h4 className="text-sm font-ibm-plex-mono font-light text-gray-900">{intentConnection.intent.summary || 'Untitled Intent'}</h4>
                  <span className="text-gray-400 text-xs">
                    ({intentConnection.totalStake})
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        </div>
      </div>
    );
  };

  const renderConnectionCard = (connection: UserConnection, tabType: 'requests') => {
    return (
      <div key={connection.user.id} className="p-0 mt-0 bg-white border border-b-2 border-gray-800 mb-4">
        <div className="py-4 px-2 sm:px-4 hover:bg-gray-50 transition-colors">
          <div className="flex flex-wrap sm:flex-nowrap justify-between items-start mb-4">
            <div className="flex items-center gap-4 w-full sm:w-auto mb-2 sm:mb-0">
              <Image
                src={getAvatarUrl(connection.user)}
                alt={connection.user.name}
                width={48}
                height={48}
                className="rounded-full"
              />
              <div>
                <h2 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">{connection.user.name}</h2>
                <div className="flex items-center gap-4 text-sm text-gray-500 font-ibm-plex-mono">
                  <span>
                    {formatDate(connection.lastUpdated)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
              <ConnectionActions
                userId={connection.user.id}
                userName={connection.user.name}
                connectionStatus={getConnectionStatus(tabType, requestsView)}
                onAction={handleConnectionAction}
                size="sm"
              />
            </div>
          </div>

          {/* What Could Happen Here */}
          {(synthesisLoading[connection.user.id] || syntheses[connection.user.id]) && (
            <div className="mb-4">
              <h3 className="font-medium text-gray-700 mb-2 text-sm">What could happen here</h3>
              <div className="space-y-2">
                {synthesisLoading[connection.user.id] ? (
                  <div className="text-gray-500 text-sm animate-pulse">
                    ...
                  </div>
                ) : (
                  <div className="text-gray-700 text-sm leading-relaxed prose prose-sm max-w-none [&_a]:text-[#ec6767] [&_a]:font-bold [&_a]:underline [&_a]:hover:opacity-80 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mb-1 [&_p]:mb-2 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-sm">
                    <ReactMarkdown>
                      {syntheses[connection.user.id]}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

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
                      onSubmit={(intents) => {
                        console.log('intents', intents);
                        // Set the discovery intent filter and refetch data
                        setDiscoveryIntents(intents);
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

            {/* Discover Content - Connection suggestions */}
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
                  style={{
                    imageRendering: 'auto',
                  }}
                />
                <p className="text-gray-900 font-500 font-ibm-plex-mono text-md mt-4 text-center">
                No mutual intents for now, it's not you, the world's just being shy.
                </p>
              </div>
              ) : (
                discoverStakes.map((userStake) => renderStakeCard(userStake, 'discover'))
              )}
                </div>
            )}

            {/* Requests Content - Incoming/Outgoing requests */}
            {activeTab === 'requests' && (
              <div className="">
                <Tabs.Root value={requestsView} onValueChange={(value) => setRequestsView(value as 'received' | 'sent')}>
                  <Tabs.List className="overflow-x-auto inline-flex text-sm text-black">
                    <Tabs.Trigger value="received" className="font-ibm-plex-mono cursor-pointer border border-b-0 border-r-0 border-black px-3 py-2 bg-white data-[state=active]:bg-black data-[state=active]:text-white">
                      Incoming
                      {inboxConnections.length > 0 && (
                        <span className="ml-2 bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full data-[state=active]:bg-white data-[state=active]:text-black">
                          {inboxConnections.length}
                        </span>
                      )}
                    </Tabs.Trigger>
                    <Tabs.Trigger value="sent" className="font-ibm-plex-mono cursor-pointer border border-b-0 border-black px-3 py-2 bg-white  data-[state=active]:bg-black data-[state=active]:text-white">
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
                      inboxConnections.map((connection) => renderConnectionCard(connection, 'requests'))
                    )}
                  </Tabs.Content>

                  <Tabs.Content value="sent" className="p-0 mt-0 bg-white ">
                    {pendingConnections.length === 0 ? (
                      <div className="py-8 text-center text-gray-500">
                        No sent requests.
                      </div>
                    ) : (
                      pendingConnections.map((connection) => renderConnectionCard(connection, 'requests'))
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
