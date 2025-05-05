"use client";

import { useState } from "react";
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
  ChevronDown
} from "lucide-react";
import { useIntent } from "@/contexts/IntentContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import Image from "next/image";
import CreateIntentModal from "@/components/modals/CreateIntentModal";
import CreateIndexModal from "@/components/modals/CreateIndexModal";
import ConfigureModal from "@/components/modals/ConfigureModal";

export default function MVPPage() {
  const [activeTab, setActiveTab] = useState("my-indexes");
  const [activeMenu, setActiveMenu] = useState("indexes");
  const { intents } = useIntent();
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [showIntentModal, setShowIntentModal] = useState(false);
  const [showIndexModal, setShowIndexModal] = useState(false);

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
        {/* Header with Logo and User Avatar */}
        <header className="w-full px-6 py-4 flex justify-between items-center ">
          <div className="flex items-center">
            <div className="relative mr-2">
              <img 
                src="/logo-black.svg" 
                alt="Index Protocol" 
                width={200} 
                className="object-contain"
              />
            </div>
          </div>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 hover:bg-gray-50 text-gray-700">
                <UserCircle className="h-6 w-6" />
                <span className="hidden sm:inline">Seref</span>
                <ChevronDown className="h-4 w-4 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 bg-white border border-gray-100 shadow-md rounded-md">
              <DropdownMenuItem className="cursor-pointer hover:bg-gray-50 flex items-center px-4 py-3">
                <UserCircle className="mr-2 h-5 w-5 text-gray-500" />
                <span>Profile</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-gray-100" />
              <DropdownMenuItem className="cursor-pointer text-red-600 hover:bg-red-50 flex items-center px-4 py-3">
                <LogOut className="mr-2 h-5 w-5" />
                <span>Logout</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

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
        <div className="flex-1   px-8">
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
                        <TabsTrigger value="requests" pending={5} className="font-ibm-plex">
                          Requests
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
                        <Button 
                          variant="outline" 
                          size="sm"
                          className="w-full sm:w-auto border-gray-400 text-gray-700 hover:bg-gray-100 hover:text-black"
                        >
                          Manage
                        </Button>
                      </div>
                      
                      {/* Index Item 2 */}
                      <div className="flex flex-wrap sm:flex-nowrap justify-between items-center py-4 px-3 sm:px-6 border-t border-gray-200">
                        <div className="w-full sm:w-auto mb-2 sm:mb-0">
                          <h3 className="font-bold text-lg text-gray-900 font-ibm-plex">Ambient discovery research</h3>
                          <p className="text-gray-500 text-sm">Updated May 4 • 10 members</p>
                        </div>
                        <Button 
                          variant="outline" 
                          size="sm"
                          className="w-full sm:w-auto border-gray-400 text-gray-700 hover:bg-gray-100 hover:text-black"
                        >
                          Manage
                        </Button>
                      </div>
                      
                     
                      
                      
                    </TabsContent>
                    
                    {/* Shared With Me Content */}
                    <TabsContent value="shared-with-me" className="p-0 mt-0 bg-white border-b-2 border-gray-800">
                      <div className="py-8 text-center text-gray-500">
                        No indexes shared with you yet
                      </div>
                    </TabsContent>
                    
                    {/* Requests Content */}
                    <TabsContent value="requests" className="p-0 mt-0 bg-white border-b-2 border-gray-800">
                      <div className="py-8 text-center text-gray-500">
                        Loading requests...
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
                      <div className="flex flex-wrap sm:flex-nowrap justify-between items-center py-4 px-3 sm:px-6">
                        <div className="w-full sm:w-auto mb-2 sm:mb-0">
                          <h3 className="font-bold text-lg text-gray-900 font-ibm-plex">Looking to meet early stage founders building privacy-preserving agent coordination infra.</h3>
                          <p className="text-gray-500 text-sm">Updated May 6 • 4 connections</p>
                        </div>
                        <Button 
                          variant="outline" 
                          size="sm"
                          className="w-full sm:w-auto border-gray-400 text-gray-700 hover:bg-gray-100 hover:text-black"
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
    </div>
  );
}
