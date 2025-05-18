"use client";

import { useState, useEffect, use } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Play, Archive, Pause } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { intentsService, Intent, IntentConnection, agents } from "@/services/intents";
import ClientLayout from "@/components/ClientLayout";

interface IntentDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default function IntentDetailPage({ params }: IntentDetailPageProps) {
  const resolvedParams = use(params);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [connections, setConnections] = useState<IntentConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const fetchIntentData = async () => {
      try {
        const [intentData, connectionsData] = await Promise.all([
          intentsService.getIntent(resolvedParams.id),
          intentsService.getIntentConnections(resolvedParams.id)
        ]);
        setIntent(intentData || null);
        setConnections(connectionsData);
      } catch (error) {
        console.error('Error fetching intent data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchIntentData();
  }, [resolvedParams.id]);

  if (loading) {
    return (
      <ClientLayout>
        <div className="py-8 text-center text-gray-500">Loading...</div>
      </ClientLayout>
    );
  }

  if (!intent) {
    return (
      <ClientLayout>
        <div className="py-8 text-center text-gray-500">Intent not found</div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      {/* Main Tabs */}
      <div className="w-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
          backgroundImage: 'url(https://www.trychroma.com/pricing/grid.png)',
          backgroundColor: 'white',
          backgroundSize: '888px'
        }}>

        <div className="bg-white px-4 pt-1.5 pb-1 border border-black  border border-b-0 inline-block">
          <Link href="/intents" className="inline-flex items-center text-gray-600 hover:text-gray-900 cursor-pointer">
            <ArrowLeft className="h-4 w-4 mr-2" />
            <span className="font-ibm-plex-mono text-[14px] text-black font-medium">Back to intents</span>
          </Link>
        </div>

        <div className="bg-white px-4 pt-4 pb-4 mb-4 border border-black border-b-0 border-b-2">
          {/* Intent Title and Info */}
          <div className="flex flex-wrap sm:flex-nowrap justify-between items-center">
            <div className="w-full sm:w-auto mb-2 sm:mb-0">
              <h1 className="text-xl font-bold font-ibm-plex-mono text-gray-900">
                {intent.title}
              </h1>
              <p className="text-gray-500 font-ibm-plex-mono text-sm mt-1">Updated {intent.updatedAt} • {connections.length} connections</p>
            </div>
            <div className="flex gap-2 min-w-[90px] sm:min-w-[90px] sm:justify-end">
              {isPaused ? (
                <>
                  <Button 
                    variant="bordered" 
                    size="sm"
                    onClick={() => {
                      // Add archive functionality here
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <Archive className="h-4 w-4" />
                    </div>
                  </Button>                
                  <Button 
                    variant="bordered" 
                    size="sm"
                    onClick={() => setIsPaused(false)}
                    className="relative group"
                  >
                    <div className="flex items-center gap-2">
                      <Play className="h-4 w-4" />
                    </div>
                  </Button>

                </>
              ) : (
                <Button 
                variant="bordered" 
                  size="sm"
                  onClick={() => setIsPaused(true)}
                  className="relative group text-red-600 hover:bg-red-50 hover:text-red-700 cursor-pointer rounded-[1px] focus:text-red-700"
                >
                  <div className="flex items-center gap-2">
                    <div className="relative w-4 h-4">
                      <div className="relative w-4 h-4 flex mt-0.5 ml-0.5 ">
                        <div className="absolute inset-0 w-3 h-3 rounded-full bg-green-500 group-hover:hidden" />
                        <div className="absolute inset-0 w-3 h-3 rounded-full bg-green-500 animate-ping opacity-100 group-hover:hidden" />
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Pause className="h-4 w-4" />
                      </div>
                    </div>
                  </div>
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Connection Cards Grid */}
        <div className="grid grid-cols-1 gap-6">
          {connections.map((connection) => (
            <div key={connection.id} className="bg-white border border-black border-b-0 border-b-2 p-6">
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-4">
                  <img
                    src={connection.avatar}
                    alt={connection.name}
                    width={48}
                    height={48}
                    className="rounded-full"
                  />
                  <div>
                    <h2 className="text-lg font-medium text-gray-900">{connection.name}</h2>
                    <p className="text-sm text-gray-600">{connection.role}</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button>
                    Accept Connection
                  </Button>
                  <Button variant="outline">
                    Decline
                  </Button>
                </div>
              </div>

              {/* Why this connection matters */}
              <div className="mb-6 border-b border-gray-200 pb-6">
                <h3 className="font-medium text-gray-700 mb-3">Why this connection matters</h3>
                <p className="text-gray-700">
                  {connection.connectionRationale}
                </p>
              </div>

              {/* Who's backing this connection */}
              <div>
                <h3 className="font-medium text-gray-700 mb-4">Who's backing this connection</h3>
                <div className="flex flex-wrap gap-2">
                  {connection.backers.map((backer, index) => {
                    const agent = agents.find(a => a.id === backer.agentId);
                    if (!agent) return null;
                    
                    return (
                      <div key={index} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                        <div className="w-6 h-6 bg-blue-100 rounded-lg flex items-center justify-center">
                          <Image src={agent.avatar} alt={agent.name} width={16} height={16} />
                        </div>
                        <span className="font-medium text-gray-900">{agent.name}</span>
                        <span className="text-gray-500 text-sm">{agent.role}</span>
                        <span className="text-gray-400 text-xs">({Math.round(backer.confidence * 100)}%)</span>
                      </div>
                    );
                  })}
                  {connection.backers.length > 4 && (
                    <div className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-full">
                      <span className="text-gray-600">+{connection.backers.length - 4}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </ClientLayout>
  );
} 