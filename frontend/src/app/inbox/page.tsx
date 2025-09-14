"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import * as Tabs from "@radix-ui/react-tabs";
import { History, SendHorizontal, Inbox } from "lucide-react";
import { useConnections, useSynthesis, useDiscover } from "@/contexts/APIContext";
import { StakesByUserResponse, UserConnection } from "@/lib/types";
import { getAvatarUrl } from "@/lib/file-utils";
import { formatDate } from "@/lib/utils";
import ClientLayout from "@/components/ClientLayout";
import ConnectionActions, { ConnectionAction } from "@/components/ConnectionActions";
import { useIndexFilter } from "@/contexts/IndexFilterContext";

const validTabs = ['discover', 'inbox', 'pending', 'history'];

export default function InboxPage() {
  const [discoverStakes, setDiscoverStakes] = useState<StakesByUserResponse[]>([]);
  const [inboxConnections, setInboxConnections] = useState<UserConnection[]>([]);
  const [pendingConnections, setPendingConnections] = useState<UserConnection[]>([]);
  const [historyConnections, setHistoryConnections] = useState<UserConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [syntheses, setSyntheses] = useState<Record<string, string>>({});
  const [synthesisLoading, setSynthesisLoading] = useState<Record<string, boolean>>({});
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
      const [inboxData, pendingData, historyData, discoverData] = await Promise.all([
        connectionsService.getConnectionsByUser('inbox', apiIndexIds),
        connectionsService.getConnectionsByUser('pending', apiIndexIds),
        connectionsService.getConnectionsByUser('history', apiIndexIds),
        discoverService.discoverUsers({ indexIds: apiIndexIds, excludeDiscovered: true, limit: 50 })
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
      setHistoryConnections(historyData.connections);

      // Clear previous synthesis cache when filters change
      fetchedSynthesesRef.current.clear();
      setSyntheses({});

      // Automatically fetch synthesis for all users
      const allUserIds = new Set<string>();
      
      // Collect user IDs from discover stakes
      transformedStakesData.forEach(stake => allUserIds.add(stake.user.id));
      
      // Collect user IDs from connections
      [...inboxData.connections, ...pendingData.connections, ...historyData.connections]
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
  }, [connectionsService, discoverService, fetchSynthesis, selectedIndexIds]);

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

  const getConnectionStatus = (tabType: 'discover' | 'inbox' | 'pending' | 'history'): 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'declined' | 'skipped' => {
    switch (tabType) {
      case 'discover':
        return 'none'; // suggestions for new connections
      case 'inbox':
        return 'pending_received'; // items awaiting your response
      case 'pending':
        return 'pending_sent'; // you acted, awaiting them
      case 'history':
        return 'connected'; // resolved states
      default:
        return 'none';
    }
  };

  const renderStakeCard = (userStake: StakesByUserResponse, tabType: 'discover' | 'inbox' | 'pending' | 'history') => {
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
              connectionStatus={getConnectionStatus(tabType)}
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
                <Link key={intentConnection.intent.id} href={`/intents/${intentConnection.intent.id}`} className="hover:bg-blue-50 transition-colors">
                  <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors  bg-gray-50 border border-gray-200">
                    <h4 className="text-sm font-ibm-plex-mono font-light text-gray-900">{intentConnection.intent.summary || 'Untitled Intent'}</h4>
                    <span className="text-gray-400 text-xs">
                      ({intentConnection.totalStake})
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        </div>
      </div>
    );
  };

  const renderConnectionCard = (connection: UserConnection, tabType: 'inbox' | 'pending' | 'history') => {
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
                connectionStatus={getConnectionStatus(tabType)}
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
          <Tabs.Root value={activeTab} onValueChange={handleTabChange} className="flex-grow">
            <div className="flex flex-row items-end justify-between">
              <Tabs.List className="overflow-x-auto flex justify-between w-full text-sm text-black">
                <div className="flex bg-white ">
                  <Tabs.Trigger value="discover" className="font-ibm-plex-mono cursor-pointer border border-b-0 border-r-0 border-black px-3 py-2 data-[state=active]:bg-black data-[state=active]:text-white">
                    Discover ({discoverStakes.length})
                  </Tabs.Trigger>
                  <Tabs.Trigger value="inbox" className="font-ibm-plex-mono cursor-pointer border border-b-0 border-r-0 border-black px-3 py-2 data-[state=active]:bg-black data-[state=active]:text-white">
                    <div className="flex items-center gap-2">
                      <Inbox size={16} />
                      Inbox ({inboxConnections.length})
                    </div>
                  </Tabs.Trigger>
                  <Tabs.Trigger value="pending" className="font-ibm-plex-mono cursor-pointer border border-b-0 border-black px-3 py-2 data-[state=active]:bg-black data-[state=active]:text-white">
                    <div className="flex items-center gap-2">
                      <SendHorizontal size={16} />
                      Pending ({pendingConnections.length})
                    </div>
                  </Tabs.Trigger>
                </div>
                <Tabs.Trigger value="history" className="bg-white font-ibm-plex-mono cursor-pointer border border-b-0 border-black px-3 py-2 data-[state=active]:bg-black data-[state=active]:text-white">
                  <div className="flex items-center gap-2">
                    <History size={16} />
                    History ({historyConnections.length})
                  </div>
                </Tabs.Trigger>
              </Tabs.List>
            </div>

            {/* Section Descriptions */}
            <div>
              <Tabs.Content value="discover" className="m-0 p-0">
                <div className="bg-white border border-b-2 border-gray-800 p-3">
                  <p className="text-sm text-gray-700 font-ibm-plex-mono">
                    Discover new people based on contextual relevance. You're deciding whether to initiate a connection.
                  </p>
                </div>
              </Tabs.Content>
              
              <Tabs.Content value="inbox" className="m-0 p-0">
                <div className="bg-white border border-b-2 border-gray-800 p-3">
                  <p className="text-sm text-gray-700 font-ibm-plex-mono">
                    Incoming connection requests from real users. Use this tab to respond to others who want to connect with you.
                  </p>
                </div>
              </Tabs.Content>
              
              <Tabs.Content value="pending" className="m-0 p-0">
                <div className="bg-white border border-b-2 border-gray-800 p-3">
                  <p className="text-sm text-gray-700 font-ibm-plex-mono">
                    Requests you've sent to others and are still awaiting a response. Cancel if no longer relevant.
                  </p>
                </div>
              </Tabs.Content>
              
              <Tabs.Content value="history" className="m-0 p-0">
                <div className="bg-white border border-b-2 border-gray-800 p-3">
                  <p className="text-sm text-gray-700 font-ibm-plex-mono">
                    Resolved connections — accepted, declined, skipped, or canceled. A passive log of what's already been handled.
                  </p>
                </div>
              </Tabs.Content>
            </div>

            {/* Discover Tab Content - Connection suggestions */}
            <Tabs.Content value="discover" className="mt-4">
              {discoverStakes.length === 0 ? (
                <div className="p-0 mt-0 bg-white border border-b-2 border-gray-800 py-8 text-center text-gray-500">
                  <p>No connection suggestions available right now.</p>
                  <p className="text-sm mt-2">Discovery works by finding users who have staked on your intents. Create some intents first to see suggestions!</p>
                </div>
              ) : (
                discoverStakes.map((userStake) => renderStakeCard(userStake, 'discover'))
              )}
            </Tabs.Content>

            {/* Inbox Tab Content - Incoming requests */}
            <Tabs.Content value="inbox" className="mt-4">
              {inboxConnections.length === 0 ? (
                <div className="p-0 mt-0 bg-white border border-b-2 border-gray-800 py-8 text-center text-gray-500">
                  No incoming connection requests. All caught up!
                </div>
              ) : (
                inboxConnections.map((connection) => renderConnectionCard(connection, 'inbox'))
              )}
            </Tabs.Content>

            {/* Pending Tab Content - Outgoing requests */}
            <Tabs.Content value="pending" className="mt-4">
              {pendingConnections.length === 0 ? (
                <div className="p-0 mt-0 bg-white border border-b-2 border-gray-800 py-8 text-center text-gray-500">
                  No pending requests. You haven't sent any connection requests recently.
                </div>
              ) : (
                pendingConnections.map((connection) => renderConnectionCard(connection, 'pending'))
              )}
            </Tabs.Content>

            {/* History Tab Content - Resolved connections */}
            <Tabs.Content value="history" className="mt-4">
              {historyConnections.length === 0 ? (
                <div className="p-0 mt-0 bg-white border border-b-2 border-gray-800 py-8 text-center text-gray-500">
                  No completed connections yet.
                </div>
              ) : (
                historyConnections.map((connection) => renderConnectionCard(connection, 'history'))
              )}
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </div>
    </ClientLayout>
  );
} 
