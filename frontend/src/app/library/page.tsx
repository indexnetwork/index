"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as Tabs from "@radix-ui/react-tabs";
import { Loader2, Trash2, ExternalLink } from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";
import { useAPI, useIntegrations, useNegotiations } from "@/contexts/APIContext";
import { useAuthenticatedAPI } from "@/lib/api";
import { useNotifications } from "@/contexts/NotificationContext";
import { formatDate } from "@/lib/utils";
import { formatFileSize, getFileCategoryBadge } from "@/lib/file-validation";
import { IntegrationName, getIntegrationsList } from "@/config/integrations";
import IntentList from "@/components/IntentList";
import NegotiationList from "@/components/NegotiationList";
import ClientLayout from "@/components/ClientLayout";
import { ContentContainer } from "@/components/layout";

type LibrarySourceIntent = {
  id: string;
  payload: string;
  summary?: string | null;
  createdAt: string;
  sourceType: 'file' | 'link' | 'integration';
  sourceId: string;
  sourceName: string;
  sourceValue: string | null;
  sourceMeta: string | null;
};

type FileItem = {
  id: string;
  name: string;
  size: string;
  type: string;
  createdAt: string;
  url: string;
};

type LinkItem = {
  id: string;
  url: string;
  createdAt?: string;
  lastSyncAt?: string | null;
};

type Integration = {
  id: string | null;
  type: IntegrationName;
  name: string;
  connected: boolean;
  indexId?: string | null;
};

