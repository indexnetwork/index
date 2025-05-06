"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Eye, Share2, MoreVertical, Pencil, Trash } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import Header from "@/components/Header";
import CreateIndexModal from "@/components/modals/CreateIndexModal";
import ConfigureModal from "@/components/modals/ConfigureModal";
import ShareSettingsModal from "@/components/modals/ShareSettingsModal";

export default function IndexesPage() {
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [showIndexModal, setShowIndexModal] = useState(false);
  const [showShareSettingsModal, setShowShareSettingsModal] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState("");
  const [indexToRename, setIndexToRename] = useState("");

  const handleRenameIndex = (indexName: string) => {
    setIndexToRename(indexName);
    // TODO: Implement rename functionality
    console.log("Rename index:", indexName);
  };

  const handleRemoveIndex = (indexName: string) => {
    // TODO: Implement remove functionality
    console.log("Remove index:", indexName);
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
              <Tabs defaultValue="my-indexes" className="flex-grow">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between">
                  <TabsList className="w-full sm:w-auto border border-black border-b-0 bg-transparent p-0 overflow-x-auto">
                    <TabsTrigger value="my-indexes" className="font-ibm-plex">
                      My indexes
                    </TabsTrigger>
                    <TabsTrigger value="shared-with-me" className="font-ibm-plex">
                      Shared with me
                    </TabsTrigger>
                  </TabsList>
                  
                  {/* Action Buttons - directly next to tabs */}
                  <div className="flex gap-2 mb-2 sm:mt-0">
                    <Button 
                      className="flex items-center gap-2 bg-gray-800 hover:bg-black text-white rounded-[1px]"
                      onClick={() => setShowIndexModal(true)}
                    >
                      Create New Index
                    </Button>
                    <Button 
                      className="flex items-center gap-2 bg-gray-800 hover:bg-black text-white  rounded-[1px]"
                      onClick={() => setShowConfigDialog(true)}
                    >
                      Configure MCP
                    </Button>
                  </div>
                </div>
              
                {/* My Indexes Content */}
                <TabsContent value="my-indexes" className="p-0 mt-0 bg-white border-b-2 border-gray-800">
                  {/* Index Item 1 */}
                  <div 
                    className="flex flex-wrap sm:flex-nowrap justify-between items-center py-4 px-3 sm:px-6 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => {
                      window.location.href = `/mvp/indexes/index-dataroom`;
                    }}
                  >
                    <div className="w-full sm:w-auto mb-2 sm:mb-0">
                      <h3 className="font-bold text-lg text-gray-900 font-ibm-plex">Index dataroom</h3>
                      <p className="text-gray-500 text-sm">Updated May 4 • 3 members</p>
                    </div>
                    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                      <Button 
                        variant="outline" 
                        size="sm"
                        className="border-gray-400 text-gray-700 hover:bg-gray-100 rounded-[1px] hover:text-black"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedIndex("Index dataroom");
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
                            className="border-gray-400 text-gray-700 hover:bg-gray-100 rounded-[1px] hover:text-black"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-white border border-gray-200  rounded-[1px]">
                          <DropdownMenuItem 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRenameIndex("Index dataroom");
                            }} 
                            className="hover:bg-gray-50 cursor-pointer text-gray-700  rounded-[1px] focus:text-gray-900"
                          >
                            <Pencil className="h-4 w-4 mr-2" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-gray-100" />
                          <DropdownMenuItem 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveIndex("Index dataroom");
                            }}
                            className="text-red-600 hover:bg-red-50 hover:text-red-700 cursor-pointer  rounded-[1px] focus:text-red-700"
                          >
                            <Trash className="h-4 w-4 mr-2" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>

                  <div 
                    className="flex flex-wrap sm:flex-nowrap justify-between items-center py-4 px-3 sm:px-6 cursor-pointer border-t border-gray-200 hover:bg-gray-50 transition-colors"
                    onClick={() => {
                      window.location.href = `/mvp/indexes/index-dataroom`;
                    }}
                  >
                    <div className="w-full sm:w-auto mb-2 sm:mb-0">
                      <h3 className="font-bold text-lg text-gray-900 font-ibm-plex">Index dataroom</h3>
                      <p className="text-gray-500 text-sm">Updated May 4 • 3 members</p>
                    </div>
                    <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                      <Button 
                        variant="outline" 
                        size="sm"
                        className="border-gray-400 text-gray-700 hover:bg-gray-100 rounded-[1px] hover:text-black"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedIndex("Index dataroom");
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
                            className="border-gray-400 text-gray-700 hover:bg-gray-100  rounded-[1px] hover:text-black"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-white border border-gray-200  rounded-[1px] ">
                          <DropdownMenuItem 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRenameIndex("Index dataroom");
                            }} 
                            className="hover:bg-gray-50 cursor-pointer text-gray-700 focus:text-gray-900"
                          >
                            <Pencil className="h-4 w-4 mr-2" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-gray-100" />
                          <DropdownMenuItem 
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRemoveIndex("Index dataroom");
                            }}
                            className="text-red-600 hover:bg-red-50 hover:text-red-700 cursor-pointer focus:text-red-700"
                          >
                            <Trash className="h-4 w-4 mr-2" />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>                  

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
        </div>
      </div>

      {/* Modals */}
      <CreateIndexModal open={showIndexModal} onOpenChange={setShowIndexModal} />
      <ConfigureModal open={showConfigDialog} onOpenChange={setShowConfigDialog} />
      <ShareSettingsModal 
        open={showShareSettingsModal} 
        onOpenChange={setShowShareSettingsModal}
        indexName={selectedIndex}
      />
    </div>
  );
} 