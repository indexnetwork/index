"use client";

import { Lock, ArrowLeft, MessageSquare, Calendar, Slack, LinkedinIcon } from "lucide-react";
import Link from "next/link";
import ClientLayout from "@/components/ClientLayout";
import { Google, Notion } from "@lobehub/icons";
import { useAPI } from "@/contexts/APIContext";
import { useEffect, useState, useCallback } from "react";
import { Integration } from "@/services/integrations";

interface IntegrationConfig {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
}

export default function PrivateIndexPage() {
  const { integrationsService } = useAPI();
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectingIntegration, setConnectingIntegration] = useState<string | null>(null);
  const [connectionStatuses, setConnectionStatuses] = useState<Record<string, string>>({});
  const [syncingIntegration, setSyncingIntegration] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);

  const integrationConfigs: IntegrationConfig[] = [
    {
      id: "notion",
      name: "Notion",
      icon: <Notion className="h-6 w-6 text-gray-900" />,
      description: "Connect your Notion workspace to access pages and databases"
    },
    {
      id: "slack",
      name: "Slack",
      icon: <Slack className="h-6 w-6 text-gray-900" />,
      description: "Connect your Slack workspace to access messages and channels"
    },
    {
      id: "discord",
      name: "Discord",
      icon: <MessageSquare className="h-6 w-6 text-gray-900" />,
      description: "Connect your Discord server to access messages and channels"
    },
    {
      id: "gmail",
      name: "Gmail",
      icon: <Google className="h-6 w-6 text-gray-900" />,
      description: "Connect your Gmail account to access emails and calendar"
    },
    {
      id: "calendar",
      name: "Calendar",
      icon: <Calendar className="h-6 w-6 text-gray-900" />,
      description: "Connect your calendar to access events and meetings"
    },
    {
      id: "linkedin",
      name: "LinkedIn",
      icon: <LinkedinIcon className="h-6 w-6 text-gray-900" />,
      description: "Connect your LinkedIn account to access connections and messages"
    }
  ];

  // Load integrations status
  const loadIntegrations = useCallback(async () => {
    try {
      const response = await integrationsService.getIntegrations();
      setIntegrations(response.integrations);
    } catch (error) {
      console.error('Failed to load integrations:', error);
    } finally {
      setLoading(false);
    }
  }, [integrationsService]);

  // Handle OAuth connection
  const handleConnect = async (integrationType: string) => {
    try {
      setConnectingIntegration(integrationType);
      setConnectionStatuses(prev => ({ ...prev, [integrationType]: 'Initiating...' }));

      // Initiate OAuth flow
      const response = await integrationsService.connectIntegration(integrationType);
      
      setConnectionStatuses(prev => ({ ...prev, [integrationType]: 'Redirecting to authorization...' }));

      // Open OAuth popup window
      const popup = window.open(
        response.redirectUrl,
        `oauth-${integrationType}`,
        'width=600,height=700,scrollbars=yes,resizable=yes'
      );

      if (!popup) {
        throw new Error('Popup blocked. Please allow popups and try again.');
      }

      // Poll for connection status
      const pollConnection = async () => {
        try {
          const statusResponse = await integrationsService.checkConnectionStatus(response.connectionRequestId);
          
          if (statusResponse.status === 'connected') {
            setConnectionStatuses(prev => ({ ...prev, [integrationType]: 'Connected!' }));
            popup.close();
            await loadIntegrations(); // Refresh integrations list
            setConnectingIntegration(null);
            
            // Clear status message after 3 seconds
            setTimeout(() => {
              setConnectionStatuses(prev => ({ ...prev, [integrationType]: '' }));
            }, 3000);
            
            return;
          }
          
          // Continue polling if still pending
          if (statusResponse.status === 'pending') {
            setTimeout(pollConnection, 2000);
          }
        } catch (error) {
          console.error('Error checking connection status:', error);
          setConnectionStatuses(prev => ({ ...prev, [integrationType]: 'Connection failed. Please try again.' }));
          setConnectingIntegration(null);
          popup.close();
        }
      };

      // Start polling after a short delay
      setTimeout(pollConnection, 3000);

      // Handle popup close
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          if (connectingIntegration === integrationType) {
            setConnectingIntegration(null);
            setConnectionStatuses(prev => ({ ...prev, [integrationType]: '' }));
          }
        }
      }, 1000);

    } catch (error) {
      console.error('Failed to connect integration:', error);
      setConnectionStatuses(prev => ({ 
        ...prev, 
        [integrationType]: error instanceof Error ? error.message : 'Connection failed. Please try again.' 
      }));
      setConnectingIntegration(null);
    }
  };

  // Handle disconnect
  const handleDisconnect = async (integrationType: string) => {
    try {
      await integrationsService.disconnectIntegration(integrationType);
      await loadIntegrations(); // Refresh integrations list
    } catch (error) {
      console.error('Failed to disconnect integration:', error);
    }
  };

  // Handle sync integration
  const handleSync = async (integrationType: string) => {
    try {
      setSyncingIntegration(integrationType);
      const result = await integrationsService.syncIntegration(integrationType);
      
      if (result.success) {
        console.log(`Sync complete: ${result.filesImported} files, ${result.intentsGenerated} intents`);
        // Refresh integrations to get updated lastSyncAt
        await loadIntegrations();
      } else {
        console.error('Sync failed:', result.error);
      }
    } catch (error) {
      console.error('Failed to sync integration:', error);
    } finally {
      setSyncingIntegration(null);
    }
  };


  useEffect(() => {
    loadIntegrations();
  }, [loadIntegrations]);

  if (loading) {
    return (
      <ClientLayout>
        <div className="w-full h-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
        </div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      <div className="w-full h-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
        backgroundImage: 'url(/grid.png)',
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {integrationConfigs.map((config) => {
            const integration = integrations.find(i => i.id === config.id);
            const isConnected = integration?.connected || false;
            const isConnecting = connectingIntegration === config.id;
            const statusMessage = connectionStatuses[config.id];

            return (
              <div
                key={config.id}
                className="p-4 bg-white border border-black border-b-2 rounded-[1px] transition-colors"
              >
                {/* Header with icon, name, and toggle */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="p-1.5 bg-gray-100 rounded-lg">
                      {config.icon}
                    </div>
                    <div>
                      <h3 className="text-base font-medium text-gray-900">{config.name}</h3>
                    </div>
                  </div>
                  <div 
                    className={`relative w-11 h-6 rounded-full cursor-pointer transition-colors ${
                      isConnected ? 'bg-green-500' : 'bg-gray-200'
                    } ${isConnecting ? 'opacity-50 cursor-not-allowed' : ''}`}
                    onClick={() => {
                      if (isConnecting) return;
                      if (isConnected) {
                        handleDisconnect(config.id);
                      } else {
                        handleConnect(config.id);
                      }
                    }}
                  >
                    <div 
                      className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                        isConnected ? 'transform translate-x-5' : 'left-0.5'
                      }`}
                    />
                  </div>
                </div>

                {/* Status badges */}
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  {isConnected && (
                    <span className="px-2 py-0.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full">
                      Connected
                    </span>
                  )}
                  {isConnecting && (
                    <span className="px-2 py-0.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full">
                      Connecting...
                    </span>
                  )}
                  {syncingIntegration === config.id && (
                    <span className="px-2 py-0.5 text-xs font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-full">
                      Syncing...
                    </span>
                  )}
                </div>

                {/* Status messages and sync info */}
                <div className="space-y-1">
                  {statusMessage && (
                    <p className="text-xs text-gray-500">{statusMessage}</p>
                  )}
                  {integration?.lastSyncAt && (
                    <p className="text-xs text-gray-400">
                      Last synced: {new Date(integration.lastSyncAt).toLocaleDateString()} at {new Date(integration.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                </div>

                {/* Sync button */}
                {isConnected && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <button
                      onClick={() => handleSync(config.id)}
                      disabled={syncingIntegration === config.id}
                      className="w-full px-3 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-ibm-plex font-medium transition-colors"
                    >
                      {syncingIntegration === config.id ? 'Syncing...' : 'Sync now'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

    </ClientLayout>
    
  );
} 