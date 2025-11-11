'use client';

import { useState, useEffect, useCallback, use } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { useAdmin, useSynthesis } from '@/contexts/APIContext';
import { useNotifications } from '@/contexts/NotificationContext';
import ClientLayout from '@/components/ClientLayout';
import ConnectionRequestCard from '@/components/ConnectionRequestCard';

interface PendingConnection {
  id: string;
  initiator: {
    id: string;
    name: string;
    avatar: string | null;
  };
  receiver: {
    id: string;
    name: string;
    avatar: string | null;
  };
  createdAt: string;
}

export default function ApprovalsPage({ params }: { params: Promise<{ indexId: string }> }) {
  const { indexId } = use(params);
  const adminService = useAdmin();
  const synthesisService = useSynthesis();
  const { success, error: showError } = useNotifications();
  
  const activeTab = 'pending';
  const [pendingConnections, setPendingConnections] = useState<PendingConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [syntheses, setSyntheses] = useState<Record<string, string>>({});
  const [synthesisLoading, setSynthesisLoading] = useState<Record<string, boolean>>({});

  // Fetch synthesis for both users in the connection
  const fetchSynthesis = useCallback(async (initiatorId: string, receiverId: string) => {
    const cacheKey = `${initiatorId}-${receiverId}`;
    
    setSynthesisLoading(prev => ({ ...prev, [cacheKey]: true }));

    try {
      // Generate synthesis about the potential connection
      const response = await synthesisService.generateVibeCheck({
        targetUserId: receiverId,
        initiatorId: initiatorId,
        indexIds: [indexId]
      });
      setSyntheses(prev => ({ ...prev, [cacheKey]: response.synthesis }));
    } catch (error) {
      console.error('Error fetching synthesis:', error);
      setSyntheses(prev => ({ ...prev, [cacheKey]: "" }));
    } finally {
      setSynthesisLoading(prev => ({ ...prev, [cacheKey]: false }));
    }
  }, [synthesisService, indexId]);

  // Load pending connections
  const loadPendingConnections = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await adminService.getPendingConnections(indexId);
      setPendingConnections(response.connections);
      
      // Fetch synthesis for each connection
      response.connections.forEach(connection => {
        fetchSynthesis(connection.initiator.id, connection.receiver.id);
      });
    } catch (err) {
      console.error('Failed to load pending connections:', err);
      showError('Failed to load pending connections');
    } finally {
      setIsLoading(false);
    }
  }, [indexId, adminService, showError, fetchSynthesis]);

  useEffect(() => {
    if (activeTab === 'pending') {
      loadPendingConnections();
    }
  }, [activeTab, loadPendingConnections]);

  const handleApprove = async (connection: PendingConnection) => {
    setProcessingIds(prev => new Set(prev).add(connection.id));
    
    try {
      await adminService.approveConnection(
        indexId,
        connection.initiator.id,
        connection.receiver.id
      );
      
      // Remove from pending list
      setPendingConnections(prev => prev.filter(c => c.id !== connection.id));
      success('Connection approved - request sent to recipient');
    } catch (err) {
      console.error('Failed to approve connection:', err);
      showError('Failed to approve connection');
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(connection.id);
        return next;
      });
    }
  };

  const handleDeny = async (connection: PendingConnection) => {
    setProcessingIds(prev => new Set(prev).add(connection.id));
    
    try {
      await adminService.denyConnection(
        indexId,
        connection.initiator.id,
        connection.receiver.id
      );
      
      // Remove from pending list
      setPendingConnections(prev => prev.filter(c => c.id !== connection.id));
      success('Connection request denied');
    } catch (err) {
      console.error('Failed to deny connection:', err);
      showError('Failed to deny connection');
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(connection.id);
        return next;
      });
    }
  };

  return (
    <ClientLayout>
      <div className="w-full border border-gray-800 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
        backgroundImage: 'url(/grid.png)',
        backgroundColor: 'white',
        backgroundSize: '888px'
      }}>
        <div className="flex flex-col justify-between mb-4">
          <Tabs.Root value={activeTab} className="flex-grow">
            <Tabs.List className="overflow-x-auto inline-flex text-sm text-black">
              <Tabs.Trigger 
                value="pending" 
                className="font-ibm-plex-mono cursor-pointer border border-b-0 border-black px-3 py-2 bg-white data-[state=active]:bg-black data-[state=active]:text-white"
              >
                Waiting to approve
                {pendingConnections.length > 0 && (
                  <span className="ml-2 bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full data-[state=active]:bg-white data-[state=active]:text-black">
                    {pendingConnections.length}
                  </span>
                )}
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="pending" className="p-0 mt-0">
              {isLoading ? (
                <div className="flex justify-center items-center py-12 bg-white border border-b-2 border-gray-800">
                  <div className="h-8 w-8 border-4 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
                </div>
              ) : pendingConnections.length === 0 ? (
                <div className="text-center py-12 bg-white border border-b-2 border-gray-800">
                  <p className="text-gray-500 font-ibm-plex-mono">
                    No pending connection requests
                  </p>
                </div>
              ) : (
                pendingConnections.map((connection) => {
                  const cacheKey = `${connection.initiator.id}-${connection.receiver.id}`;
                  return (
                    <ConnectionRequestCard
                      key={connection.id}
                      initiator={connection.initiator}
                      receiver={connection.receiver}
                      createdAt={connection.createdAt}
                      synthesis={syntheses[cacheKey]}
                      synthesisLoading={synthesisLoading[cacheKey]}
                      onApprove={() => handleApprove(connection)}
                      onDeny={() => handleDeny(connection)}
                      isProcessing={processingIds.has(connection.id)}
                    />
                  );
                })
              )}
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </div>
    </ClientLayout>
  );
}

