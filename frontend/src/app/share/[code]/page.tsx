"use client";

import { useState, useEffect, use, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Upload, ArrowUpRight } from "lucide-react";
import { Index, APIResponse } from "@/lib/types";
import Image from "next/image";
import ClientLayout from "@/components/ClientLayout";

interface SharePageProps {
  params: Promise<{
    code: string;
  }>;
}

export default function SharePage({ params }: SharePageProps) {
  const resolvedParams = use(params);
  const [isDragging, setIsDragging] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [index, setIndex] = useState<Index | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIndex = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Make unauthenticated request to the share endpoint
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/indexes/share/${resolvedParams.code}`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data: APIResponse<Index> = await response.json();
      
      if (!data.index) {
        throw new Error('Index not found');
      }
      
      setIndex(data.index);
    } catch (error: unknown) {
      console.error('Error fetching index:', error);
      setError(error instanceof Error ? error.message : 'Index not found or access denied');
      setIndex(null);
    } finally {
      setLoading(false);
    }
  }, [resolvedParams.code]);

  useEffect(() => {
    fetchIndex();
  }, [fetchIndex]);

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
        // For now, disable file uploads on share pages
        // In the future, this could upload files based on share permissions
        console.log('File upload not available on share pages yet');
      } catch (error) {
        console.error('Error uploading files:', error);
      }
    }
  };

  const handleRequestConnection = async () => {
    if (index) {
      try {
        // Call service in the future.
        setRequestSent(true);
      } catch (error) {
        console.error('Error requesting connection:', error);
      }
    }
  };

  if (loading) {
    return (
      <ClientLayout showNavigation={false}>
        <div className="py-8 text-center text-gray-500">Loading...</div>
      </ClientLayout>
    );
  }

  if (error) {
    return (
      <ClientLayout showNavigation={false}>
        <div className="py-8 text-center text-gray-500">
          <h2 className="text-xl font-bold mb-2">Access Denied</h2>
          <p>{error}</p>
        </div>
      </ClientLayout>
    );
  }

  if (!index) {
    return (
      <ClientLayout showNavigation={false}>
        <div className="py-8 text-center text-gray-500">Index not found</div>
      </ClientLayout>
    );
  }

  // Check permissions
  const canViewFiles = index.linkPermissions?.permissions.includes('can-view-files') || false;
  const canMatch = index.linkPermissions?.permissions.includes('can-match') || false;

  return (
    <ClientLayout showNavigation={false}>
      <div className="w-full h-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
        backgroundImage: 'url(/grid.png)',
        backgroundColor: 'white',
        backgroundSize: '888px'
      }}>
        <div className="border border-black border-b-0 border-b-2 bg-white  py-4 px-3 sm:px-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 font-ibm-plex-mono mb-1">{index.title}</h1>
              <p className="text-sm text-gray-500 font-ibm-plex-mono">Created {new Date(index.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
        </div>

        {canViewFiles && (
          <div className="flex flex-col sm:flex-col flex-1 mt-4 py-6 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
            <div className="space-y-3 w-full">
              <div className="flex justify-between items-center">
                <h2 className="text-xl mt-2 font-semibold text-gray-900">Files</h2>
              </div>
              <div className="space-y-2 flex-1">
                {index.files?.map((file, fileIndex) => (
                  <div
                    key={fileIndex}
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
                        {file.size} bytes • {new Date(file.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {canMatch && (
          <div className="flex flex-col sm:flex-col flex-1 mt-4 py-6 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
            <div className="w-full">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Drop your files to see how we vibe together.</h3>
              <div className="mt-4 p-4 bg-white border border-gray-200 rounded-lg">
                <div className="flex items-start space-x-4">
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-700 mb-2">Your content will be evaluated by</h3>
                    <p className="text-sm text-gray-500 mb-4">
                      Each agent will analyze your content from their specialized perspective. Once uploaded, you&apos;ll receive a detailed breakdown of how your content aligns with our network&apos;s goals and potential collaboration opportunities.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                        <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
                          <Image src="/avatars/agents/privado.svg" alt="ProofLayer" width={16} height={16} />
                        </div>
                        <span className="font-medium text-gray-900">ProofLayer</span>
                        <span className="text-gray-500 text-sm">Due Diligence Agent</span>
                      </div>

                      <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                        <div className="w-6 h-6 bg-purple-100 rounded-lg flex items-center justify-center">
                          <Image src="/avatars/agents/reputex.svg" alt="Threshold" width={16} height={16} />
                        </div>
                        <span className="font-medium text-gray-900">Threshold</span>
                        <span className="text-gray-500 text-sm">Network Manager Agent</span>
                      </div>

                      <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                        <div className="w-6 h-6 bg-indigo-100 rounded-lg flex items-center justify-center">
                          <Image src="/avatars/agents/hapi.svg" alt="Aspecta" width={16} height={16} />
                        </div>
                        <span className="font-medium text-gray-900">Aspecta</span>
                        <span className="text-gray-500 text-sm">Reputation Agent</span>
                      </div>

                      <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                        <div className="w-6 h-6 bg-teal-100 rounded-lg flex items-center justify-center">
                          <Image src="/avatars/agents/trusta.svg" alt="Semantic Relevancy" width={16} height={16} />
                        </div>
                        <span className="font-medium text-gray-900">Semantic Relevancy</span>
                        <span className="text-gray-500 text-sm">Relevancy Agent</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

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
                <Upload className="h-8 w-8 text-gray-400 mb-2" />
                <p className="text-sm text-gray-600 text-center">
                  Drag & drop your files here, or click to browse
                </p>
              </div>

              <div className="mt-6">
                {!requestSent ? (
                  <Button
                    onClick={handleRequestConnection}
                    className="w-full py-3 text-white bg-blue-600 hover:bg-blue-700 border border-blue-600"
                  >
                    Request Connection
                  </Button>
                ) : (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-center">
                    <p className="text-green-700 font-medium">Connection request sent!</p>
                    <p className="text-green-600 text-sm mt-1">We'll be in touch soon to discuss collaboration opportunities.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {!canViewFiles && !canMatch && (
          <div className="flex flex-col sm:flex-col flex-1 mt-4 py-6 px-3 sm:px-6 justify-center items-center border border-black border-b-0 border-b-2 bg-white">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Limited Access</h3>
              <p className="text-gray-600">You have limited access to this index.</p>
            </div>
          </div>
        )}
      </div>
    </ClientLayout>
  );
} 