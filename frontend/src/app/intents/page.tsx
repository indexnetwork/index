"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useIntent } from "@/contexts/IntentContext";
import Header from "@/components/Header";
import CreateIntentModal from "@/components/modals/CreateIntentModal";

export default function IntentsPage() {
  const router = useRouter();
  const { intents } = useIntent();
  const [showIntentModal, setShowIntentModal] = useState(false);

  const handleIntentClick = (intentId: string) => {
    router.push(`/intents/${intentId}`);
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

        {/* Main Content */}
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
                  </TabsList>
                  
                  {/* Action Buttons - directly next to tabs */}
                  <div className="flex gap-2 mb-2 sm:mt-0">
                    <Button 
                      className="flex items-center gap-2 bg-gray-800 hover:bg-black rounded-[1px] text-white cursor-pointer"
                      onClick={() => setShowIntentModal(true)}
                    >
                      Create Intent
                    </Button>
                  </div>
                </div>
              
                {/* My Intents Content */}
                <TabsContent value="my-intents" className="p-0 mt-0 bg-white border-b-2 border-gray-800">
                  {/* Intent Item 1 */}
                  <div 
                    onClick={() => handleIntentClick("1")}
                    className="flex flex-wrap sm:flex-nowrap justify-between items-center py-4 px-3 sm:px-6 cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <div className="w-full sm:w-auto mb-2 sm:mb-0">
                      <h3 className="font-bold text-lg text-gray-900 font-ibm-plex">Looking to meet early stage founders building privacy-preserving agent coordination infra.</h3>
                      <p className="text-gray-500 text-sm">Updated May 6 • 4 connections</p>
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
                  <div 
                    onClick={() => handleIntentClick("2")}
                    className="flex flex-wrap sm:flex-nowrap justify-between items-center py-4 px-3 sm:px-6 border-t border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <div className="w-full sm:w-auto mb-2 sm:mb-0">
                      <h3 className="font-bold text-lg text-gray-900 font-ibm-plex">Looking to meet early stage founders building privacy-preserving agent coordination infra.</h3>
                      <p className="text-gray-500 text-sm">Updated May 6 • 4 connections</p>
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
                </TabsContent>
                
                {/* Archived Content */}
                <TabsContent value="archived" className="p-0 mt-0 bg-white border-b-2 border-gray-800">
                  <div className="py-8 text-center text-gray-500">
                    No archived intents
                  </div>
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
      <CreateIntentModal open={showIntentModal} onOpenChange={setShowIntentModal} />
    </div>
  );
} 