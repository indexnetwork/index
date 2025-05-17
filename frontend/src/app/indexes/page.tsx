"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Eye, Share2, MoreVertical, Pencil, Trash, Plus, Lock } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import CreateIndexModal from "@/components/modals/CreateIndexModal";
import ConfigureModal from "@/components/modals/ConfigureModal";
import ShareSettingsModal from "@/components/modals/ShareSettingsModal";
import { indexesService, Index } from "@/services/indexes";
import { MCP } from '@lobehub/icons';
import ClientLayout from "@/components/ClientLayout";

export default function IndexesPage() {
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [showIndexModal, setShowIndexModal] = useState(false);
  const [showShareSettingsModal, setShowShareSettingsModal] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState("");
  const [indexToRename, setIndexToRename] = useState("");
  const [indexes, setIndexes] = useState<Index[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchIndexes = async () => {
      try {
        const data = await indexesService.getIndexes();
        setIndexes(data);
      } catch (error) {
        console.error('Error fetching indexes:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchIndexes();
  }, []);

  const handleRenameIndex = async (indexName: string) => {
    setIndexToRename(indexName);
    // TODO: Implement rename functionality
    console.log("Rename index:", indexName);
  };

  const handleRemoveIndex = async (indexName: string) => {
    try {
      const index = indexes.find(i => i.name === indexName);
      if (index) {
        await indexesService.deleteIndex(index.id);
        setIndexes(prev => prev.filter(i => i.id !== index.id));
      }
    } catch (error) {
      console.error('Error removing index:', error);
    }
  };

  const handleCreateIndex = async (index: Omit<Index, 'id'>) => {
    try {
      const newIndex = await indexesService.createIndex(index);
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
          <Tabs defaultValue="my-indexes" className="flex-grow">
            <div className="flex  flex-row items-end justify-between">
              <TabsList className=" border border-black border-b-0 bg-transparent p-0 overflow-x-auto">
                <TabsTrigger value="my-indexes" className="font-ibm-plex-mono cursor-pointer">
                  My indexes
                </TabsTrigger>
                <TabsTrigger value="shared-with-me" className="font-ibm-plex-mono cursor-pointer">
                  Shared with me
                </TabsTrigger>
              </TabsList>
              
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
            <TabsContent value="my-indexes" className="p-0 mt-0 bg-white border-b-2 border-gray-800">
              {loading ? (
                <div className="py-8 text-center text-gray-500">Loading...</div>
              ) : (
                <>
                  {/* Other Indexes */}
                  {indexes.map((index) => (
                    <div 
                      key={index.id}
                      className="flex flex-wrap sm:flex-nowrap justify-between items-center py-4 px-3 sm:px-6 cursor-pointer hover:bg-gray-50 transition-colors border-t border-gray-200 first:border-t-0"
                      onClick={() => {
                        window.location.href = `/indexes/${index.id}`;
                      }}
                    >
                      <div className="w-full sm:w-auto mb-2 sm:mb-0">
                        <h3 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">{index.name}</h3>
                        <p className="text-gray-500 text-sm font-ibm-plex-mono">Updated {index.createdAt} • {index.members} members</p>
                      </div>
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedIndex(index.name);
                            setShowShareSettingsModal(true);
                          }}
                        >
                          <Share2 className="h-4 w-4 mr-2" />
                          Share
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="bg-white border border-gray-200 rounded-[1px]">
                            <DropdownMenuItem 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRenameIndex(index.name);
                              }} 
                              className="hover:bg-gray-50 cursor-pointer text-gray-700 rounded-[1px] focus:text-gray-900"
                            >
                              <Pencil className="h-4 w-4 mr-2" />
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuSeparator className="bg-gray-100" />
                            <DropdownMenuItem 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveIndex(index.name);
                              }}
                              className="text-red-600 hover:bg-red-50 hover:text-red-700 cursor-pointer rounded-[1px] focus:text-red-700"
                            >
                              <Trash className="h-4 w-4 mr-2" />
                              Remove
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}

                  {/* Private Index */}
                  <div 
                    className="flex flex-wrap sm:flex-nowrap justify-between items-center py-4 px-3 sm:px-6 cursor-pointer hover:bg-gray-50 transition-colors border-t border-gray-200 first:border-t-0"
                    onClick={() => {
                      window.location.href = `/indexes/private`;
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
                          window.location.href = `/indexes/private`;
                        }}
                      >
                        <Lock className="h-4 w-4 mr-2" />
                        Manage
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </TabsContent>
            
            {/* Shared With Me Content */}
            <TabsContent value="shared-with-me" className="p-0 mt-0 bg-white border-b-2 border-gray-800">
              <div className="py-8 text-center text-gray-500">
                No indexes shared with you yet
              </div>
            </TabsContent>
          </Tabs>
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
      <ShareSettingsModal 
        open={showShareSettingsModal} 
        onOpenChange={setShowShareSettingsModal}
        indexName={selectedIndex}
      />
    </ClientLayout>
  );
} 