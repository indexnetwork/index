"use client";

import { useState, useEffect, useCallback } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Button } from "@/components/ui/button";
import { Share2, Plus, Lock } from "lucide-react";
import CreateIndexModal from "@/components/modals/CreateIndexModal";
import ConfigureModal from "@/components/modals/ConfigureModal";
import ShareSettingsModal from "@/components/modals/ShareSettingsModal";
import { useIndexes } from "@/contexts/APIContext";
import { Index } from "@/lib/types";
import { MCP } from '@lobehub/icons';
import ClientLayout from "@/components/ClientLayout";

export default function IndexesPage() {
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [showIndexModal, setShowIndexModal] = useState(false);
  const [showShareSettingsModal, setShowShareSettingsModal] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<Index | null>(null);
  const [indexes, setIndexes] = useState<Index[]>([]);
  const [loading, setLoading] = useState(true);
  const indexesService = useIndexes();

  const fetchIndexes = useCallback(async () => {
    try {
      const response = await indexesService.getIndexes();
      setIndexes(response.indexes || []);
    } catch (error) {
      console.error('Error fetching indexes:', error);
    } finally {
      setLoading(false);
    }
  }, [indexesService]);

  useEffect(() => {
    fetchIndexes();
  }, [fetchIndexes]);

  const handleCreateIndex = async (indexData: { name: string }) => {
    try {
      const createRequest = {
        title: indexData.name,
        isPublic: false
      };
      
      const newIndex = await indexesService.createIndex(createRequest);
      setIndexes(prev => [...prev, newIndex]);
      setShowIndexModal(false);
    } catch (error) {
      console.error('Error creating index:', error);
    }
  };

  return (
    <ClientLayout>
      {/* Main Content */}
      <div className="w-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
          backgroundImage: 'url(https://www.trychroma.com/pricing/grid.png)',
          backgroundColor: 'white',
          backgroundSize: '888px'
        }}>
        <div className="flex flex-col justify-between mb-4">
          <Tabs.Root defaultValue="my-indexes" className="flex-grow">
            <div className="flex  flex-row items-end justify-between">
            <Tabs.List className="bg-white overflow-x-auto flex text-sm text-black">
                <Tabs.Trigger value="my-indexes" className="font-ibm-plex-mono cursor-pointer border border-r-0 border-black px-3 py-2 data-[state=active]:bg-black data-[state=active]:text-white">
                  My indexes
                </Tabs.Trigger>
                <Tabs.Trigger value="shared-with-me" className="font-ibm-plex-mono cursor-pointer border border-black px-3 py-2 data-[state=active]:bg-black data-[state=active]:text-white">
                  Shared with me
                </Tabs.Trigger>
              </Tabs.List>
              
              {/* Action Buttons - directly next to tabs */}
              <div className="flex gap-2 mb-2 sm:mt-0">
                <Button 
                  className="flex items-center gap-2"
                  onClick={() => setShowIndexModal(true)}
                >
                  <Plus className="h-4 w-4" />
                  <span className="hidden sm:inline">Create New Index</span>
                </Button>
                <Button 
                  className="flex items-center gap-2"
                  onClick={() => setShowConfigDialog(true)}
                >
                  <MCP className="h-4 w-4" />
                  <span className="hidden sm:inline">Configure MCP</span>
                </Button>
              </div>
            </div>
          
            {/* My Indexes Content */}
            <Tabs.Content value="my-indexes" className="p-0 mt-0 bg-white border-b-2 border-gray-800">
              {loading ? (
                <div className="py-8 text-center text-gray-500">Loading...</div>
              ) : (
                <>
                  {/* Other Indexes */}
                  {indexes.map((index) => (
                    <div 
                      key={index.id}
                      className="flex flex-wrap sm:flex-nowrap justify-between items-center py-4 px-2 sm:px-4 cursor-pointer hover:bg-gray-50 transition-colors border-t border-gray-200 first:border-t-0"
                      onClick={() => {
                        window.location.href = `/indexes/${index.id}`;
                      }}
                    >
                      <div className="w-full sm:w-auto mb-2 sm:mb-0">
                        <h3 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">{index.title}</h3>
                        <p className="text-gray-500 text-sm font-ibm-plex-mono">Updated {new Date(index.createdAt).toLocaleDateString()} • {index._count?.members || 0} members</p>
                      </div>
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button 
                          variant="outline" 
                          size="sm"
                                                  onClick={(e) => {
                          e.stopPropagation();
                          setSelectedIndex(index);
                          setShowShareSettingsModal(true);
                        }}
                        >
                          <Share2 className="h-4 w-4 mr-2" />
                          Share
                        </Button>
                      </div>
                    </div>
                  ))}

                  {/* Private Index */}
                  <div 
                    className="flex flex-wrap sm:flex-nowrap justify-between items-center py-4 px-3 sm:px-6 cursor-pointer hover:bg-gray-50 transition-colors border-t border-gray-200 first:border-t-0"
                    onClick={() => {
                      console.log("clicked");
                    }}
                  >
                    <div className="w-full sm:w-auto mb-2 sm:mb-0">
                      <div className="flex items-center gap-2">
                        <Lock className="h-4 w-4 text-gray-900" />
                        <h3 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">Personal Index</h3>
                      </div>
                      <p className="text-gray-500 text-sm font-normal">Your personal knowledge base</p>
                    </div>
                    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          console.log("clicked");
                        }}
                      >
                        <Lock className="h-4 w-4 mr-2" />
                        Manage
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </Tabs.Content>
            
            {/* Shared With Me Content */}
            <Tabs.Content value="shared-with-me" className="p-0 mt-0 bg-white border-b-2 border-gray-800">
              <div className="py-8 text-center text-gray-500">
                No indexes shared with you yet
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </div>

      {/* Footer Info */}
      <div className="mt-4 text-center text-sm text-gray-500 p-4">
        Indexes are privately secured and only shared with explicit permission after approval
      </div>

      {/* Modals */}
      <CreateIndexModal 
        open={showIndexModal} 
        onOpenChange={setShowIndexModal}
        onSubmit={handleCreateIndex}
      />
      <ConfigureModal open={showConfigDialog} onOpenChange={setShowConfigDialog} />
      {selectedIndex && (
        <ShareSettingsModal 
          open={showShareSettingsModal} 
          onOpenChange={setShowShareSettingsModal}
          index={selectedIndex}
          onIndexUpdate={(updatedIndex) => {
            setIndexes(prev => prev.map(idx => idx.id === updatedIndex.id ? updatedIndex : idx));
            setSelectedIndex(updatedIndex);
          }}
        />
      )}
    </ClientLayout>
  );
} 