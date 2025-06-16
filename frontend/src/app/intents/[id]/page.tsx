"use client";

import { useState, useEffect, useCallback, use } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Play, Archive, Pause, ArchiveRestore, Edit } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { agents } from "@/services/intents";
import { useIntents } from "@/contexts/APIContext";
import { Intent, IntentConnection, IntentStakesByUserResponse } from "@/lib/types";
import ClientLayout from "@/components/ClientLayout";
import EditIntentModal from "@/components/modals/EditIntentModal";

interface IntentDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function IntentDetailPage({ params }: IntentDetailPageProps) {
  const resolvedParams = use(params);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [stakesByUser, setStakesByUser] = useState<IntentStakesByUserResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const intentsService = useIntents();

  const fetchIntentData = useCallback(async () => {
    try {
      const intentData = await intentsService.getIntent(resolvedParams.id);
      setIntent(intentData || null);
      setIsArchived(!!(intentData?.archivedAt));
    } catch (error) {
      console.error('Error fetching intent data:', error);
    } finally {
      setLoading(false);
    }
  }, [intentsService, resolvedParams.id]);

  const fetchStakes = useCallback(async () => {
    try {
      const stakesData = await intentsService.getIntentStakesByUser(resolvedParams.id);
      setStakesByUser(stakesData);
    } catch (error) {
      console.error('Error fetching stakes:', error);
    }
  }, [intentsService, resolvedParams.id]);

  // Initial data fetch
  useEffect(() => {
    fetchIntentData();
    fetchStakes();
  }, [fetchIntentData, fetchStakes]);

