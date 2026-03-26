import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import * as Tabs from "@radix-ui/react-tabs";
import { Loader2, Trash2, ExternalLink } from "lucide-react";
import { useAuthContext } from "@/contexts/AuthContext";
import { useAPI } from "@/contexts/APIContext";
import { useAuthenticatedAPI } from "@/lib/api";
import { useNotifications } from "@/contexts/NotificationContext";
import { formatDate } from "@/lib/utils";
import { formatFileSize, getFileCategoryBadge } from "@/lib/file-validation";
import IntentList from "@/components/IntentList";
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

const VALID_TABS = ['intents', 'files', 'links'] as const;
type TabValue = typeof VALID_TABS[number];

export default function LibraryPage() {
  const navigate = useNavigate();
  const { tab } = useParams<{ tab?: string }>();
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const { filesService, linksService, intentsService } = useAPI();
  const api = useAuthenticatedAPI();
  const { success, error } = useNotifications();

  const activeTab: TabValue = VALID_TABS.includes(tab as TabValue) ? (tab as TabValue) : 'intents';
  const setActiveTab = (v: string) => navigate(`/library/${v}`, { replace: true });
  const [isLoading, setIsLoading] = useState(true);
  const tabDescriptions = {
    intents: {
      title: "My Intents",
      description:
        "Things that your agent thinks you might be looking for, inferred from your activity. Review them and remove anything that doesn’t feel right.",
      privacy:
        "AI agents use these to surface opportunities and only match when there’s mutual intent."
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
  const [files, setFiles] = useState<FileItem[]>([]);
  const [links, setLinks] = useState<LinkItem[]>([]);

  // Loading states per tab
  const [loadingIntents, setLoadingIntents] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [loadingLinks, setLoadingLinks] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/');
    }
  }, [authLoading, isAuthenticated, navigate]);

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

  // Initial load
  useEffect(() => {
    if (!isAuthenticated || authLoading) return;

    const loadAll = async () => {
      setIsLoading(true);
      await Promise.all([loadIntents(), loadFiles(), loadLinks()]);
      setIsLoading(false);
    };

    loadAll();
  }, [isAuthenticated, authLoading, loadIntents, loadFiles, loadLinks]);

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

          <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
            <Tabs.List className="flex border-b border-gray-200 mb-6">
            <Tabs.Trigger 
              value="intents" 
              className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold"
            >
              Intents
              {intents.length > 0 && (
                <span className="ml-2 text-xs text-gray-500">({intents.length})</span>
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

export const Component = LibraryPage;
