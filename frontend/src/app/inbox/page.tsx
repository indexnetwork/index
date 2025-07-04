"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MessageCircle, Check, X, Clock, Search, ChevronUp, ChevronDown } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import * as Tabs from "@radix-ui/react-tabs";
import { useIntents, useConnections } from "@/contexts/APIContext";
import { StakesByUserResponse, UserConnection } from "@/lib/types";
import { getAvatarUrl } from "@/lib/file-utils";
import ClientLayout from "@/components/ClientLayout";
import ConnectionActions, { ConnectionAction } from "@/components/ConnectionActions";

export default function InboxPage() {
  const [discoverStakes, setDiscoverStakes] = useState<StakesByUserResponse[]>([]);
  const [inboxConnections, setInboxConnections] = useState<UserConnection[]>([]);
  const [pendingConnections, setPendingConnections] = useState<UserConnection[]>([]);
  const [doneConnections, setDoneConnections] = useState<UserConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const intentsService = useIntents();
  const connectionsService = useConnections();

  const fetchData = useCallback(async () => {
    try {
      // Fetch connections and stakes
      const [inboxData, pendingData, doneData, stakesData] = await Promise.all([
        connectionsService.getConnectionsByUser('inbox'),
        connectionsService.getConnectionsByUser('pending'),
        connectionsService.getConnectionsByUser('done'),
        intentsService.getAllStakes()
      ]);

      // Set data for each tab
      setDiscoverStakes(stakesData);
      setInboxConnections(inboxData.connections);
      setPendingConnections(pendingData.connections);
      setDoneConnections(doneData.connections);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  }, [intentsService, connectionsService]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleConnectionAction = async (action: ConnectionAction, userId: string) => {
    try {
      console.log(`Connection action: ${action} for user: ${userId}`);
      
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

  const getConnectionStatus = (tabType: 'discover' | 'inbox' | 'pending' | 'done'): 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'declined' | 'skipped' => {
    switch (tabType) {
      case 'discover':
        return 'none'; // suggestions for new connections
      case 'inbox':
        return 'pending_received'; // items awaiting your response
      case 'pending':
        return 'pending_sent'; // you acted, awaiting them
      case 'done':
        return 'connected'; // resolved states
      default:
        return 'none';
    }
  };

  const renderStakeCard = (userStake: StakesByUserResponse, tabType: 'discover' | 'inbox' | 'pending' | 'done') => {
    // Get all unique agents across all intents for this user
    const allAgents = userStake.intents.flatMap(intent => intent.agents);
    const uniqueAgents = allAgents.reduce((acc, current) => {
      const existing = acc.find(agent => agent.agent.name === current.agent.name);
      if (!existing) {
        acc.push(current);
      } else {
        // Sum stakes if agent appears multiple times
        existing.stake = (parseFloat(existing.stake) + parseFloat(current.stake)).toString();
      }
      return acc;
    }, [] as typeof allAgents);

    return (
      <div key={userStake.user.id} className="p-0 mt-0 bg-white border border-b-2 border-gray-800 mb-4">
        <div className="py-4 px-2 sm:px-4 hover:bg-gray-50 transition-colors">
        {/* User Header */}
        <div className="flex flex-wrap sm:flex-nowrap justify-between items-start mb-4">
          <div className="flex items-center gap-4 w-full sm:w-auto mb-2 sm:mb-0">
            <Image
              src={getAvatarUrl(userStake.user.avatar)}
              alt={userStake.user.name}
              width={48}
              height={48}
              className="rounded-full"
            />
            <div>
              <h2 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">{userStake.user.name}</h2>
              <div className="flex items-center gap-4 text-sm text-gray-500 font-ibm-plex-mono">
                <span>{userStake.intents.length} mutual intent{userStake.intents.length !== 1 ? 's' : ''}</span>
                <span>•</span>
                <span>{uniqueAgents.length} backing agent{uniqueAgents.length !== 1 ? 's' : ''}</span>
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
        <div className="mb-4">
          <h3 className="font-medium text-gray-700 mb-2 text-sm">What could happen here</h3>
          <div className="space-y-2">
            <div className="text-gray-700 text-sm leading-relaxed prose prose-sm max-w-none [&_a]:text-[#FC44E7] [&_a]:underline [&_a]:hover:opacity-80 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mb-1 [&_p]:mb-2 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-sm">
              <ReactMarkdown>
                {userStake.synthesis}
              </ReactMarkdown>
            </div>
          </div>
        </div>

        { false && 
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
        </div>}

        {false &&
        <div>
          <h3 className="font-medium text-gray-700 mb-2 text-sm">Who's backing this connection</h3>
          <div className="flex flex-wrap gap-2">
            {uniqueAgents.map((agent) => (
              <div key={agent.agent.name} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-gray-100">
                  <Image src={getAvatarUrl(agent.agent.avatar)} alt={agent.agent.name} width={16} height={16} />
                </div>
                <span className="font-medium text-gray-900">{agent.agent.name}</span>
              </div>
            ))}
          </div>
        </div>
        }
        </div>
      </div>
    );
  };

  const renderConnectionCard = (connection: UserConnection, tabType: 'inbox' | 'pending' | 'done') => {
    return (
      <div key={connection.user.id} className="p-0 mt-0 bg-white border border-b-2 border-gray-800 mb-4">
        <div className="py-4 px-2 sm:px-4 hover:bg-gray-50 transition-colors">
          <div className="flex flex-wrap sm:flex-nowrap justify-between items-start mb-4">
            <div className="flex items-center gap-4 w-full sm:w-auto mb-2 sm:mb-0">
              <Image
                src={getAvatarUrl(connection.user.avatar || '')}
                alt={connection.user.name}
                width={48}
                height={48}
                className="rounded-full"
              />
              <div>
                <h2 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">{connection.user.name}</h2>
                <div className="flex items-center gap-4 text-sm text-gray-500 font-ibm-plex-mono">
                  <span>{connection.status.toLowerCase()} • {new Date(connection.lastUpdated).toLocaleDateString()}</span>
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
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <ClientLayout>
        <div className="py-8 text-center text-gray-500">Loading inbox...</div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      <div className="w-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
          backgroundImage: 'url(/grid.png)',
          backgroundColor: 'white',
          backgroundSize: '888px'
        }}>

        <div className="flex flex-col justify-between mb-4">
          <Tabs.Root defaultValue="discover" className="flex-grow">
            <div className="flex flex-row items-end justify-between">
              <Tabs.List className="bg-white overflow-x-auto flex text-sm text-black">
                <Tabs.Trigger value="discover" className="font-ibm-plex-mono cursor-pointer border border-b-0 border-r-0 border-black px-3 py-2 data-[state=active]:bg-black data-[state=active]:text-white">
                  Discover ({discoverStakes.length})
                </Tabs.Trigger>
                <Tabs.Trigger value="inbox" className="font-ibm-plex-mono cursor-pointer border border-b-0 border-r-0 border-black px-3 py-2 data-[state=active]:bg-black data-[state=active]:text-white">
                  Inbox ({inboxConnections.length})
                </Tabs.Trigger>
                <Tabs.Trigger value="pending" className="font-ibm-plex-mono cursor-pointer border border-b-0 border-r-0 border-black px-3 py-2 data-[state=active]:bg-black data-[state=active]:text-white">
                  Pending ({pendingConnections.length})
                </Tabs.Trigger>
                <Tabs.Trigger value="done" className="font-ibm-plex-mono cursor-pointer border border-b-0 border-black px-3 py-2 data-[state=active]:bg-black data-[state=active]:text-white">
                  Done ({doneConnections.length})
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
              
              <Tabs.Content value="done" className="m-0 p-0">
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
                  No connection suggestions available right now.
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

            {/* Done Tab Content - Resolved connections */}
            <Tabs.Content value="done" className="mt-4">
              {doneConnections.length === 0 ? (
                <div className="p-0 mt-0 bg-white border border-b-2 border-gray-800 py-8 text-center text-gray-500">
                  No completed connections yet.
                </div>
              ) : (
                doneConnections.map((connection) => renderConnectionCard(connection, 'done'))
              )}
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </div>
    </ClientLayout>
  );
} 