  // Poll stakes every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isPaused) {
        fetchStakes();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchStakes, isPaused]);

  const handleArchiveIntent = useCallback(async () => {
    if (!intent) return;
    try {
      await intentsService.archiveIntent(intent.id);
      setIsArchived(true);
      setIntent(prev => prev ? { ...prev, archivedAt: new Date().toISOString() } : null);
    } catch (error) {
      console.error('Error archiving intent:', error);
    }
  }, [intentsService, intent]);

  const handleUnarchiveIntent = useCallback(async () => {
    if (!intent) return;
    try {
      await intentsService.unarchiveIntent(intent.id);
      setIsArchived(false);
      setIntent(prev => prev ? { ...prev, archivedAt: null } : null);
    } catch (error) {
      console.error('Error unarchiving intent:', error);
    }
  }, [intentsService, intent]);

  const handleEditIntent = useCallback(async (editData: { id: string; payload: string; indexIds: string[] }) => {
    try {
      // Update the intent payload
      await intentsService.updateIntent(editData.id, { payload: editData.payload });
      
      // Handle index changes if needed
      if (intent?.indexes) {
        const currentIndexIds = intent.indexes.map(idx => idx.indexId);
        const indexesToAdd = editData.indexIds.filter(id => !currentIndexIds.includes(id));
        const indexesToRemove = currentIndexIds.filter(id => !editData.indexIds.includes(id));
        
        if (indexesToAdd.length > 0) {
          await intentsService.addIndexesToIntent(editData.id, indexesToAdd);
        }
        if (indexesToRemove.length > 0) {
          await intentsService.removeIndexesFromIntent(editData.id, indexesToRemove);
        }
      }
      
      // Refresh the intent data
      await fetchIntentData();
    } catch (error) {
      console.error('Error updating intent:', error);
    }
  }, [intentsService, intent, fetchIntentData]);

  if (loading) {
    return (
      <ClientLayout>
        <div className="py-8 text-center text-gray-500">Loading...</div>
      </ClientLayout>
    );
  }

  if (!intent) {
    return (
      <ClientLayout>
        <div className="py-8 text-center text-gray-500">Intent not found</div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      {/* Main Tabs */}
      <div className="w-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
          backgroundImage: 'url(https://www.trychroma.com/pricing/grid.png)',
          backgroundColor: 'white',
          backgroundSize: '888px'
        }}>

        <div className="bg-white px-4 pt-1.5 pb-1 border border-black  border border-b-0 inline-block">
          <Link href="/intents" className="inline-flex items-center text-gray-600 hover:text-gray-900 cursor-pointer">
            <ArrowLeft className="h-4 w-4 mr-2" />
            <span className="font-ibm-plex-mono text-[14px] text-black font-medium">Back to intents</span>
          </Link>
        </div>

        <div className="bg-white px-4 pt-4 pb-4 mb-4 border border-black border-b-0 border-b-2">
          {/* Intent Title and Info */}
          <div className="flex flex-wrap sm:flex-nowrap justify-between items-center">
            <div className="w-full sm:w-auto mb-2 sm:mb-0">
              {intent.summary && (
                <div className="mb-2">
                  <h1 className="text-xl font-bold font-ibm-plex-mono text-gray-900">
                    {intent.summary}
                  </h1>
                </div>
              )}
              <div className={intent.summary ? "border-t border-gray-200 pt-2" : ""}>
                <p className="text-gray-500 font-ibm-plex-mono text-sm mt-1">
                  Updated {intent.updatedAt} • {stakesByUser.length} connections
                </p>
              </div>
            </div>
            <div className="flex gap-2 min-w-[90px] sm:min-w-[90px] sm:justify-end">
              {isArchived ? (
                <>
                  <Button 
                    variant="bordered" 
                    size="sm"
                    onClick={() => setIsEditModalOpen(true)}
                  >
                    <div className="flex items-center gap-2">
                      <Edit className="h-4 w-4" />
                      <span className="hidden sm:inline">Edit</span>
                    </div>
                  </Button>
                  <Button 
                    variant="bordered" 
                    size="sm"
                    onClick={handleUnarchiveIntent}
                  >
                    <div className="flex items-center gap-2">
                      <ArchiveRestore className="h-4 w-4" />
                    </div>
                  </Button>
                </>
              ) : isPaused ? (
                <>
                  <Button 
                    variant="bordered" 
                    size="sm"
                    onClick={() => setIsEditModalOpen(true)}
                  >
                    <div className="flex items-center gap-2">
                      <Edit className="h-4 w-4" />
                      <span className="hidden sm:inline">Edit</span>
                    </div>
                  </Button>
                  <Button 
                    variant="bordered" 
                    size="sm"
                    onClick={handleArchiveIntent}
                  >
                    <div className="flex items-center gap-2">
                      <Archive className="h-4 w-4" />
                    </div>
                  </Button>                
                  <Button 
                    variant="bordered" 
                    size="sm"
                    onClick={() => setIsPaused(false)}
                    className="relative group"
                  >
                    <div className="flex items-center gap-2">
                      <Play className="h-4 w-4" />
                    </div>
                  </Button>

                </>
              ) : (
                <>
                  <Button 
                    variant="bordered" 
                    size="sm"
                    onClick={() => setIsEditModalOpen(true)}
                  >
                    <div className="flex items-center gap-2">
                      <Edit className="h-4 w-4" />
                      <span className="hidden sm:inline">Edit</span>
                    </div>
                  </Button>
                  <Button 
                    variant="bordered" 
                    size="sm"
                    onClick={handleArchiveIntent}
                  >
                    <div className="flex items-center gap-2">
                      <Archive className="h-4 w-4" />
                    </div>
                  </Button>
                  <Button 
                  variant="bordered" 
                    size="sm"
                    onClick={() => setIsPaused(true)}
                    className="relative group hover:bg-red-50 hover:text-red-700"
                  >
                    <div className="flex items-center gap-2">
                      <div className="relative w-4 h-4">
                        <div className="relative w-4 h-4 flex mt-0.5 ml-0.5 ">
                          <div className="absolute inset-0 w-3 h-3 rounded-full bg-[#2EFF0A] group-hover:hidden" />
                          <div className="absolute inset-0 w-3 h-3 rounded-full bg-[#2EFF0A] animate-ping opacity-100 group-hover:hidden" />
                        </div>
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Pause className="h-4 w-4" />
                        </div>
                      </div>
                    </div>
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Connection Cards Grid */}
        <div className="grid grid-cols-1 gap-6">
          {stakesByUser.map((userStakes) => (
            <div key={userStakes.user.name} className="bg-white border border-black border-b-0 border-b-2 p-6">
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-4">
                  <Image
                    src={userStakes.user.avatar}
                    alt={userStakes.user.name}
                    width={48}
                    height={48}
                    className="rounded-full"
                  />
                  <div>
                    <h2 className="text-lg font-medium text-gray-900">{userStakes.user.name}</h2>
                    <p className="text-sm text-gray-600">Total Stake: {userStakes.totalStake}%</p>
                  </div>
                </div>
              </div>

              <div className="mb-6">
                <h3 className="font-medium text-gray-700 mb-3">Summary</h3>
                <div className="relative min-h-[100px]">
                  <p className="text-gray-700">
                    {userStakes.aggregatedSummary}
                  </p>
                </div>
              </div>

              <div>
                <h3 className="font-medium text-gray-700 mb-4">Agent Stakes</h3>
                <div className="flex flex-wrap gap-2">
                  {userStakes.agents.map((agent) => (
                    <div key={agent.agent.name} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                      <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-gray-100">
                        <Image src={agent.agent.avatar} alt={agent.agent.name} width={16} height={16} />
                      </div>
                      <span className="font-medium text-gray-900">{agent.agent.name}</span>
                      <span className="text-gray-400 text-xs">({agent.stake}%)</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Edit Intent Modal */}
      <EditIntentModal
        open={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
        onSubmit={handleEditIntent}
        intent={intent}
      />
    </ClientLayout>
  );
} 