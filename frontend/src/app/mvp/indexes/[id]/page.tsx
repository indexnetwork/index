"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, Trash2, ArrowUpRight, Share2, ArrowLeft } from "lucide-react";
import Header from "@/components/Header";
import ShareSettingsModal from "@/components/modals/ShareSettingsModal";
import Link from "next/link";

interface IndexDetailPageProps {
  params: {
    id: string;
  };
}

export default function IndexDetailPage({ params }: IndexDetailPageProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [showShareSettingsModal, setShowShareSettingsModal] = useState(false);

  // Mock data - replace with real data fetching
  const indexName = "Index dataroom";
  const files = [
    { name: "document1.pdf", size: "2.4 MB", date: "2024-03-20" },
    { name: "research.docx", size: "1.1 MB", date: "2024-03-19" },
    { name: "data.csv", size: "4.2 MB", date: "2024-03-18" },
    { name: "presentation.pptx", size: "5.6 MB", date: "2024-03-17" },
    { name: "notes.txt", size: "0.3 MB", date: "2024-03-16" },
  ];

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    console.log('Dropped files:', droppedFiles);
    // Handle file upload logic here
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
      <div className="flex flex-col min-h-screen">
        <Header />

        {/* Main Content */}
        <div className="flex-1 px-2 sm:px-2 md:px-32">
          <div className="space-y-6 h-full">
            {/* Header Box */}
            <div className="w-full h-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
              backgroundImage: 'url(https://www.trychroma.com/pricing/grid.png)',
              backgroundColor: 'white',
              backgroundSize: '888px'
            }}>
              

        <div className="bg-white px-4 pt-1.5 pb-1 border border-black  border border-b-0 inline-block">
          <Link href="/mvp/indexes" className="inline-flex items-center text-gray-600 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4 mr-2" />
            <span className="font-ibm-plex text-[14px] text-black font-medium">Back to indexes</span>
          </Link>
        </div>
              <div className="flex flex-col sm:flex-row py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 font-ibm-plex mb-2">{indexName}</h1>
                  <p className="text-gray-500">Created March 15, 2024 • 3 members</p>
                </div>
                <div className="flex gap-2 mt-4 sm:mt-0">
                  <Button
                    variant="outline"
                    className="border-gray-400 text-gray-700 hover:bg-gray-100 rounded-[1px] hover:text-black"
                    onClick={() => setShowShareSettingsModal(true)}
                  >
                    <Share2 className="h-4 w-4 mr-2" />
                    Share
                  </Button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
              <div className="space-y-6 w-full">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl mt-2 font-semibold text-gray-900">Files</h2>
                </div>
                
                <div className="space-y-4 flex-1">
                    {files.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-4 bg-gray-50  hover:bg-gray-100 transition-colors"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className="text-lg font-medium text-gray-900">{file.name}</h4>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="p-0 hover:bg-transparent text-gray-500 hover:text-gray-900"
                            >
                              <ArrowUpRight className="h-4 w-4" />
                            </Button>
                          </div>
                          <p className="text-sm text-gray-500">
                            {file.size} • {file.date}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>

                {/* Upload Section */}
                <div 
                  className={`mt-4 border-2 border-dashed  p-6 flex flex-col items-center justify-center transition-colors cursor-pointer ${
                    isDragging 
                      ? "border-gray-400 bg-gray-100" 
                      : "border-gray-200 bg-gray-50 hover:bg-gray-100"
                  }`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <input
                    type="file"
                    className="hidden"
                    id="file-upload"
                    multiple
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      console.log('Selected files:', files);
                      // Handle file upload logic here
                    }}
                  />
                  <label
                    htmlFor="file-upload"
                    className="flex flex-col items-center cursor-pointer w-full"
                  >
                    <Upload className={`h-6 w-6 mb-2 ${isDragging ? 'text-gray-600' : 'text-gray-400'}`} />
                    <p className="text-sm font-medium text-gray-900">Upload Files</p>
                    <p className="text-xs text-gray-500 mt-1">Drag and drop your files here or click to browse</p>
                  </label>
                </div>
              </div>
            </div>

          </div>

           
          </div>
        </div>
      </div>

      {/* Modals */}
      <ShareSettingsModal 
        open={showShareSettingsModal} 
        onOpenChange={setShowShareSettingsModal}
        indexName={indexName}
      />
    </div>
  );
} 