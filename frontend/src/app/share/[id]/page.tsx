"use client";

import { useState, useEffect, use } from "react";
import { Button } from "@/components/ui/button";
import { Upload, ArrowLeft, ArrowUpRight } from "lucide-react";
import Header from "@/components/Header";
import Link from "next/link";
import { indexesService, Index } from "@/services/indexes";
import Image from "next/image";

interface SharePageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function SharePage({ params }: SharePageProps) {
  const resolvedParams = use(params);
  const [isDragging, setIsDragging] = useState(false);
  const [index, setIndex] = useState<Index | null>(null);
  const [loading, setLoading] = useState(true);
  const [requestSent, setRequestSent] = useState(false);

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

  const handleRequestConnection = async () => {
    if (index) {
      try {
        await indexesService.requestConnection(index.id);
        setRequestSent(true);
      } catch (error) {
        console.error('Error requesting connection:', error);
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
        <Header showNavigation={false}  />

        <div className="pt-16 flex-1 px-2 sm:px-2 md:px-32">
          <div className="space-y-6 h-full">
            <div className="w-full h-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
              backgroundImage: 'url(https://www.trychroma.com/pricing/grid.png)',
              backgroundColor: 'white',
              backgroundSize: '888px'
            }}>
              <div className=" border border-black border-b-0 border-b-2 bg-white  py-4 px-3 sm:px-6">

                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                    <div>
                    <h1 className="text-2xl font-bold text-gray-900 font-ibm-plex-mono mb-1">{index.name}</h1>
                    <p className="text-sm text-gray-500 font-ibm-plex-mono">Created {index.createdAt}</p>
                    
                    </div>

                </div>
                
              </div>



              <div className="flex flex-col sm:flex-col flex-1 mt-4 py-6 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
                <div className="space-y-6 w-full">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl mt-2 font-semibold text-gray-900">Files</h2>
                </div>
                <div className="space-y-4 flex-1">
                {index.files.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
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
                      </div>
                    ))}
                    </div>

                </div>
              </div>
              <div className="flex flex-col sm:flex-col flex-1 mt-4 py-6 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
                <div className="w-full">

                  { /* Alignment block start */}  
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">Drop your files to see our alignment</h3>
                  <div className="mt-4 p-4 bg-white border border-gray-200 rounded-lg">
                    <div className="flex items-start space-x-4">
                      <div className="flex-1">
                        <h3 className="font-medium text-gray-700 mb-2">Your content will be evaluated by</h3>
                        <p className="text-sm text-gray-500 mb-4">
                          Each agent will analyze your content from their specialized perspective. Once uploaded, you'll receive a detailed breakdown of how your content aligns with our network's goals and potential collaboration opportunities.
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
                  { /* Alignment block end  */}  
                  
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
                      <p className="text-xs text-gray-500 mt-1">Get instant insights on how your content matches our strategic goals and potential collaboration opportunities</p>
                    </label>
                  </div>

                  

                  {true &&
                  <div className="mt-8 border-t pt-8">
                    <div className="flex items-start justify-between mb-6">
                      <div className="flex items-center gap-4">
                        <img
                          src={index.avatar || "https://www.trychroma.com/img/noise.jpg"}
                          alt={index.name}
                          width={48}
                          height={48}
                          className="rounded-full"
                        />
                        <div>
                          <h2 className="text-lg font-medium text-gray-900">{index.name}</h2>
                          <p className="text-sm text-gray-600">{index.role || "Organization"}</p>
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <Button 
                          onClick={handleRequestConnection}
                          disabled={requestSent}
                        >
                          {requestSent ? "Request Sent" : "Request Connection"}
                        </Button>
                        <Button variant="outline">
                          Decline
                        </Button>
                      </div>
                    </div>

                    <div className="mb-6 border-b border-gray-200 pb-6">
                      <h3 className="font-medium text-gray-700 mb-3">Why this connection matters</h3>
                      <p className="text-gray-700">
                        We both share a strong focus on advancing privacy-preserving AI technologies, suggesting a natural alignment in values and vision. Notably, your research has been cited in Arya's work, which highlights an already established intellectual connection and mutual recognition within the academic and technical communities. This foundation could serve as a meaningful basis for further collaboration or shared exploration.
                      </p>
                    </div>

                    <h4 className="text-lg font-semibold text-gray-900 mb-4">Who's backing this connection</h4>
                    <div className="flex flex-wrap gap-2">
                      <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                        <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
                          <span className="text-blue-600 font-semibold">PL</span>
                        </div>
                        <span className="font-medium text-gray-900">ProofLayer</span>
                        <span className="text-gray-500 text-sm">Due Diligence Agent</span>
                        <span className="text-gray-400 text-xs">(95%)</span>
                      </div>

                      <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                        <div className="w-6 h-6 bg-purple-100 rounded-lg flex items-center justify-center">
                          <span className="text-purple-600 font-semibold">TH</span>
                        </div>
                        <span className="font-medium text-gray-900">Threshold</span>
                        <span className="text-gray-500 text-sm">Network Manager Agent</span>
                        <span className="text-gray-400 text-xs">(88%)</span>
                      </div>

                      <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                        <div className="w-6 h-6 bg-indigo-100 rounded-lg flex items-center justify-center">
                          <span className="text-indigo-600 font-semibold">AS</span>
                        </div>
                        <span className="font-medium text-gray-900">Aspecta</span>
                        <span className="text-gray-500 text-sm">Reputation Agent</span>
                        <span className="text-gray-400 text-xs">(92%)</span>
                      </div>

                      <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                        <div className="w-6 h-6 bg-teal-100 rounded-lg flex items-center justify-center">
                          <span className="text-teal-600 font-semibold">SR</span>
                        </div>
                        <span className="font-medium text-gray-900">Semantic Relevancy</span>
                        <span className="text-gray-500 text-sm">Relevancy Agent</span>
                        <span className="text-gray-400 text-xs">(85%)</span>
                      </div>
                    </div>
                  </div>
                  }
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 