"use client";

import { useState, useEffect, useCallback, use, useRef } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Play, Archive, Pause, ArchiveRestore, Edit } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import { useIntents, useSynthesis } from "@/contexts/APIContext";
import { Intent, IntentStakesByUserResponse } from "@/lib/types";
import { getAvatarUrl } from "@/lib/file-utils";
import ClientLayout from "@/components/ClientLayout";
import EditIntentModal from "@/components/modals/EditIntentModal";
import { formatDate } from "@/lib/utils";

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
  const [stakesLoading, setStakesLoading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [syntheses, setSyntheses] = useState<Record<string, string>>({});
  const [synthesisLoading, setSynthesisLoading] = useState<Record<string, boolean>>({});
  const fetchedSynthesesRef = useRef<Set<string>>(new Set());
  const intentsService = useIntents();
  const synthesisService = useSynthesis();

  const fetchSynthesis = useCallback(async (targetUserId: string) => {
    if (fetchedSynthesesRef.current.has(targetUserId)) {
      return; // Already fetched or in progress
    }

    fetchedSynthesesRef.current.add(targetUserId);
    setSynthesisLoading(prev => ({ ...prev, [targetUserId]: true }));

    try {
      const response = await synthesisService.generateVibeCheck({
        targetUserId,
        intentIds: [resolvedParams.id]
      });
      setSyntheses(prev => ({ ...prev, [targetUserId]: response.synthesis }));
    } catch (error) {
      console.error('Error fetching synthesis:', error);
      // Set empty synthesis on error to avoid infinite loading
      setSyntheses(prev => ({ ...prev, [targetUserId]: "" }));
    } finally {
      setSynthesisLoading(prev => ({ ...prev, [targetUserId]: false }));
    }
  }, [synthesisService, resolvedParams.id]);

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

  const fetchStakes = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) {
        setStakesLoading(true);
      }
      const stakesData = await intentsService.getIntentStakesByUser(resolvedParams.id);
      setStakesByUser(stakesData);

      // Automatically fetch synthesis for all users
      stakesData.forEach(userStakes => {
        fetchSynthesis(userStakes.user.id);
      });

    } catch (error) {
      console.error('Error fetching stakes:', error);
    } finally {
      if (showLoading) {
        setStakesLoading(false);
      }
    }
  }, [intentsService, resolvedParams.id, fetchSynthesis]);

  // Initial data fetch
  useEffect(() => {
    fetchIntentData();
    fetchStakes();
  }, [fetchIntentData, fetchStakes]);

  // Poll stakes every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isPaused) {
        fetchStakes(false); // Don't show loading for background refreshes
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

  const handleEditIntent = useCallback(async (editData: { id: string; payload: string; isIncognito: boolean; indexIds: string[] }) => {
    try {
      // Update the intent payload, visibility, and index associations
      await intentsService.updateIntent(editData.id, { 
        payload: editData.payload,
        isIncognito: editData.isIncognito,
        indexIds: editData.indexIds
      });
      
      // Refresh the intent data
      await fetchIntentData();
    } catch (error) {
      console.error('Error updating intent:', error);
    }
  }, [intentsService, fetchIntentData]);

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
          backgroundImage: 'url(/grid.png)',
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
          <div className="flex flex-wrap sm:flex-nowrap justify-between items-start gap-4">
            <div className="w-full sm:flex-1 sm:min-w-0 mb-0 sm:mb-0">
              {intent.summary && (
                <div className="mb-2">
                  <h1 className="text-xl font-bold font-ibm-plex-mono text-gray-900 break-words">
                    {intent.summary}
                  </h1>
                </div>
              )}
              <div className={intent.summary ? "pt-0" : ""}>
                <p className="text-gray-500 font-ibm-plex-mono text-sm mt-1">
                  Updated {formatDate(intent.updatedAt)} • {stakesByUser.length} connections
                </p>
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0 sm:self-center">
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
          {stakesLoading ? (
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
                Loading connections...
              </p>
            </div>
          ) : stakesByUser.length === 0 ? (
            <div className="flex flex-col items-center justify-center bg-white border border-black border-b-0 border-b-2 px-6 pb-8">
              <Image 
                className="h-auto"
                src={'/generic.png'} 
                alt="Hero Illustration" 
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
            stakesByUser.map((userStakes) => (
              <div key={userStakes.user.name} className="bg-white border border-black border-b-0 border-b-2 p-6">
                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <Image
                      src={getAvatarUrl(userStakes.user)}
                      alt={userStakes.user.name}
                      width={48}
                      height={48}
                      className="rounded-full"
                    />
                    <div>
                      <h2 className="text-lg font-medium text-gray-900">{userStakes.user.name}</h2>
                    </div>
                  </div>
                </div>

                {(synthesisLoading[userStakes.user.id] || syntheses[userStakes.user.id]) && (
                  <div className="mb-6">
                    <h3 className="font-medium text-gray-700 mb-3">What could happen here</h3>
                    <div className="relative min-h-[100px]">
                      {synthesisLoading[userStakes.user.id] ? (
                        <div className="text-gray-500 animate-pulse">
                          ...
                        </div>
                      ) : (
                        <div className="text-gray-700 text-sm leading-relaxed prose prose-sm max-w-none [&_a]:text-[#ec6767] [&_a]:font-bold [&_a]:underline [&_a]:hover:opacity-80 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mb-1 [&_p]:mb-2 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-sm">
                          <ReactMarkdown>
                            {syntheses[userStakes.user.id]}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                { false && <div>
                  <h3 className="font-medium text-gray-700 mb-4">Who's backing this match</h3>
                  <div className="flex flex-wrap gap-2">
                    {userStakes.agents.map((agent) => (
                      <div key={agent.agent.name} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                        <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-gray-100">
                          <Image src={getAvatarUrl(agent.agent)} alt={agent.agent.name} width={16} height={16} />
                        </div>
                        <span className="font-medium text-gray-900">{agent.agent.name}</span>
                        <span className="text-gray-400 text-xs">({agent.stake})</span>
                      </div>
                    ))}
                  </div>
                </div>}
              </div>
            ))
          )}
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