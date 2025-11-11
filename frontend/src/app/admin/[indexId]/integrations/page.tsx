'use client';

import { useState, useEffect, useCallback, use } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import ClientLayout from '@/components/ClientLayout';
import { useNotifications } from '@/contexts/NotificationContext';
import { createIntegrationsService } from '@/services/integrations';
import { useAuthenticatedAPI } from '@/lib/api';

interface IntegrationItem {
  id: string | null;
  type: string;
  name: string;
  connected: boolean;
  connectedAt?: string | null;
  lastSyncAt?: string | null;
}

const SUPPORTED_INTEGRATIONS = [
  { type: 'slack', name: 'Slack' },
  { type: 'discord', name: 'Discord' },
  { type: 'notion', name: 'Notion' },
  { type: 'googledocs', name: 'Google Docs' }
];

export default function IntegrationsPage({ params }: { params: Promise<{ indexId: string }> }) {
  const { indexId } = use(params);
  const { success, error: showError } = useNotifications();
  const api = useAuthenticatedAPI();
  
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([]);
  const [integrationsLoaded, setIntegrationsLoaded] = useState(false);
  const [pendingIntegration, setPendingIntegration] = useState<string | null>(null);

  const loadIntegrations = useCallback(async () => {
    try {
      const integrationsService = createIntegrationsService(api);
      const response = await integrationsService.getIntegrations(indexId);
      
      // Filter to only show supported integrations
      const filtered = response.integrations.filter(int => 
        SUPPORTED_INTEGRATIONS.some(s => s.type === int.type.toLowerCase())
      );
      
      // Create a list with all supported integrations, marking which are connected
      const integrationsMap = new Map(filtered.map(int => [int.type.toLowerCase(), int]));
      
      const formattedIntegrations: IntegrationItem[] = SUPPORTED_INTEGRATIONS.map(({ type, name }) => {
        const existing = integrationsMap.get(type);
        return {
          id: existing?.id || null,
          type,
          name,
          connected: existing?.connected || false,
          connectedAt: existing?.connectedAt,
          lastSyncAt: existing?.lastSyncAt
        };
      });
      
      setIntegrations(formattedIntegrations);
      setIntegrationsLoaded(true);
    } catch (err) {
      console.error('Failed to load integrations:', err);
      showError('Failed to load integrations');
    }
  }, [indexId, api, showError]);

  useEffect(() => {
    loadIntegrations();
  }, [loadIntegrations]);

  const handleToggleIntegration = async (integration: IntegrationItem) => {
    if (integration.connected) {
      // Disconnect
      if (!integration.id) return;
      setPendingIntegration(integration.type);
      try {
        const integrationsService = createIntegrationsService(api);
        await integrationsService.disconnectIntegration(integration.id);
        success(`${integration.name} disconnected successfully`);
        await loadIntegrations();
      } catch (err) {
        console.error('Failed to disconnect integration:', err);
        showError(`Failed to disconnect ${integration.name}`);
      } finally {
        setPendingIntegration(null);
      }
    } else {
      // Connect
      setPendingIntegration(integration.type);
      try {
        const integrationsService = createIntegrationsService(api);
        const response = await integrationsService.connectIntegration(integration.type, {
          indexId,
          enableUserAttribution: true
        });
        
        // Open OAuth popup
        const width = 600;
        const height = 700;
        const left = window.screen.width / 2 - width / 2;
        const top = window.screen.height / 2 - height / 2;
        
        const popup = window.open(
          response.redirectUrl,
          'oauth',
          `width=${width},height=${height},left=${left},top=${top}`
        );
        
        // Poll for status
        const integrationId = response.integrationId;
        const checkInterval = setInterval(async () => {
          try {
            if (popup?.closed) {
              clearInterval(checkInterval);
              setPendingIntegration(null);
              return;
            }
            
            const service = createIntegrationsService(api);
            const status = await service.getIntegrationStatus(integrationId);
            if (status.status === 'connected') {
              clearInterval(checkInterval);
              popup?.close();
              success(`${integration.name} connected successfully`);
              await loadIntegrations();
              setPendingIntegration(null);
            }
          } catch {
            // Continue polling
          }
        }, 2000);
        
        // Stop polling after 5 minutes
        setTimeout(() => {
          clearInterval(checkInterval);
          if (pendingIntegration === integration.type) {
            setPendingIntegration(null);
          }
        }, 300000);
        
      } catch (err) {
        console.error('Failed to connect integration:', err);
        showError(`Failed to connect ${integration.name}`);
        setPendingIntegration(null);
      }
    }
  };

  const activeTab = 'integrations';
  const connectedCount = integrations.filter(it => it.connected).length;

  return (
    <ClientLayout>
      <div className="w-full border border-gray-800 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
        backgroundImage: 'url(/grid.png)',
        backgroundColor: 'white',
        backgroundSize: '888px'
      }}>
        <div className="flex flex-col justify-between mb-4">
          <Tabs.Root value={activeTab} className="flex-grow">
            <Tabs.List className="overflow-x-auto inline-flex text-sm text-black">
              <Tabs.Trigger 
                value="integrations" 
                className="font-ibm-plex-mono cursor-pointer border border-b-0 border-black px-3 py-2 bg-white data-[state=active]:bg-black data-[state=active]:text-white"
              >
                Integrations
                {connectedCount > 0 && (
                  <span className="ml-2 bg-gray-100 text-gray-600 text-xs px-2 py-1 rounded-full data-[state=active]:bg-white data-[state=active]:text-black">
                    {connectedCount}
                  </span>
                )}
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="integrations" className="p-0 mt-0">
              <div className="bg-white border border-b-2 border-gray-800 p-6">
                <section>
                  <p className="text-sm text-[#666] font-ibm-plex-mono mb-4">
                    Connect external services to sync data with your index. Attribution is always enabled.
                  </p>

                  <div className="grid grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 sm:gap-3 mb-4">
                    {integrations.map((it) => {
                      return (
                        <div 
                          key={it.type} 
                          className="flex flex-col gap-2 border border-black border-b-2 rounded-none px-2.5 py-2 transition-colors md:px-3 md:py-2.5 bg-[#FAFAFA] hover:bg-[#F0F0F0] hover:border-black"
                        >
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-3">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={`/integrations/${it.type}.png`} width={20} height={20} alt="" />
                              <span className="text-xs font-medium text-[#333] font-ibm-plex-mono">{it.name}</span>
                            </span>
                            <div className="flex items-center">
                              {!integrationsLoaded ? (
                                <div className="w-11 h-6 bg-[#F5F5F5] rounded-full animate-pulse" />
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleIntegration(it);
                                  }}
                                  disabled={pendingIntegration === it.type}
                                  className={`relative h-6 w-11 rounded-full transition-colors duration-200 cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0 ${
                                    it.connected ? 'bg-[#006D4B]' : 'bg-[#D9D9D9]'
                                  } ${pendingIntegration === it.type ? 'opacity-70' : ''}`}
                                  aria-pressed={it.connected}
                                  aria-busy={pendingIntegration === it.type}
                                  aria-label={`${it.name} ${it.connected ? 'connected' : 'disconnected'}`}
                                >
                                  <span
                                    className={`absolute top-[1px] left-[1px] h-[22px] w-[22px] rounded-full bg-white transition-transform duration-200 shadow-sm ${
                                      it.connected ? 'translate-x-5' : 'translate-x-0'
                                    }`}
                                  />
                                  {pendingIntegration === it.type && (
                                    <span className="absolute inset-0 grid place-items-center">
                                      <span
                                        className="h-3 w-3 border-2 border-white/70 border-t-transparent rounded-full animate-spin"
                                        style={{
                                          marginLeft: it.connected ? "-20px" : "20px"
                                        }}
                                      />
                                    </span>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-6 p-4 bg-[#E3F2FD] border border-[#BBDEFB] rounded-sm space-y-3">
                    <h4 className="text-sm font-medium text-[#1976D2] font-ibm-plex-mono mb-2">What happens when you connect:</h4>
                    
                    <div className="flex items-start gap-2">
                      <div className="w-4 h-4 rounded-full bg-[#1976D2] flex-shrink-0 mt-0.5">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="p-0.5">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                          <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[#1976D2] font-ibm-plex-mono mb-1">
                          Auto-add Members
                        </p>
                        <p className="text-xs text-[#1565C0] font-ibm-plex-mono">
                          People from the connected service will automatically join this index.
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-2">
                      <div className="w-4 h-4 rounded-full bg-[#1976D2] flex-shrink-0 mt-0.5">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="p-0.5">
                          <path d="M9 11l3 3L22 4"></path>
                          <path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c1.67 0 3.22.46 4.56 1.26"></path>
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[#1976D2] font-ibm-plex-mono mb-1">
                          Generate Intents
                        </p>
                        <p className="text-xs text-[#1565C0] font-ibm-plex-mono">
                          We&apos;ll analyze their data to understand key topics and goals.
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-start gap-2">
                      <div className="w-4 h-4 rounded-full bg-[#1976D2] flex-shrink-0 mt-0.5">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" className="p-0.5">
                          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[#1976D2] font-ibm-plex-mono mb-1">
                          Enable Discovery
                        </p>
                        <p className="text-xs text-[#1565C0] font-ibm-plex-mono">
                          Others in this index can discover shared interests to spark collaboration.
                        </p>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </div>
    </ClientLayout>
  );
}
