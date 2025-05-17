"use client";

import { useState, useEffect, use } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, Trash2, ArrowUpRight, Share2, ArrowLeft } from "lucide-react";
import Header from "@/components/Header";
import ShareSettingsModal from "@/components/modals/ShareSettingsModal";
import Link from "next/link";
import { indexesService, Index } from "@/services/indexes";

interface IndexDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function IndexDetailPage({ params }: IndexDetailPageProps) {
  const resolvedParams = use(params);
  const [isDragging, setIsDragging] = useState(false);
  const [showShareSettingsModal, setShowShareSettingsModal] = useState(false);
  const [index, setIndex] = useState<Index | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchIndex = async () => {
      try {
        const data = await indexesService.getIndex(resolvedParams.id);
        setIndex(data || null);
      } catch (error) {
        console.error('Error fetching index:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchIndex();
  }, [resolvedParams.id]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (index && droppedFiles.length > 0) {
      try {
        for (const file of droppedFiles) {
          await indexesService.uploadFile(index.id, file);
        }
        // Refresh index data
        const updatedIndex = await indexesService.getIndex(resolvedParams.id);
        setIndex(updatedIndex || null);
      } catch (error) {
        console.error('Error uploading files:', error);
      }
    }
  };

  const handleFileDelete = async (fileName: string) => {
    if (index) {
      try {
        await indexesService.deleteFile(index.id, fileName);
        // Refresh index data
        const updatedIndex = await indexesService.getIndex(resolvedParams.id);
        setIndex(updatedIndex || null);
      } catch (error) {
        console.error('Error deleting file:', error);
      }
    }
  };

  const handleAddIntent = async (intentId: string) => {
    if (index) {
      try {
        await indexesService.addSuggestedIntent(index.id, intentId);
        // Refresh index data
        const updatedIndex = await indexesService.getIndex(resolvedParams.id);
        setIndex(updatedIndex || null);
      } catch (error) {
        console.error('Error adding intent:', error);
      }
    }
  };

  if (loading) {
    return (
      <div className="backdrop relative">
        <Header />
        <div className="flex-1 px-2 sm:px-2 md:px-32">
          <div className="py-8 text-center text-gray-500">Loading...</div>
        </div>
      </div>
    );
  }

  if (!index) {
    return (
      <div className="backdrop relative">
        <Header />
        <div className="flex-1 px-2 sm:px-2 md:px-32">
          <div className="py-8 text-center text-gray-500">Index not found</div>
        </div>
      </div>
    );
  }

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
          <Link href="/indexes" className="inline-flex items-center text-gray-600 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4 mr-2" />
            <span className="font-ibm-plex-mono text-[14px] text-black font-medium">Back to indexes</span>
          </Link>
        </div>
              <div className="flex flex-col sm:flex-row py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 font-ibm-plex-mono mb-2">{index.name}</h1>
                  <p className="text-sm text-gray-500 font-ibm-plex-mono">Created {index.createdAt}</p>
                </div>
                <div className="flex gap-2 mt-4 sm:mt-0">
                  <Button
                    variant="outline"
                    onClick={() => setShowShareSettingsModal(true)}
                  >
                    <Share2 className="h-4 w-4 mr-2" />
                    Share
                  </Button>
                </div>
              </div>

              <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
              <div className="space-y-3 w-full">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl mt-2 font-semibold text-gray-900">Files</h2>
                </div>
                
                <div className="space-y-2 flex-1">
                    {index.files.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between px-4 py-1 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            
                            <Button
                              variant="ghost"
                              className="p-0"
                              size="lg"
                            >
                              <h4 className="text-lg font-medium font-ibm-plex-mono text-gray-900 cursor-pointer">{file.name}</h4>
                              <ArrowUpRight className="ml-1 h-4 w-4" />
                            </Button>
                          </div>
                          <p className="text-sm text-gray-500">
                            {file.size} • {file.date}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700 "
                          onClick={() => handleFileDelete(file.name)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>

                {/* Upload Section */}
                <div 
                  className={`mt-4 border-2 border-dashed p-6 flex flex-col items-center justify-center transition-colors cursor-pointer ${
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
                      if (index && files.length > 0) {
                        Promise.all(files.map(file => indexesService.uploadFile(index.id, file)))
                          .then(() => indexesService.getIndex(resolvedParams.id))
                          .then(updatedIndex => setIndex(updatedIndex || null))
                          .catch(error => console.error('Error uploading files:', error));
                      }
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

            {/* Suggested Intents Section */}
            <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
              <div className="space-y-6 w-full">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl mt-2 font-semibold text-gray-900">Suggested Intents</h2>
                </div>
                
                <div className="space-y-4 flex-1">
                  {index.suggestedIntents.map((intent) => (
                    <div key={intent.id} className="flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-md font-ibm-plex-mono font-medium text-gray-900">{intent.title}</h4>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleAddIntent(intent.id)}
                      >
                        Add
                      </Button>
                    </div>
                  ))}
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
        indexName={index.name}
      />
    </div>
  );
} 