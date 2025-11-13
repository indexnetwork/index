'use client';

import { useState, useEffect, useCallback, use } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import ClientLayout from '@/components/ClientLayout';
import { useNotifications } from '@/contexts/NotificationContext';
import { createIntegrationsService, type DirectorySyncConfig } from '@/services/integrations';
import { useAuthenticatedAPI } from '@/lib/api';
import DirectoryConfigModal from '@/components/modals/DirectoryConfigModal';
import { INTEGRATIONS } from '@/config/integrations';

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
  //{ type: 'discord', name: 'Discord' },
  { type: 'notion', name: 'Notion' },
  { type: 'airtable', name: 'Airtable' },
  //{ type: 'googledocs', name: 'Google Docs' }
];

export default function IntegrationsPage({ params }: { params: Promise<{ indexId: string }> }) {
  const { indexId } = use(params);
  const { success, error: showError } = useNotifications();
  const api = useAuthenticatedAPI();
  
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([]);
  const [integrationsLoaded, setIntegrationsLoaded] = useState(false);
  const [pendingIntegration, setPendingIntegration] = useState<string | null>(null);
  const [directoryConfigs, setDirectoryConfigs] = useState<Record<string, DirectorySyncConfig>>({});
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [selectedIntegrationForConfig, setSelectedIntegrationForConfig] = useState<IntegrationItem | null>(null);
  const [syncingDirectory, setSyncingDirectory] = useState<string | null>(null);

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

      // Load directory configs for directory-enabled integrations
      const configs: Record<string, DirectorySyncConfig> = {};
      for (const integration of formattedIntegrations) {
        const integrationDef = INTEGRATIONS.find(i => i.type === integration.type);
        if (integrationDef?.requiresDirectoryConfig && integration.id) {
          try {
            const configResponse = await integrationsService.getDirectoryConfig(integration.id);
            if (configResponse.config) {
              configs[integration.id] = configResponse.config;
            }
          } catch {
            // Config not set yet, that's fine
          }
        }
      }
      setDirectoryConfigs(configs);
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
              
              // If integration requires directory config, open config modal
              const integrationDef = INTEGRATIONS.find(i => i.type === integration.type);
              if (integrationDef?.requiresDirectoryConfig) {
                // Find the connected integration to get its ID
                const updatedIntegrations = await service.getIntegrations(indexId);
                const connectedIntegration = updatedIntegrations.integrations.find(
                  i => i.type === integration.type && i.id === integrationId
                );
                if (connectedIntegration?.id) {
                  setSelectedIntegrationForConfig({
                    id: connectedIntegration.id,
                    type: integration.type,
                    name: integration.name,
                    connected: true
                  });
                  setConfigModalOpen(true);
                }
              }
              
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

                  <div className="grid grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-3 md:grid-cols-3 gap-1.5 sm:gap-3 mb-4">
                    {integrations.map((it) => {
                      const integrationDef = INTEGRATIONS.find(i => i.type === it.type);
                      const requiresDirectoryConfig = integrationDef?.requiresDirectoryConfig;
                      const directoryConfig = it.id ? directoryConfigs[it.id] : null;

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
                          {it.connected && requiresDirectoryConfig && it.id && (
                            <div className="mt-2 pt-2 border-t border-gray-200">
                              {directoryConfig ? (
                                <div className="space-y-1">
                                  <p className="text-[10px] text-gray-600 font-ibm-plex-mono">
                                    {directoryConfig.source.name}
                                    {directoryConfig.source.subName && ` • ${directoryConfig.source.subName}`}
                                  </p>
                                  {directoryConfig.lastSyncAt && (
                                    <p className="text-[10px] text-gray-500 font-ibm-plex-mono">
                                      Last sync: {new Date(directoryConfig.lastSyncAt).toLocaleDateString()}
                                    </p>
                                  )}
                                  <div className="flex gap-1 mt-1">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedIntegrationForConfig(it);
                                        setConfigModalOpen(true);
                                      }}
                                      className="text-[10px] px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded font-ibm-plex-mono text-black"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        if (!it.id) return;
                                        setSyncingDirectory(it.id);
                                        try {
                                          const integrationsService = createIntegrationsService(api);
                                          await integrationsService.syncDirectory(it.id);
                                          success('Directory sync started');
                                          await loadIntegrations();
                                        } catch {
                                          showError('Failed to sync directory');
                                        } finally {
                                          setSyncingDirectory(null);
                                        }
                                      }}
                                      disabled={syncingDirectory === it.id}
                                      className="text-[10px] px-2 py-0.5 bg-blue-100 hover:bg-blue-200 rounded font-ibm-plex-mono disabled:opacity-50 text-black"
                                    >
                                      {syncingDirectory === it.id ? 'Syncing...' : 'Sync'}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedIntegrationForConfig(it);
                                    setConfigModalOpen(true);
                                  }}
                                  className="w-full text-[10px] px-2 py-1 bg-blue-100 hover:bg-blue-200 rounded font-ibm-plex-mono text-black"
                                >
                                  Configure Directory Sync
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>


                </section>
              </div>
            </Tabs.Content>
          </Tabs.Root>
        </div>
      </div>

      {selectedIntegrationForConfig && selectedIntegrationForConfig.id && (
        <DirectoryConfigModal
          open={configModalOpen}
          onOpenChange={setConfigModalOpen}
          integration={{
            id: selectedIntegrationForConfig.id,
            type: selectedIntegrationForConfig.type as 'notion' | 'airtable' | 'googledocs',
            name: selectedIntegrationForConfig.name
          }}
          onSuccess={() => {
            loadIntegrations();
          }}
        />
      )}
    </ClientLayout>
  );
}