export default function LibraryPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const { filesService, linksService, intentsService } = useAPI();
  const integrationsService = useIntegrations();
  const negotiationsService = useNegotiations();
  const api = useAuthenticatedAPI();
  const { success, error } = useNotifications();

  const [activeTab, setActiveTab] = useState<'intents' | 'negotiations' | 'connections' | 'files' | 'links'>('intents');
  const [isLoading, setIsLoading] = useState(true);
  const tabDescriptions = {
    intents: {
      title: "My Intents",
      description:
        "Things that your agent thinks you might be looking for, inferred from your activity. Review them and remove anything that doesn’t feel right.",
      privacy:
        "AI agents use these to surface opportunities and only match when there’s mutual intent."
    },
    negotiations: {
      title: "Negotiations",
      description:
        "Your agent negotiates with other agents to coordinate discovery. They continuously align on intent, timing, trust, value, and data sharing before any connection is made.",
      privacy:
        "Negotiations are private between participating agents. You see only your side."
    },
    connections: {
      title: "Connections",
      description:
        "Accounts and tools linked to your library. Activity from these sources helps keep your intents accurate and up to date.",
      privacy:
        "AI agents use connected sources to keep your intents up to date."
    },
    files: {
      title: "Files",
      description:
        "Files you’ve shared in conversations, available for review and management here.",
      privacy:
        "AI agents use these files to help generate intents, and they stay private to your account."
    },
    links: {
      title: "Links",
      description:
        "URLs you’ve added so we can periodically refresh them and extract relevant intents.",
      privacy:
        "AI agents use web content to keep your intents up to date."
    }
  } as const;

  // Data states
  const [intents, setIntents] = useState<LibrarySourceIntent[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [negotiationCount, setNegotiationCount] = useState(0);

  // Loading states per tab
  const [loadingIntents, setLoadingIntents] = useState(false);
  const [loadingIntegrations, setLoadingIntegrations] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingLinks, setLoadingLinks] = useState(false);

  // Integration connection state
  const [pendingIntegration, setPendingIntegration] = useState<IntegrationName | null>(null);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/');
    }
  }, [authLoading, isAuthenticated, router]);

  // Load intents
  const loadIntents = useCallback(async () => {
    try {
      setLoadingIntents(true);
      const res = await api.post<{ intents?: LibrarySourceIntent[] }>('/intents/list', { page: 1, limit: 100 });
      setIntents((res.intents ?? []).map(i => ({
        ...i,
        sourceType: (i as any).sourceType ?? 'file',
        sourceId: (i as any).sourceId ?? '',
        sourceName: (i as any).sourceName ?? '',
        sourceValue: (i as any).sourceValue ?? null,
        sourceMeta: (i as any).sourceMeta ?? null,
      })));
    } catch {
      setIntents([]);
    } finally {
      setLoadingIntents(false);
    }
  }, [api]);

  // Load integrations
  const loadIntegrations = useCallback(async () => {
    try {
      setLoadingIntegrations(true);
      const response = await integrationsService.getIntegrations();
      
      const connectedIntegrations = response.integrations || [];
      const availableTypes = response.availableTypes || [];
      
      // Filter to only show single-user integrations
      const singleUserIntegrationTypes = ['notion', 'airtable'];
      const filteredAvailableTypes = availableTypes.filter(type => 
        singleUserIntegrationTypes.includes(type.type.toLowerCase())
      );
      
      // Filter out index integrations - only show user integrations (no indexId)
      const userOnlyIntegrations = connectedIntegrations.filter(i => !i.indexId);
      
      // Create integration state combining connected and available types
      const updatedIntegrations = filteredAvailableTypes.map(availableType => {
        const connectedIntegration = userOnlyIntegrations.find(i => i.type === availableType.type);
        return {
          id: connectedIntegration?.id || null,
          type: availableType.type as IntegrationName,
          name: availableType.name,
          connected: !!connectedIntegration,
          indexId: null
        };
      });
      
      setIntegrations(updatedIntegrations);
    } catch {
      // Fallback to default integrations if API fails
      const singleUserIntegrationTypes = ['notion', 'airtable'];
      const filteredIntegrations = getIntegrationsList().filter(int =>
        singleUserIntegrationTypes.includes(int.type.toLowerCase())
      );
      setIntegrations(filteredIntegrations.map(i => ({ ...i, id: null, connected: false })));
    } finally {
      setLoadingIntegrations(false);
    }
  }, [integrationsService]);

  // Load files
  const loadFiles = useCallback(async () => {
    try {
      setLoadingFiles(true);
      const f = await filesService.getFiles();
      setFiles(f.map(file => ({
        ...file,
        size: String(file.size),
        createdAt: file.createdAt || new Date().toISOString(),
        url: file.url || ''
      })));
    } catch {
      setFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  }, [filesService]);

  // Load links
  const loadLinks = useCallback(async () => {
    try {
      setLoadingLinks(true);
      const l = await linksService.getLinks();
      setLinks(l);
    } catch {
      setLinks([]);
    } finally {
      setLoadingLinks(false);
    }
  }, [linksService]);

  // Load negotiation count
  const loadNegotiationCount = useCallback(async () => {
    try {
      const stats = await negotiationsService.getStats();
      setNegotiationCount(stats.total);
    } catch {
      setNegotiationCount(0);
    }
  }, [negotiationsService]);

  // Connect integration
  const handleConnectIntegration = useCallback(async (type: IntegrationName) => {
    const item = integrations.find(i => i.type === type);
    if (!item) return;
    
    try {
      setPendingIntegration(type);
      const popup = typeof window !== 'undefined' ? window.open('', `oauth_${type}`, 'width=560,height=720') : null;
      const res = await integrationsService.connectIntegration(type, {});
      const redirect = res.redirectUrl;
      const integrationId = res.integrationId;
      
      if (popup && redirect) {
        popup.location.href = redirect;
      } else if (redirect) {
        window.location.href = redirect;
        return;
      }
      
      if (integrationId) {
        const started = Date.now();
        
        const poll = setInterval(async () => {
          if (popup && popup.closed) {
            clearInterval(poll);
            setPendingIntegration(null);
            return;
          }
          
          try {
            const s = await integrationsService.getIntegrationStatus(integrationId);
            
            if (s.status === 'connected') {
              clearInterval(poll);
              if (popup && !popup.closed) popup.close();
              setIntegrations(prev => prev.map(x => x.type === type ? { ...x, connected: true, id: integrationId } : x));
              success(`${item.name} connected`);
              setPendingIntegration(null);
            }
            if (Date.now() - started > 90000) {
              clearInterval(poll);
              if (popup && !popup.closed) popup.close();
              error('Connection timeout - please try again');
              setPendingIntegration(null);
            }
          } catch (err) {
            console.error('Error checking connection status:', err);
          }
        }, 1500);
      }
    } catch (err) {
      console.error('Error connecting integration:', err);
      error(`Failed to connect ${item.name}`);
      setPendingIntegration(null);
    }
  }, [integrationsService, integrations, success, error]);

  // Disconnect integration
  const handleDisconnectIntegration = useCallback(async (type: IntegrationName) => {
    const item = integrations.find(i => i.type === type);
    if (!item?.connected || !item.id) return;
    
    try {
      setPendingIntegration(type);
      await integrationsService.disconnectIntegration(item.id);
      setIntegrations(prev => prev.map(x => x.type === type ? { ...x, connected: false, id: null } : x));
      success(`${item.name} disconnected`);
    } catch (err) {
      console.error('Error disconnecting integration:', err);
      error(`Failed to disconnect ${item.name}`);
    } finally {
      setPendingIntegration(null);
    }
  }, [integrationsService, integrations, success, error]);

  // Initial load
  useEffect(() => {
    if (!isAuthenticated || authLoading) return;

    const loadAll = async () => {
      setIsLoading(true);
      await Promise.all([loadIntents(), loadIntegrations(), loadFiles(), loadLinks(), loadNegotiationCount()]);
      setIsLoading(false);
    };

    loadAll();
  }, [isAuthenticated, authLoading, loadIntents, loadIntegrations, loadFiles, loadLinks, loadNegotiationCount]);

  // Archive intent handler
  const handleArchiveIntent = useCallback(async (intent: LibrarySourceIntent) => {
    setIntents(prev => prev.filter(i => i.id !== intent.id));
    try {
      await intentsService.archiveIntent(intent.id);
      success('Intent archived');
    } catch {
      error('Failed to archive intent');
      await loadIntents();
    }
  }, [intentsService, success, error, loadIntents]);

  // Delete file handler
  const handleDeleteFile = useCallback(async (fileId: string) => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
    try {
      await filesService.deleteFile(fileId);
      success('File deleted');
    } catch {
      error('Failed to delete file');
      await loadFiles();
    }
  }, [filesService, success, error, loadFiles]);

  // Delete link handler
  const handleDeleteLink = useCallback(async (linkId: string) => {
    setLinks(prev => prev.filter(l => l.id !== linkId));
    try {
      await linksService.deleteLink(linkId);
      success('Link deleted');
    } catch {
      error('Failed to delete link');
      await loadLinks();
    }
  }, [linksService, success, error, loadLinks]);

  // Loading state
  if (authLoading || isLoading) {
    return (
      <ClientLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      <div className="px-6 lg:px-8 py-6">
        <ContentContainer>
          <h1 className="text-2xl font-bold text-black font-ibm-plex-mono mb-6">Library</h1>

          <Tabs.Root value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
            <Tabs.List className="flex border-b border-gray-200 mb-6">
            <Tabs.Trigger 
              value="intents" 
              className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold"
            >
              My Intents
              {intents.length > 0 && (
                <span className="ml-2 text-xs text-gray-500">({intents.length})</span>
              )}
            </Tabs.Trigger>
            <Tabs.Trigger 
              value="connections" 
              className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold"
            >
              Connections
              {integrations.filter(i => i.connected).length > 0 && (
                <span className="ml-2 text-xs text-gray-500">({integrations.filter(i => i.connected).length})</span>
              )}
            </Tabs.Trigger>
            <Tabs.Trigger 
              value="files" 
              className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold"
            >
              Files
              {files.length > 0 && (
                <span className="ml-2 text-xs text-gray-500">({files.length})</span>
              )}
            </Tabs.Trigger>
            <Tabs.Trigger 
              value="links" 
              className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold"
            >
              Links
              {links.length > 0 && (
                <span className="ml-2 text-xs text-gray-500">({links.length})</span>
              )}
            </Tabs.Trigger>
            <Tabs.Trigger 
              value="negotiations" 
              className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold"
            >
              Negotiations
              {negotiationCount > 0 && (
                <span className="ml-2 text-xs text-gray-500">({negotiationCount})</span>
              )}
            </Tabs.Trigger>
          </Tabs.List>
          <div className="mb-6 space-y-1">
            <div className="text-sm text-gray-700">
              {tabDescriptions[activeTab].description}
            </div>
            <div className="text-xs text-gray-500">
              {tabDescriptions[activeTab].privacy}
            </div>
          </div>

          {/* My Intents Tab */}
          <Tabs.Content value="intents" className="w-full">
            {loadingIntents ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <IntentList
                intents={intents}
                isLoading={loadingIntents}
                emptyMessage="No intents yet"
                onArchiveIntent={handleArchiveIntent}
                className="w-full"
              />
            )}
          </Tabs.Content>

          {/* Negotiations Tab */}
          <Tabs.Content value="negotiations" className="w-full">
            <NegotiationList />
          </Tabs.Content>

          {/* Connections (Integrations) Tab */}
          <Tabs.Content value="connections" className="w-full">
            {loadingIntegrations ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : integrations.length === 0 ? (
              <div className="text-sm text-gray-500 font-ibm-plex-mono py-12 text-center border border-dashed border-gray-200 rounded-lg">
                <p>No integrations available</p>
              </div>
            ) : (
              <div className="space-y-2 w-full">
                {integrations.map((integration) => (
                  <div
                    key={integration.type}
                    className="group flex items-center gap-3 p-3 border border-gray-200 rounded-sm hover:border-gray-300 transition-colors"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img 
                      src={`/integrations/${integration.type}.png`} 
                      width={24} 
                      height={24} 
                      alt={integration.name}
                      className="flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-black">
                        {integration.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {integration.connected ? 'Connected' : 'Not connected'}
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        if (integration.connected) {
                          handleDisconnectIntegration(integration.type);
                        } else {
                          handleConnectIntegration(integration.type);
                        }
                      }}
                      disabled={pendingIntegration === integration.type}
                      className={`relative h-6 w-11 rounded-full transition-colors duration-200 cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${
                        integration.connected ? 'bg-[#006D4B]' : 'bg-gray-300'
                      } ${pendingIntegration === integration.type ? 'opacity-70' : ''}`}
                      aria-pressed={integration.connected}
                      aria-label={`${integration.name} ${integration.connected ? 'connected' : 'disconnected'}`}
                    >
                      <span
                        className={`absolute top-[1px] left-[1px] h-[22px] w-[22px] rounded-full bg-white transition-transform duration-200 shadow-sm ${
                          integration.connected ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                      {pendingIntegration === integration.type && (
                        <span className="absolute inset-0 grid place-items-center">
                          <span
                            className="h-3 w-3 border-2 border-white/70 border-t-transparent rounded-full animate-spin"
                            style={{ marginLeft: integration.connected ? '-20px' : '20px' }}
                          />
                        </span>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Tabs.Content>

          {/* Files Tab */}
          <Tabs.Content value="files" className="w-full">
            {loadingFiles ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : files.length === 0 ? (
              <div className="text-sm text-gray-500 font-ibm-plex-mono py-12 text-center border border-dashed border-gray-200 rounded-lg">
                <p>No files yet</p>
              </div>
            ) : (
              <div className="space-y-2 w-full">
                {files
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                  .map((file) => (
                  <div
                    key={file.id}
                    className="group flex items-center gap-3 p-3 border border-gray-200 rounded-sm hover:border-gray-300 transition-colors"
                  >
                    <span className="text-[10px] px-1.5 py-0.5 border border-gray-200 rounded-sm text-gray-700 bg-gray-50">
                      {getFileCategoryBadge(file.name, file.type)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-black truncate">
                        {file.name}
                      </div>
                      <div className="text-xs text-gray-500">
                        {formatFileSize(Number(file.size))} • {formatDate(file.createdAt).split(',')[0]}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteFile(file.id)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-gray-100 rounded-sm transition-all"
                      aria-label="Delete file"
                    >
                      <Trash2 className="h-4 w-4 text-gray-500 hover:text-red-500" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Tabs.Content>

          {/* Links Tab */}
          <Tabs.Content value="links" className="w-full">
            {loadingLinks ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : links.length === 0 ? (
              <div className="text-sm text-gray-500 font-ibm-plex-mono py-12 text-center border border-dashed border-gray-200 rounded-lg">
                <p>No links yet</p>
              </div>
            ) : (
              <div className="space-y-2 w-full">
                {links
                  .sort((a, b) => {
                    const aTime = a.lastSyncAt || a.createdAt || '';
                    const bTime = b.lastSyncAt || b.createdAt || '';
                    return new Date(bTime).getTime() - new Date(aTime).getTime();
                  })
                  .map((link) => (
                  <div
                    key={link.id}
                    className="group flex items-center gap-3 p-3 border border-gray-200 rounded-sm hover:border-gray-300 transition-colors"
                  >
                    <ExternalLink className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-black truncate">
                        {link.url}
                      </div>
                      <div className="text-xs text-gray-500">
                        {link.lastSyncAt ? formatDate(link.lastSyncAt) : (link.createdAt ? formatDate(link.createdAt) : '')}
                      </div>
                    </div>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-gray-100 rounded-sm transition-all"
                      aria-label="Open link"
                    >
                      <ExternalLink className="h-4 w-4 text-gray-500" />
                    </a>
                    <button
                      onClick={() => handleDeleteLink(link.id)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-gray-100 rounded-sm transition-all"
                      aria-label="Delete link"
                    >
                      <Trash2 className="h-4 w-4 text-gray-500 hover:text-red-500" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            </Tabs.Content>
          </Tabs.Root>
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}
