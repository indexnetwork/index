"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as Tabs from "@radix-ui/react-tabs";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import CreateIntentModal from "@/components/modals/CreateIntentModal";
import { useIntents } from "@/contexts/APIContext";
import { Intent } from "@/lib/types";
import ClientLayout from "@/components/ClientLayout";

export default function IntentsPage() {
  const router = useRouter();
  const [showIntentModal, setShowIntentModal] = useState(false);
  const [activeIntents, setActiveIntents] = useState<Intent[]>([]);
  const [archivedIntents, setArchivedIntents] = useState<Intent[]>([]);
  const [suggestedIntents, setSuggestedIntents] = useState<Intent[]>([]);
  const [loading, setLoading] = useState(true);
  const intentsService = useIntents();

  const fetchIntents = useCallback(async () => {
    try {
      const response = await intentsService.getIntents();
      const intents = response.intents || [];
      // For now, we'll use the same data for all tabs
      // In real implementation, you'd filter by status
      setActiveIntents(intents);
      setArchivedIntents(intents);
      setSuggestedIntents(intents);
    } catch (error) {
      console.error('Error fetching intents:', error);
    } finally {
      setLoading(false);
    }
  }, [intentsService]);

  useEffect(() => {
    fetchIntents();
  }, [fetchIntents]);

  const handleIntentClick = useCallback((intentId: string) => {
    router.push(`/intents/${intentId}`);
  }, [router]);

  const handleCreateIntent = useCallback(async (intent: { payload: string; indexIds: string[]; attachments: File[] }) => {
    try {
      const newIntent = await intentsService.createIntent(intent);
      setActiveIntents(prev => [...prev, newIntent]);
      setShowIntentModal(false);
    } catch (error) {
      console.error('Error creating intent:', error);
    }
  }, [intentsService]);

  return (
    <ClientLayout>
      <div className="w-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
        backgroundImage: 'url(https://www.trychroma.com/pricing/grid.png)',
        backgroundColor: 'white',
        backgroundSize: '888px'
      }}>
        <div className="flex flex-col mb-4">
          <Tabs.Root defaultValue="my-intents" className="flex-grow">
            <div className="flex flex-row items-end justify-between">
              <Tabs.List className="bg-white overflow-x-auto flex text-sm text-black">
                <Tabs.Trigger value="my-intents"  className="font-ibm-plex-mono cursor-pointer border border-r-0 border-black px-3 py-2 data-[state=active]:bg-black data-[state=active]:text-white">
                  Active
                </Tabs.Trigger>
                <Tabs.Trigger value="archived"  className="font-ibm-plex-mono cursor-pointer border border-r-0 border-black px-3 py-2 data-[state=active]:bg-black data-[state=active]:text-white">
                  Archived
                </Tabs.Trigger>
                <Tabs.Trigger value="suggested"  className="font-ibm-plex-mono cursor-pointer border border-black px-3 py-2 data-[state=active]:bg-black data-[state=active]:text-white">
                  Suggested
                </Tabs.Trigger>
              </Tabs.List>
              
              {/* Action Buttons - directly next to tabs */}
              <div className="flex gap-2 mb-2 sm:mt-0">
                <Button 
                  className="gap-2"
                  onClick={() => setShowIntentModal(true)}
                >
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Create Intent</span>
                </Button>
              </div>
            </div>

            {/* My Intents Content */}
            <Tabs.Content value="my-intents" className="p-0 mt-0 bg-white border-b-2 border-gray-800">
              {loading ? (
                <div className="py-8 text-center text-gray-500">Loading...</div>
              ) : activeIntents.length === 0 ? (
                <div className="py-8 text-center text-gray-500">No active intents</div>
              ) : (
                activeIntents.map((intent) => (
                  <div 
                    key={intent.id}
                    onClick={() => handleIntentClick(intent.id)}
                    className="flex flex-wrap sm:flex-nowrap justify-between items-center py-4 px-2 sm:px-4 cursor-pointer hover:bg-gray-50 transition-colors border-t border-gray-200 first:border-t-0"
                  >
                    <div className="w-full sm:w-auto mb-2 sm:mb-0">
                      <h3 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">{intent.payload.substring(0, 100)}...</h3>
                      <p className="text-gray-500 font-ibm-plex-mono text-sm">Updated {new Date(intent.updatedAt).toLocaleDateString()} • {intent._count?.indexes} indexes</p>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Add manage functionality here
                      }}
                    >
                      Manage
                    </Button>
                  </div>
                ))
              )}
            </Tabs.Content>
            
            {/* Archived Content */}
            <Tabs.Content value="archived" className="p-0 mt-0 bg-white border-b-2 border-gray-800">
              {loading ? (
                <div className="py-8 text-center text-gray-500">Loading...</div>
              ) : archivedIntents.length === 0 ? (
                <div className="py-8 text-center text-gray-500">No archived intents</div>
              ) : (
                archivedIntents.map((intent) => (
                  <div 
                    key={intent.id}
                    onClick={() => handleIntentClick(intent.id)}
                    className="flex flex-wrap sm:flex-nowrap justify-between items-center py-4 px-2 sm:px-4 cursor-pointer hover:bg-gray-50 transition-colors border-t border-gray-200 first:border-t-0"
                  >
                    <div className="w-full sm:w-auto mb-2 sm:mb-0">
                      <h3 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">{intent.payload.substring(0, 100)}...</h3>
                      <p className="text-gray-500 font-ibm-plex-mono text-sm">Updated {new Date(intent.updatedAt).toLocaleDateString()} • {intent._count?.indexes || 0} indexes</p>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Add manage functionality here
                      }}
                    >
                      Manage
                    </Button>
                  </div>
                ))
              )}
            </Tabs.Content>

            {/* Suggested Content */}
            <Tabs.Content value="suggested" className="p-0 mt-0 bg-white border-b-2 border-gray-800">
              {loading ? (
                <div className="py-8 text-center text-gray-500">Loading...</div>
              ) : suggestedIntents.length === 0 ? (
                <div className="py-8 text-center text-gray-500">No suggested intents</div>
              ) : (
                suggestedIntents.map((intent) => (
                  <div 
                    key={intent.id}
                    className="flex flex-wrap sm:flex-nowrap justify-between items-center py-4 px-2 sm:px-4 cursor-pointer hover:bg-gray-50 transition-colors border-t border-gray-200 first:border-t-0"
                  >
                    <div className="w-full sm:w-auto mb-2 sm:mb-0">
                      <h3 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">{intent.payload.substring(0, 100)}...</h3>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Add functionality here
                      }}
                    >
                      Add
                    </Button>
                  </div>
                ))
              )}
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </div>

      {/* Modals */}
      <CreateIntentModal 
        open={showIntentModal} 
        onOpenChange={setShowIntentModal}
        onSubmit={handleCreateIntent}
      />
    </ClientLayout>
  );
} 