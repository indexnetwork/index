"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Lock, ArrowLeft, MessageSquare, Mail, Calendar, Linkedin } from "lucide-react";
import Header from "@/components/Header";
import Link from "next/link";

interface Integration {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
  connected: boolean;
}

export default function PrivateIndexPage() {
  const [integrations, setIntegrations] = useState<Integration[]>([
    {
      id: "slack",
      name: "Slack",
      icon: <MessageSquare className="h-6 w-6 text-gray-900" />,
      description: "Connect your Slack workspace to access messages and channels",
      connected: false
    },
    {
      id: "discord",
      name: "Discord",
      icon: <MessageSquare className="h-6 w-6 text-gray-900" />,
      description: "Connect your Discord server to access messages and channels",
      connected: false
    },
    {
      id: "gmail",
      name: "Gmail",
      icon: <Mail className="h-6 w-6 text-gray-900" />,
      description: "Connect your Gmail account to access emails and calendar",
      connected: false
    },
    {
      id: "calendar",
      name: "Calendar",
      icon: <Calendar className="h-6 w-6 text-gray-900" />,
      description: "Connect your calendar to access events and meetings",
      connected: false
    },
    {
      id: "linkedin",
      name: "LinkedIn",
      icon: <Linkedin className="h-6 w-6 text-gray-900" />,
      description: "Connect your LinkedIn account to access connections and messages",
      connected: false
    }
  ]);

  const handleConnect = (integrationId: string) => {
    setIntegrations(prev => 
      prev.map(integration => 
        integration.id === integrationId 
          ? { ...integration, connected: !integration.connected }
          : integration
      )
    );
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
              <div className="bg-white px-4 pt-1.5 pb-1 border border-black border border-b-0 inline-block">
                <Link href="/indexes" className="inline-flex items-center text-gray-600 hover:text-gray-900">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  <span className="font-ibm-plex text-[14px] text-black font-medium">Back to indexes</span>
                </Link>
              </div>

              <div className="flex flex-col sm:flex-row py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
                <div className="flex items-center gap-3">
                  <Lock className="h-6 w-6 text-gray-900" />
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900 font-ibm-plex mb-2">Personal Index</h1>
                    <p className="text-gray-500">Connect your services to build your private knowledge base</p>
                  </div>
                </div>
              </div>

              {/* Integrations Grid */}
              <div className="grid grid-cols-1 ] md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
                {integrations.map((integration) => (
                  <div
                    key={integration.id}
                    className="flex flex-col p-6 bg-white border border-black border-b-2 rounded-[1px]  transition-colors"
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <div className="p-2 bg-gray-100 rounded-lg">
                        {integration.icon}
                      </div>
                      <h3 className="text-lg font-semibold text-gray-900">{integration.name}</h3>
                    </div>
                    <p className="text-gray-500 mb-4 flex-grow">{integration.description}</p>
                    <Button
                      variant={integration.connected ? "outline" : "default"}
                      onClick={() => handleConnect(integration.id)}
                    >
                      {integration.connected ? "Disconnect" : "Connect"}
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer Info */}
            <div className="mt-4 text-center text-sm text-gray-500 p-4">
              Your private index data is encrypted and only accessible to you
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 