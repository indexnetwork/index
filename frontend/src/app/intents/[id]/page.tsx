"use client";

import { useState, useEffect, use } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import Header from "@/components/Header";
import { intentsService, Intent, IntentConnection, agents } from "@/services/intents";

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
      <div className="backdrop relative min-h-screen">
        <Header />
        <div className="flex-1 px-2 sm:px-2 md:px-32">
          <div className="py-8 text-center text-gray-500">Loading...</div>
        </div>
      </div>
    );
  }

  if (!intent) {
    return (
      <div className="backdrop relative min-h-screen">
        <Header />
        <div className="flex-1 px-2 sm:px-2 md:px-32">
          <div className="py-8 text-center text-gray-500">Intent not found</div>
        </div>
      </div>
    );
  }

  return (
    <div className="backdrop relative min-h-screen">
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

      <Header />

      <div className="flex-1 px-2 sm:px-2 md:px-32">
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
          {/* Intent Title */}
          <h1 className="text-xl font-bold font-ibm-plex-mono text-gray-900">
            {intent.title}
          </h1>
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
      </div>
    </div>
  );
} 