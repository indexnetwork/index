"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import * as Tabs from "@radix-ui/react-tabs";
import { useIntents } from "@/contexts/APIContext";
import { StakesByUserResponse } from "@/lib/types";
import { getAvatarUrl } from "@/lib/file-utils";
import ClientLayout from "@/components/ClientLayout";
import ConnectionActions, { ConnectionAction } from "@/components/ConnectionActions";

export default function InboxPage() {
  const [inboxStakes, setInboxStakes] = useState<StakesByUserResponse[]>([]);
  const [waitingStakes, setWaitingStakes] = useState<StakesByUserResponse[]>([]);
  const [doneStakes, setDoneStakes] = useState<StakesByUserResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const intentsService = useIntents();

  const fetchStakes = useCallback(async () => {
    try {
      // For now, we'll use the existing getAllStakes and simulate different types
      // In a real implementation, you'd have separate endpoints for each type
      const stakesData = await intentsService.getAllStakes();
      
      // Simulate different stake states for demo
      // Inbox: Items awaiting your response (pending_received, none, declined, skipped)
      setInboxStakes(stakesData.slice(0, Math.ceil(stakesData.length / 3)));
      
      // Waiting: You acted, awaiting them (pending_sent)
      setWaitingStakes(stakesData.slice(Math.ceil(stakesData.length / 3), Math.ceil(2 * stakesData.length / 3)));
      
      // Done: Resolved or removed (connected, declined, cancelled, removed)
      setDoneStakes(stakesData.slice(Math.ceil(2 * stakesData.length / 3)));
    } catch (error) {
      console.error('Error fetching stakes:', error);
    } finally {
      setLoading(false);
    }
  }, [intentsService]);

  useEffect(() => {
    fetchStakes();
  }, [fetchStakes]);

  const handleConnectionAction = async (action: ConnectionAction, userId: string) => {
    console.log(`Connection action: ${action} for user: ${userId}`);
    // TODO: Implement API calls for connection actions
    // This would call your backend to update connection status
    // await intentsService.updateConnectionStatus(userId, action);
    
    // For now, just log the action
    // In real implementation, you'd update the local state and move items between tabs
    
    // Example logic for moving items between tabs:
    switch (action) {
      case 'REQUEST':
        // Move from inbox to waiting
        // Find the connection and move it
        break;
      case 'SKIP':
        // Move from inbox to done
        break;
      case 'ACCEPT':
        // Move from inbox to done (final accept)
        break;
      case 'DECLINE':
        // Move from inbox to done
        break;
      case 'CANCEL':
        // Move from waiting to done
        break;
      case 'REMOVE':
        // Move from any tab to done
        break;
    }
  };

  const getConnectionStatus = (tabType: 'inbox' | 'waiting' | 'done') => {
    switch (tabType) {
      case 'inbox':
        return 'none'; // or 'pending_received' for items awaiting your response
      case 'waiting':
        return 'pending_sent'; // you acted, awaiting them
      case 'done':
        return 'connected'; // or other resolved states
      default:
        return 'none';
    }
  };

  const renderStakeCard = (userStake: StakesByUserResponse, tabType: 'inbox' | 'waiting' | 'done') => {
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
              userId={userStake.user.name} // In real app, this would be user ID
              userName={userStake.user.name}
              connectionStatus={getConnectionStatus(tabType) as 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'declined' | 'skipped'}
              onAction={handleConnectionAction}
              size="sm"
            />
          </div>
        </div>

        {/* Consolidated Reasoning */}
        <div className="mb-4">
          <h3 className="font-medium text-gray-700 mb-2 text-sm">Why this connection matters</h3>
          <div className="space-y-2">
            {userStake.intents.map((intentConnection) => (
              <div key={intentConnection.intent.id} className="relative">
                <p className="text-gray-700 text-sm leading-relaxed">
                  {intentConnection.aggregatedSummary}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Mutual Intents */}
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

        {/* All Backing Agents Summary */}
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
          <Tabs.Root defaultValue="inbox" className="flex-grow">
            <div className="flex flex-row items-end justify-between">
              <Tabs.List className="bg-white overflow-x-auto flex text-sm text-black">
                <Tabs.Trigger value="inbox" className="font-ibm-plex-mono cursor-pointer border border-b-0 border-r-0 border-black px-3 py-2 data-[state=active]:bg-black data-[state=active]:text-white">
                  Inbox ({inboxStakes.length})
                </Tabs.Trigger>
                <Tabs.Trigger value="waiting" className="font-ibm-plex-mono cursor-pointer border border-b-0 border-r-0 border-black px-3 py-2 data-[state=active]:bg-black data-[state=active]:text-white">
                  Waiting ({waitingStakes.length})
                </Tabs.Trigger>
                <Tabs.Trigger value="done" className="font-ibm-plex-mono cursor-pointer border border-b-0 border-black px-3 py-2 data-[state=active]:bg-black data-[state=active]:text-white">
                  Done ({doneStakes.length})
                </Tabs.Trigger>
              </Tabs.List>
            </div>

            {/* Section Descriptions */}
            <div>
              <Tabs.Content value="inbox" className="m-0 p-0">
                <div className="bg-white border border-b-2 border-gray-800 p-3">
                  <p className="text-sm text-gray-700 font-ibm-plex-mono">
                    Connection opportunities awaiting your response. Review potential matches and decide whether to connect, skip, or decline.
                  </p>
                </div>
              </Tabs.Content>
              
              <Tabs.Content value="waiting" className="m-0 p-0">
                <div className="bg-white border border-b-2 border-gray-800 p-3">
                  <p className="text-sm text-gray-700 font-ibm-plex-mono">
                    Connection requests you've sent that are pending responses from other users. You can cancel these requests if needed.
                  </p>
                </div>
              </Tabs.Content>
              
              <Tabs.Content value="done" className="m-0 p-0">
                <div className="bg-white border border-b-2 border-gray-800 p-3">
                  <p className="text-sm text-gray-700 font-ibm-plex-mono">
                     Completed connections, declined requests, and removed items. This is your connection history.
                  </p>
                </div>
              </Tabs.Content>
            </div>

            {/* Inbox Tab Content - Awaiting your response */}
            <Tabs.Content value="inbox" className="mt-4">
              {inboxStakes.length === 0 ? (
                <div className="p-0 mt-0 bg-white border border-b-2 border-gray-800 py-8 text-center text-gray-500">
                  No items in your inbox. All caught up!
                </div>
              ) : (
                inboxStakes.map((userStake) => renderStakeCard(userStake, 'inbox'))
              )}
            </Tabs.Content>

            {/* Waiting Tab Content - You acted, awaiting them */}
            <Tabs.Content value="waiting" className="mt-4">
              {waitingStakes.length === 0 ? (
                <div className="p-0 mt-0 bg-white border border-b-2 border-gray-800 py-8 text-center text-gray-500">
                  No pending requests. You haven't sent any connection requests recently.
                </div>
              ) : (
                waitingStakes.map((userStake) => renderStakeCard(userStake, 'waiting'))
              )}
            </Tabs.Content>

            {/* Done Tab Content - Resolved or removed */}
            <Tabs.Content value="done" className="mt-4">
              {doneStakes.length === 0 ? (
                <div className="p-0 mt-0 bg-white border border-b-2 border-gray-800 py-8 text-center text-gray-500">
                  No completed connections yet.
                </div>
              ) : (
                doneStakes.map((userStake) => renderStakeCard(userStake, 'done'))
              )}
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </div>
    </ClientLayout>
  );
} 