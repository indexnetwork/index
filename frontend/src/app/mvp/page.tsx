"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { 
  Upload, 
  ArrowUpRight, 
  FileText, 
  Clock, 
  UserCircle, 
  Eye,
  FolderOpen,
  Rocket,
  LogOut,
  ChevronDown,
  Share2,
  MoreVertical,
  Pencil,
  Trash
} from "lucide-react";
import { useIntent } from "@/contexts/IntentContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import Image from "next/image";
import CreateIntentModal from "@/components/modals/CreateIntentModal";
import CreateIndexModal from "@/components/modals/CreateIndexModal";
import ConfigureModal from "@/components/modals/ConfigureModal";
import IndexDetailModal from "@/components/modals/IndexDetailModal";
import ShareSettingsModal from "@/components/modals/ShareSettingsModal";
import Header from "@/components/Header";

export default function MVPPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("my-indexes");
  const [activeMenu, setActiveMenu] = useState("indexes");
  const { intents } = useIntent();
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [showIntentModal, setShowIntentModal] = useState(false);
  const [showIndexModal, setShowIndexModal] = useState(false);
  const [showIndexDetailModal, setShowIndexDetailModal] = useState(false);
  const [showShareSettingsModal, setShowShareSettingsModal] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState("");
  const [indexToRename, setIndexToRename] = useState("");

  const mcpServerConfig = {
    "mcpServers": {
      "github": {
        "command": "docker",
        "args": [
          "run",
          "-i",
          "--rm",
          "-e",
          "GITHUB_PERSONAL_ACCESS_TOKEN",
          "mcp/github"
        ],
        "env": {
          "GITHUB_PERSONAL_ACCESS_TOKEN": "<YOUR_TOKEN>"
        }
      }
    }
  };

  const handleRenameIndex = (indexName: string) => {
    setIndexToRename(indexName);
    // TODO: Implement rename functionality
    console.log("Rename index:", indexName);
  };

  const handleRemoveIndex = (indexName: string) => {
    // TODO: Implement remove functionality
    console.log("Remove index:", indexName);
  };

  const handleIntentClick = (intentId: string) => {
    router.push(`/mvp/intents/${intentId}`);
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

        {/* Top Navigation Menu */}
        <div className="w-full flex justify-center my-6">
          <div className="flex gap-8">
            {/* Indexes Menu Item */}
            <div 
              className={`flex flex-col items-center cursor-pointer`}
              onClick={() => setActiveMenu("indexes")}
            >
              <div className="w-18 h-18 flex items-center justify-center">
                <img 
                  src="/icon-folder.svg" 
                  width={48} 
                  className="object-contain p-1"
                  style={{filter: activeMenu === "indexes" ? "invert(70%) sepia(40%) saturate(1000%) hue-rotate(360deg) brightness(100%)" : "invert(50%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(90%)"}}
                />
              </div>
              <span className={`text-sm font-ibm-plex ${activeMenu === "indexes" ? "text-amber-500 font-medium" : "text-gray-500"}`}>
                Indexes
              </span>
            </div>
            
            {/* Intents Menu Item */}
            <div 
              className={`flex flex-col items-center cursor-pointer`}
              onClick={() => setActiveMenu("intents")}
            >
              <div className="w-18 h-18 flex items-center justify-center">
                <img 
                  src="/icon-intent.svg" 
                  width={48} 
                  className="object-contain p-1"
                  style={{filter: activeMenu === "intents" ? "invert(70%) sepia(40%) saturate(1000%) hue-rotate(360deg) brightness(100%)" : "invert(50%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(90%)"}}
                />
              </div>
              <span className={`text-sm font-ibm-plex ${activeMenu === "intents" ? "text-amber-500 font-medium" : "text-gray-500"}`}>
                Intents
              </span>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 px-2 sm:px-2 md:px-32">
          {/* MCP Server Config Dialog */}
          <Dialog open={showConfigDialog} onOpenChange={setShowConfigDialog}>
            <DialogContent className="max-w-lg mx-auto">
              <DialogHeader>
                <DialogTitle className="text-xl font-bold text-gray-900 font-ibm-plex">MCP Server Configuration</DialogTitle>
                <DialogDescription>
                  Use this configuration to set up your Model Context Protocol server.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-6">
                <div className="bg-gray-50 p-4 rounded-md overflow-auto border border-gray-200">
                  <pre className="text-sm text-gray-900 whitespace-pre-wrap">
                    {JSON.stringify(mcpServerConfig, null, 2)}
                  </pre>
                </div>
                <div className="flex justify-end space-x-3">
                  <Button
                    variant="outline"
                    onClick={() => setShowConfigDialog(false)}
                    className="font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Close
                  </Button>
                  <Button
                    className="font-medium bg-gray-800 hover:bg-black text-white"
                    onClick={() => {
                      // Add copy to clipboard functionality
                      navigator.clipboard.writeText(JSON.stringify(mcpServerConfig, null, 2));
                    }}
                  >
                    Copy Configuration
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {activeMenu === "indexes" && (
            <>
              {/* Main Tabs */}
              <div className="w-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
                  backgroundImage: 'url(https://www.trychroma.com/pricing/grid.png)',
                  backgroundColor: 'white',
                  backgroundSize: '888px'
                }}>
                <div className="flex flex-col sm:flex-row sm:items-end justify-between mb-4">
                  <Tabs defaultValue="my-indexes" className="flex-grow">
                    <div className="flex flex-col sm:flex-row sm:items-end justify-between">
                      <TabsList className="w-full sm:w-auto  border border-black border-b-0 bg-transparent p-0 overflow-x-auto">
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
                          className="flex items-center gap-2 bg-gray-800 hover:bg-black text-white"
                          onClick={() => setShowIndexModal(true)}
                        >
                          <ArrowUpRight className="h-4 w-4" />
                          Create New Index
                        </Button>
                        <Button 
                          className="flex items-center gap-2 bg-gray-800 hover:bg-black text-white"
                          onClick={() => setShowConfigDialog(true)}
                        >
                          <Upload className="h-4 w-4" />
                          Configure MCP
                        </Button>
                      </div>
                    </div>
                  
                    {/* My Indexes Content */}
                    <TabsContent value="my-indexes" className="p-0 mt-0 bg-white border-b-2 border-gray-800">
                      {/* Index Item 1 */}
                      <div className="flex flex-wrap sm:flex-nowrap justify-between items-center py-4 px-3 sm:px-6">
                        <div className="w-full sm:w-auto mb-2 sm:mb-0">
                          <h3 className="font-bold text-lg text-gray-900 font-ibm-plex">Index dataroom</h3>
                          <p className="text-gray-500 text-sm">Updated May 4 • 3 members</p>
                        </div>
                        <div className="flex gap-2">
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="border-gray-400 text-gray-700 hover:bg-gray-100 hover:text-black"
                            onClick={() => {
                              setSelectedIndex("Index dataroom");
                              setShowIndexDetailModal(true);
                            }}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="border-gray-400 text-gray-700 hover:bg-gray-100 hover:text-black"
                            onClick={() => {
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
                                className="border-gray-400 text-gray-700 hover:bg-gray-100 hover:text-black"
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="bg-white border border-gray-200 shadow-md rounded-lg">
                              <DropdownMenuItem onClick={() => handleRenameIndex("Index dataroom")} className="hover:bg-gray-50 cursor-pointer text-gray-700 focus:text-gray-900">
                                <Pencil className="h-4 w-4 mr-2" />
                                Rename
                              </DropdownMenuItem>
                              <DropdownMenuSeparator className="bg-gray-200" />
                              <DropdownMenuItem 
                                onClick={() => handleRemoveIndex("Index dataroom")}
                                className="text-red-600 hover:bg-red-50 hover:text-red-700 cursor-pointer focus:text-red-700"
                              >
                                <Trash className="h-4 w-4 mr-2" />
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      
                      {/* Index Item 2 */}
                      <div className="flex flex-wrap sm:flex-nowrap justify-between items-center py-4 px-3 sm:px-6 border-t border-gray-200">
                        <div className="w-full sm:w-auto mb-2 sm:mb-0">
                          <h3 className="font-bold text-lg text-gray-900 font-ibm-plex">Ambient discovery research</h3>
                          <p className="text-gray-500 text-sm">Updated May 4 • 10 members</p>
                        </div>
                        <div className="flex gap-2">
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="border-gray-400 text-gray-700 hover:bg-gray-100 hover:text-black"
                            onClick={() => {
                              setSelectedIndex("Ambient discovery research");
                              setShowIndexDetailModal(true);
                            }}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            View
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm"
                            className="border-gray-400 text-gray-700 hover:bg-gray-100 hover:text-black"
                            onClick={() => {
                              setSelectedIndex("Ambient discovery research");
                              setShowShareSettingsModal(true);
                            }}
                          >
                            <Share2 className="h-4 w-4 mr-2" />
                            Share
                          </Button>
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
            </>
          )}

          {activeMenu === "intents" && (
            <>
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
                        <TabsTrigger value="my-intents" className="font-ibm-plex">
                          Active
                        </TabsTrigger>
                        <TabsTrigger value="shared-with-me" className="font-ibm-plex">
                          Archived
                        </TabsTrigger>
                      </TabsList>
                      
                      {/* Action Buttons - directly next to tabs */}
                      <div className="flex gap-2 mb-2 sm:mt-0">
                        <Button 
                          className="flex items-center gap-2 bg-gray-800 hover:bg-black text-white"
                          onClick={() => setShowIntentModal(true)}
                        >
                          <ArrowUpRight className="h-4 w-4" />
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
                          className="w-full sm:w-auto border-gray-400 text-gray-700 hover:bg-gray-100 hover:text-black"
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
                          className="w-full sm:w-auto border-gray-400 text-gray-700 hover:bg-gray-100 hover:text-black"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Add manage functionality here
                          }}
                        >
                          Manage
                        </Button>
                      </div>
                    </TabsContent>
                    
                    {/* Shared With Me Content */}
                    <TabsContent value="shared-with-me" className="p-0 mt-0 bg-white border-b-2 border-gray-800">
                      <div className="py-8 text-center text-gray-500">
                        No intents shared with you yet
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
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      <CreateIntentModal open={showIntentModal} onOpenChange={setShowIntentModal} />
      <CreateIndexModal open={showIndexModal} onOpenChange={setShowIndexModal} />
      <ConfigureModal open={showConfigDialog} onOpenChange={setShowConfigDialog} />
      <IndexDetailModal 
        open={showIndexDetailModal} 
        onOpenChange={setShowIndexDetailModal}
        indexName={selectedIndex}
      />
      <ShareSettingsModal 
        open={showShareSettingsModal} 
        onOpenChange={setShowShareSettingsModal}
        indexName={selectedIndex}
      />
    </div>
  );
}
