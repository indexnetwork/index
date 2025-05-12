"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import Header from "@/components/Header";
import CreateIntentModal from "@/components/modals/CreateIntentModal";
import { intentsService, Intent } from "@/services/intents";

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
    <div className="backdrop relative">
      <style jsx>{`
        .backdrop:after {
          content: "";
          position: fixed;
          left: 0;
          top: 0;
          bottom: 0;
          right: 0;
          background: url(https://www.trychroma.com/img/noise.jpg);
          opacity: .12;
          pointer-events: none;
          z-index: -1;
        }
      `}</style>
      
      <div className="flex flex-col">
        <Header />

        <div className="flex-1 px-2 sm:px-2 md:px-32">
          {/* Main Tabs */}
          <div className="w-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
              backgroundImage: 'url(https://www.trychroma.com/pricing/grid.png)',
              backgroundColor: 'white',
              backgroundSize: '888px'
            }}>
            <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-4">
              <Tabs defaultValue="my-intents" className="flex-grow">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between">
                  <TabsList className="w-full sm:w-auto h-auto border border-black border-b-0 bg-transparent p-0 overflow-x-auto">
                    <TabsTrigger value="my-intents" className="font-ibm-plex cursor-pointer">
                      Active
                    </TabsTrigger>
                    <TabsTrigger value="archived" className="font-ibm-plex cursor-pointer">
                      Archived
                    </TabsTrigger>
                    <TabsTrigger value="suggested" className="font-ibm-plex cursor-pointer">
                      Suggested
                    </TabsTrigger>
                  </TabsList>
                  
                  {/* Action Buttons - directly next to tabs */}
                  <div className="flex gap-2 mb-2 sm:mt-0">
                    <Button 
                      className="flex items-center gap-2 bg-gray-800 hover:bg-black rounded-[1px] text-white cursor-pointer"
                      onClick={() => setShowIntentModal(true)}
                    >
                      <Plus className="h-4 w-4" />
                      Create Intent
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
                          <h3 className="font-bold text-lg text-gray-900 font-ibm-plex">{intent.title}</h3>
                          <p className="text-gray-500 text-sm">Updated {intent.updatedAt} • {intent.connections} connections</p>
                        </div>
                        <Button 
                          variant="outline" 
                          size="sm"
                          className="w-full sm:w-auto border-gray-400 text-gray-700 hover:bg-gray-100 rounded-[1px] hover:text-black cursor-pointer"
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
                          <h3 className="font-bold text-lg text-gray-900 font-ibm-plex">{intent.title}</h3>
                          <p className="text-gray-500 text-sm">Updated {intent.updatedAt} • {intent.connections} connections</p>
                        </div>
                        <Button 
                          variant="outline" 
                          size="sm"
                          className="w-full sm:w-auto border-gray-400 text-gray-700 hover:bg-gray-100 rounded-[1px] hover:text-black cursor-pointer"
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
                          <h3 className="font-bold text-lg text-gray-900 font-ibm-plex">{intent.title}</h3>
                        </div>
                        <Button 
                          variant="outline" 
                          size="sm"
                          className="w-full sm:w-auto border-gray-400 text-gray-700 hover:bg-gray-100 rounded-[1px] hover:text-black cursor-pointer"
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
          
          {/* Footer Info */}
          <div className="mt-4 text-center text-sm text-gray-500 p-4">
            Intents help you connect to and search across multiple indexes with a specific purpose
          </div>
        </div>
      </div>

      {/* Modals */}
      <CreateIntentModal 
        open={showIntentModal} 
        onOpenChange={setShowIntentModal}
        onSubmit={handleCreateIntent}
      />
    </div>
  );
} 