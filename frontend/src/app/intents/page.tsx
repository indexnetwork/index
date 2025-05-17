"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import CreateIntentModal from "@/components/modals/CreateIntentModal";
import { intentsService, Intent } from "@/services/intents";
import ClientLayout from "@/components/ClientLayout";

export default function IntentsPage() {
  const router = useRouter();
  const [showIntentModal, setShowIntentModal] = useState(false);
  const [activeIntents, setActiveIntents] = useState<Intent[]>([]);
  const [archivedIntents, setArchivedIntents] = useState<Intent[]>([]);
  const [suggestedIntents, setSuggestedIntents] = useState<Intent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchIntents = async () => {
      try {
        const [active, archived, suggested] = await Promise.all([
          intentsService.getIntents('active'),
          intentsService.getIntents('archived'),
          intentsService.getIntents('suggested')
        ]);
        setActiveIntents(active);
        setArchivedIntents(archived);
        setSuggestedIntents(suggested);
      } catch (error) {
        console.error('Error fetching intents:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchIntents();
  }, []);

  const handleIntentClick = (intentId: string) => {
    router.push(`/intents/${intentId}`);
  };

  const handleCreateIntent = async (intent: { title: string; indexIds: string[] }) => {
    try {
      const newIntent = await intentsService.createIntent(intent);
      setActiveIntents(prev => [...prev, newIntent]);
      setShowIntentModal(false);
    } catch (error) {
      console.error('Error creating intent:', error);
    }
  };

  return (
    <ClientLayout>
      <div className="w-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
        backgroundImage: 'url(https://www.trychroma.com/pricing/grid.png)',
        backgroundColor: 'white',
        backgroundSize: '888px'
      }}>
        <div className="flex flex-col mb-4">
          <Tabs defaultValue="my-intents" className="flex-grow">
            <div className="flex flex-row items-end justify-between">
              <TabsList className="border border-black border-b-0 bg-transparent p-0 overflow-x-auto">
                <TabsTrigger value="my-intents" className="font-ibm-plex-mono cursor-pointer">
                  Active
                </TabsTrigger>
                <TabsTrigger value="archived" className="font-ibm-plex-mono cursor-pointer">
                  Archived
                </TabsTrigger>
                <TabsTrigger value="suggested" className="font-ibm-plex-mono cursor-pointer">
                  Suggested
                </TabsTrigger>
              </TabsList>
              
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
            <TabsContent value="my-intents" className="p-0 mt-0 bg-white border-b-2 border-gray-800">
              {loading ? (
                <div className="py-8 text-center text-gray-500">Loading...</div>
              ) : activeIntents.length === 0 ? (
                <div className="py-8 text-center text-gray-500">No active intents</div>
              ) : (
                activeIntents.map((intent) => (
                  <div 
                    key={intent.id}
                    onClick={() => handleIntentClick(intent.id)}
                    className="flex flex-wrap sm:flex-nowrap justify-between items-center py-4 px-3 sm:px-6 cursor-pointer hover:bg-gray-50 transition-colors border-t border-gray-200 first:border-t-0"
                  >
                    <div className="w-full sm:w-auto mb-2 sm:mb-0">
                      <h3 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">{intent.title}</h3>
                      <p className="text-gray-500 font-ibm-plex-mono text-sm">Updated {intent.updatedAt} • {intent.connections} connections</p>
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
            </TabsContent>
            
            {/* Archived Content */}
            <TabsContent value="archived" className="p-0 mt-0 bg-white border-b-2 border-gray-800">
              {loading ? (
                <div className="py-8 text-center text-gray-500">Loading...</div>
              ) : archivedIntents.length === 0 ? (
                <div className="py-8 text-center text-gray-500">No archived intents</div>
              ) : (
                archivedIntents.map((intent) => (
                  <div 
                    key={intent.id}
                    onClick={() => handleIntentClick(intent.id)}
                    className="flex flex-wrap sm:flex-nowrap justify-between items-center py-4 px-3 sm:px-6 cursor-pointer hover:bg-gray-50 transition-colors border-t border-gray-200 first:border-t-0"
                  >
                    <div className="w-full sm:w-auto mb-2 sm:mb-0">
                      <h3 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">{intent.title}</h3>
                      <p className="text-gray-500 font-ibm-plex-mono text-sm">Updated {intent.updatedAt} • {intent.connections} connections</p>
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
            </TabsContent>

            {/* Suggested Content */}
            <TabsContent value="suggested" className="p-0 mt-0 bg-white border-b-2 border-gray-800">
              {loading ? (
                <div className="py-8 text-center text-gray-500">Loading...</div>
              ) : suggestedIntents.length === 0 ? (
                <div className="py-8 text-center text-gray-500">No suggested intents</div>
              ) : (
                suggestedIntents.map((intent) => (
                  <div 
                    key={intent.id}
                    className="flex flex-wrap sm:flex-nowrap justify-between items-center py-4 px-3 sm:px-6 cursor-pointer hover:bg-gray-50 transition-colors border-t border-gray-200 first:border-t-0"
                  >
                    <div className="w-full sm:w-auto mb-2 sm:mb-0">
                      <h3 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">{intent.title}</h3>
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
            </TabsContent>
          </Tabs>
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