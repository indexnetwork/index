"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Upload, Trash2, ArrowUpRight, Share2, ArrowLeft } from "lucide-react";
import ShareSettingsModal from "@/components/modals/ShareSettingsModal";
import ConfigureModal from "@/components/modals/ConfigureModal";
import { MCP } from '@lobehub/icons';
import Link from "next/link";
import { useIndexes, useIntents } from "@/contexts/APIContext";
import { Index } from "@/lib/types";
import ClientLayout from "@/components/ClientLayout";
import CreateIntentModal from "@/components/modals/CreateIntentModal";

interface IndexDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function IndexDetailPage({ params }: IndexDetailPageProps) {
  const router = useRouter();
  const resolvedParams = use(params);
  const [isDragging, setIsDragging] = useState(false);
  const [showShareSettingsModal, setShowShareSettingsModal] = useState(false);
  const [showCreateIntentModal, setShowCreateIntentModal] = useState(false);
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [selectedSuggestedIntent, setSelectedSuggestedIntent] = useState<{ payload: string; id: string } | null>(null);
  const [index, setIndex] = useState<Index | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploadingFiles, setUploadingFiles] = useState<Set<string>>(new Set());
  const [deletingFiles, setDeletingFiles] = useState<Set<string>>(new Set());
  const [addedIntents, setAddedIntents] = useState<Set<string>>(new Set());
  const [suggestedIntents, setSuggestedIntents] = useState<{ id: string; payload: string; confidence: number }[]>([]);
  const [loadingIntents, setLoadingIntents] = useState(false);
  const indexesService = useIndexes();
  const intentsService = useIntents();

  const fetchIndex = useCallback(async () => {
    try {
      const data = await indexesService.getIndex(resolvedParams.id);
      setIndex(data || null);
    } catch (error) {
      console.error('Error fetching index:', error);
    } finally {
      setLoading(false);
    }
  }, [resolvedParams.id, indexesService]);

  const fetchSuggestedIntents = useCallback(async () => {
    if (!index || !index.files || index.files.length === 0) {
      setSuggestedIntents([]);
      return;
    }

    setLoadingIntents(true);
    try {
      const intents = await indexesService.getSuggestedIntents(resolvedParams.id);
      const intentsWithIds = intents.map((intent, index) => ({
        id: `intent-${index}`,
        payload: intent.payload,
        confidence: intent.confidence
      }));
      setSuggestedIntents(intentsWithIds);
    } catch (error) {
      console.error('Error fetching suggested intents:', error);
      setSuggestedIntents([]);
    } finally {
      setLoadingIntents(false);
    }
  }, [resolvedParams.id, indexesService, index]);

  useEffect(() => {
    fetchIndex();
  }, [fetchIndex]);

  useEffect(() => {
    fetchSuggestedIntents();
  }, [fetchSuggestedIntents]);

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
        // Add files to uploading state
        const newUploadingFiles = new Set(uploadingFiles);
        droppedFiles.forEach(file => newUploadingFiles.add(file.name));
        setUploadingFiles(newUploadingFiles);

        for (const file of droppedFiles) {
          await indexesService.uploadFile(index.id, file);
        }
        // Refresh index data
        const updatedIndex = await indexesService.getIndex(resolvedParams.id);
        setIndex(updatedIndex || null);
      } catch (error) {
        console.error('Error uploading files:', error);
      } finally {
        // Clear uploading state
        setUploadingFiles(new Set());
      }
    }
  };

  const handleFileDelete = async (fileId: string) => {
    if (index) {
      try {
        setDeletingFiles(prev => new Set([...prev, fileId]));
        await indexesService.deleteFile(index.id, fileId);
        // Refresh index data
        const updatedIndex = await indexesService.getIndex(resolvedParams.id);
        setIndex(updatedIndex || null);
      } catch (error) {
        console.error('Error deleting file:', error);
      } finally {
        setDeletingFiles(prev => {
          const newSet = new Set(prev);
          newSet.delete(fileId);
          return newSet;
        });
      }
    }
  };

  const handleAddIntent = async (intentId: string) => {
    const suggestedIntent = suggestedIntents.find(intent => intent.id === intentId);
    if (suggestedIntent && index) {
      // Open modal immediately with initial payload
      setSelectedSuggestedIntent({
        payload: suggestedIntent.payload,
        id: intentId
      });
      setShowCreateIntentModal(true);
    }
  };

  const handleCreateIntent = async (intent: { payload: string; indexIds: string[]; attachments: File[]; isPublic: boolean }) => {
    try {
      const newIntent = await intentsService.createIntent({
        payload: intent.payload,
        indexIds: intent.indexIds,
        isPublic: intent.isPublic
      });
      // Update local state immediately
      setAddedIntents(prev => new Set([...prev, selectedSuggestedIntent?.id || '']));
      // Then refresh the index data
      const updatedIndex = await indexesService.getIndex(resolvedParams.id);
      setIndex(updatedIndex || null);
      setShowCreateIntentModal(false);
      setSelectedSuggestedIntent(null);
      // Redirect to the created intent
      router.push(`/intents/${newIntent.id}`);
    } catch (error) {
      console.error('Error creating intent:', error);
    }
  };

  if (loading) {
    return (
      <ClientLayout>
        <div className="py-8 text-center text-gray-500">Loading...</div>
      </ClientLayout>
    );
  }

  if (!index) {
    return (
      <ClientLayout>
        <div className="py-8 text-center text-gray-500">Index not found</div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      {/* Main Content */}
      <div className="w-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
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
        <div className="flex flex-col sm:flex-row py-4 px-2 sm:px-4 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 font-ibm-plex-mono mb-2">{index.title}</h1>
            <p className="text-sm text-gray-500 font-ibm-plex-mono">Created {new Date(index.createdAt).toLocaleDateString()}</p>
          </div>
          <div className="flex gap-2 mt-4 sm:mt-0 flex-wrap sm:flex-nowrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowShareSettingsModal(true)}
              className="flex items-center gap-2"
            >
              <Share2 className="h-4 w-4" />
              Share
            </Button>
            <Button 
              variant="outline"
              size="sm"
              className="flex items-center gap-2"
              onClick={() => setShowConfigDialog(true)}
            >
              <MCP className="h-4 w-4" />
              <span className="hidden sm:inline">Configure MCP</span>
            </Button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
          <div className="space-y-3 w-full">
            <div className="flex justify-between items-center">
              <h2 className="text-xl mt-2 font-semibold text-gray-900">Files</h2>
            </div>
            
            <div className="space-y-2 flex-1">
                {/* Merge uploaded files and uploading files into a single list */}
                {(() => {
                  const uploadedFiles = (index.files || []).map(file => ({ ...file, isUploading: false }));
                  const uploadingFilesList = Array.from(uploadingFiles).map(fileName => ({
                    id: `uploading-${fileName}`,
                    name: fileName,
                    size: '',
                    createdAt: new Date().toISOString(),
                    isUploading: true
                  }));
                  
                  // Combine and sort: uploading files first (newest first), then uploaded files
                  const allFiles = [...uploadingFilesList, ...uploadedFiles];
                  
                  return allFiles.map((file) => (
                    <div
                      key={file.id}
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
                        <p className={`text-sm ${file.isUploading ? 'text-gray-400' : 'text-gray-500'}`}>
                          {file.isUploading ? 'Uploading...' : `${file.size} • ${new Date(file.createdAt).toLocaleDateString()}`}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={file.isUploading ? "text-gray-400" : "text-red-500 hover:text-red-700"}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!file.isUploading) {
                            handleFileDelete(file.id);
                          }
                        }}
                        disabled={file.isUploading || (deletingFiles.has(file.id))}
                      >
                        {file.isUploading || deletingFiles.has(file.id) ? (
                          <div className={`h-4 w-4 border-2 ${file.isUploading ? 'border-gray-400' : 'border-red-500'} border-t-transparent rounded-full animate-spin`} />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ));
                })()}
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
                    // Add files to uploading state
                    const newUploadingFiles = new Set(uploadingFiles);
                    files.forEach(file => newUploadingFiles.add(file.name));
                    setUploadingFiles(newUploadingFiles);

                    Promise.all(files.map(file => indexesService.uploadFile(index.id, file)))
                      .then(() => indexesService.getIndex(resolvedParams.id))
                      .then(updatedIndex => setIndex(updatedIndex || null))
                      .catch(error => console.error('Error uploading files:', error))
                      .finally(() => {
                        // Clear uploading state
                        setUploadingFiles(new Set());
                      });
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

        { index.files && index.files.length > 0 && 
        <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
          <div className="space-y-6 w-full">
            <div className="flex justify-between items-center">
              <h2 className="text-xl mt-2 font-semibold text-gray-900">Suggested Intents</h2>
            </div>
            
            <div className="space-y-4 flex-1">
              {loadingIntents ? (
                <div className="text-center py-4 text-gray-500">Loading suggested intents...</div>
              ) : suggestedIntents.length > 0 ? (
                suggestedIntents.map((intent) => (
                  <div key={intent.id} className="flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-md font-ibm-plex-mono font-medium text-gray-900">{intent.payload}</h4>
                      </div>
                    </div>
                    <Button
                      variant={addedIntents.has(intent.id) ? "default" : "outline"}
                      size="sm"
                      className="ml-4"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleAddIntent(intent.id);
                      }}
                    >
                      {addedIntents.has(intent.id) ? "View" : "Add"}
                    </Button>
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-gray-500">No suggested intents available</div>
              )}
            </div>
          </div>
        </div> }

      </div>

      {/* Modals */}
      <ShareSettingsModal
        open={showShareSettingsModal}
        onOpenChange={setShowShareSettingsModal}
        index={index}
        onIndexUpdate={(updatedIndex) => setIndex(updatedIndex)}
      />
      <CreateIntentModal 
        open={showCreateIntentModal}
        onOpenChange={setShowCreateIntentModal}
        onSubmit={handleCreateIntent}
        initialPayload={selectedSuggestedIntent?.payload || ''}
        indexId={index?.id}
      />
      <ConfigureModal 
        open={showConfigDialog}
        onOpenChange={setShowConfigDialog}
      />
    </ClientLayout>
  );
} 