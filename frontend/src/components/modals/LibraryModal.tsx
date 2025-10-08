"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNotifications } from "@/contexts/NotificationContext";
import { useAuthenticatedAPI } from "@/lib/api";
import ReactMarkdown from 'react-markdown';
import { useAPI } from "@/contexts/APIContext";
import { useIndexFilter } from "@/contexts/IndexFilterContext";
import { formatDate } from "@/lib/utils";
import { SyncProviderName } from "@/services/sync";
import IntentList from "@/components/IntentList";
import { IntegrationName } from "@/config/integrations";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged?: () => void; // ask parent to refresh after any action
};

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

export default function LibraryModal({ open, onOpenChange, onChanged }: Props) {
  const { success, error } = useNotifications();
  const api = useAuthenticatedAPI();
  const { syncService } = useAPI();
  const { selectedIndexIds } = useIndexFilter();
  const [isUploading, setIsUploading] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [isAddingLink, setIsAddingLink] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Array<{ id: string; name: string; size: string; type: string; createdAt: string; url: string }>>([]);
  const [links, setLinks] = useState<Array<{ id: string; url: string; createdAt?: string; lastSyncAt?: string | null; lastStatus?: string | null; lastError?: string | null; contentUrl?: string }>>([]);
  const [preview, setPreview] = useState<{ id: string; title: string; content?: string } | null>(null);
  const [syncingIntegrations, setSyncingIntegrations] = useState<Set<string>>(new Set());
  const [syncingLinks, setSyncingLinks] = useState<Set<string>>(new Set());
  const [libraryIntents, setLibraryIntents] = useState<LibrarySourceIntent[]>([]);
  const [isLoadingIntents, setIsLoadingIntents] = useState(false);
  const [newIntentIds, setNewIntentIds] = useState<Set<string>>(new Set());
  const [activeMobileSection, setActiveMobileSection] = useState<'library' | 'intents'>('library');
  const [showIntentsPanel, setShowIntentsPanel] = useState(false);
  const highlightTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const knownIntentIds = useRef<Set<string>>(new Set());
  const connectSourcesRef = useRef<HTMLDivElement | null>(null);

  // Enhance UX: select and undo state
  const [, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<{
    open: boolean;
    message: string;
    payload: { kind: 'file' | 'link'; item: { id: string; name?: string; url?: string } }[];
    intentIds: string[];
    archiveIntents: boolean;
  } | null>(null);
  const relatedIntentCount = confirm?.intentIds.length ?? 0;
  const [integrations, setIntegrations] = useState<Array<{ 
    id: string | null;           // The actual integration UUID
    type: IntegrationName;       // The integration type (slack, discord, etc.)
    name: string; 
    connected: boolean;
    indexId?: string | null;
  }>>([]);
  const [integrationsLoaded, setIntegrationsLoaded] = useState(false);
  const [pendingIntegration, setPendingIntegration] = useState<null | IntegrationName>(null);
  
  // Source filtering state - now supports multiple sources
  const [activeSourceFilters, setActiveSourceFilters] = useState<Set<string>>(new Set());

  const loadLists = useCallback(async () => {
    try {
      const [f, l] = await Promise.all([
        api.get<{ files: typeof files }>(`/files`).then(r => r.files || []),
        api.get<{ links: typeof links }>(`/links`).then(r => r.links || [])
      ]);
      setFiles(f);
      setLinks(l);
    } catch {}
  }, [api]);

  const toggleSelected = useCallback((id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const { visibleIntents, isSelectionFiltering, selectedIntentIds, isSourceFiltering } = useMemo(() => {
    if (libraryIntents.length === 0) {
      return { visibleIntents: libraryIntents, isSelectionFiltering: false, selectedIntentIds: new Set<string>(), isSourceFiltering: false } as const;
    }

    const fileLabelById = new Map(files.map(f => [f.id, f.name]));
    const linkUrlById = new Map(links.map(l => [l.id, l.url]));

    const selectedFileIds = new Set<string>();
    const selectedFileNames = new Set<string>();
    const selectedLinkIds = new Set<string>();
    const selectedLinkUrls = new Set<string>();

    selectedIds.forEach(token => {
      if (token.startsWith('f-')) {
        const id = token.slice(2);
        selectedFileIds.add(id);
        const name = fileLabelById.get(id);
        if (name) selectedFileNames.add(name);
      } else if (token.startsWith('l-')) {
        const id = token.slice(2);
        selectedLinkIds.add(id);
        const url = linkUrlById.get(id);
        if (url) selectedLinkUrls.add(url);
      }
    });

    const selectionActive = selectedFileIds.size > 0 || selectedLinkIds.size > 0 || selectedFileNames.size > 0 || selectedLinkUrls.size > 0;
    const sourceFilterActive = activeSourceFilters.size > 0;

    // If no filtering is active, show all intents
    if (!selectionActive && !sourceFilterActive) {
      return { visibleIntents: libraryIntents, isSelectionFiltering: false, selectedIntentIds: new Set<string>(), isSourceFiltering: false } as const;
    }

    const matchedIds = new Set<string>();
    const filtered: LibrarySourceIntent[] = [];

    for (const intent of libraryIntents) {
      let matches = false;

      // Check file/link selection filtering
      const matchesFile = intent.sourceType === 'file' && (
        (intent.sourceId && selectedFileIds.has(intent.sourceId)) ||
        (intent.sourceName && selectedFileNames.has(intent.sourceName)) ||
        (intent.sourceValue && selectedFileIds.has(intent.sourceValue))
      );

      const matchesLink = intent.sourceType === 'link' && (
        (intent.sourceId && selectedLinkIds.has(intent.sourceId)) ||
        (intent.sourceValue && selectedLinkUrls.has(intent.sourceValue)) ||
        (intent.sourceName && selectedLinkUrls.has(intent.sourceName))
      );

      const matchesSource = intent.sourceType === 'integration' && intent.sourceValue && activeSourceFilters.has(intent.sourceValue);

      // Apply filtering logic: show intents that match ANY active filter
      if (selectionActive && sourceFilterActive) {
        // Both filters active: show intents that match file/link selection OR source filter
        matches = Boolean((matchesFile || matchesLink) || matchesSource);
      } else if (selectionActive) {
        // Only file/link selection active
        matches = Boolean(matchesFile || matchesLink);
      } else if (sourceFilterActive) {
        // Only source filter active
        matches = Boolean(matchesSource);
      }

      if (matches) {
        filtered.push(intent);
        matchedIds.add(intent.id);
      }
    }

    return { 
      visibleIntents: filtered, 
      isSelectionFiltering: selectionActive, 
      selectedIntentIds: matchedIds,
      isSourceFiltering: sourceFilterActive
    } as const;
  }, [files, links, libraryIntents, selectedIds, activeSourceFilters]);

  const finalizeDeletion = useCallback(async (batch: { kind: 'file' | 'link'; item: { id: string } }[], intentIds: string[] = []) => {
    try {
      const deletions = batch.map(({ kind, item }) => kind === 'file'
        ? api.delete(`/files/${item.id}`)
        : api.delete(`/links/${item.id}`)
      );
      const uniqueIntentIds = Array.from(new Set(intentIds));
      if (uniqueIntentIds.length > 0) {
        uniqueIntentIds.forEach(id => {
          deletions.push(api.patch(`/intents/${id}/archive`));
        });
      }
      await Promise.all(deletions);
      const baseMessage = batch.length === 1 ? 'Item deleted' : `${batch.length} items deleted`;
      const intentMessage = uniqueIntentIds.length > 0 ? `; ${uniqueIntentIds.length} related intent${uniqueIntentIds.length === 1 ? '' : 's'} archived` : '';
      success(`${baseMessage}${intentMessage}`);
      onChanged?.();
    } catch {
      error('Failed to delete some items or archive related intents');
    }
  }, [api, success, error, onChanged]);


  const queueDeletion = useCallback((items: { kind: 'file' | 'link'; item: { id: string } }[], intentIds: string[] = []) => {
    // Remove items immediately from UI
    const fileIds = new Set(items.filter(i => i.kind === 'file').map(i => i.item.id));
    const linkIds = new Set(items.filter(i => i.kind === 'link').map(i => i.item.id));
    if (fileIds.size > 0) setFiles(prev => prev.filter(f => !fileIds.has(f.id)));
    if (linkIds.size > 0) setLinks(prev => prev.filter(l => !linkIds.has(l.id)));

    if (intentIds.length > 0) {
      const idSet = new Set(intentIds);
      setLibraryIntents(prev => prev.filter(intent => !idSet.has(intent.id)));
      finalizeDeletion(items, intentIds);
      return;
    }

    // Delete immediately
    finalizeDeletion(items);
  }, [finalizeDeletion]);

  const findRelatedIntentIds = useCallback((items: { kind: 'file' | 'link'; item: { id: string; url?: string } }[]) => {
    if (items.length === 0 || libraryIntents.length === 0) return [];
    const fileIds = new Set<string>();
    const linkIds = new Set<string>();
    const linkUrls = new Set<string>();

    items.forEach(({ kind, item }) => {
      if (kind === 'file') fileIds.add(item.id);
      else {
        linkIds.add(item.id);
        if (item.url) linkUrls.add(item.url);
      }
    });

    return libraryIntents.reduce<string[]>((acc, intent) => {
      if (intent.sourceType === 'file' && intent.sourceId && fileIds.has(intent.sourceId)) acc.push(intent.id);
      else if (intent.sourceType === 'link') {
        const matchById = intent.sourceId && linkIds.has(intent.sourceId);
        const matchByUrl = intent.sourceValue && linkUrls.has(intent.sourceValue);
        if (matchById || matchByUrl) acc.push(intent.id);
      }
      return acc;
    }, []);
  }, [libraryIntents]);

  const handleSingleDelete = useCallback((item: RecentItem) => {
    const payload = [{ kind: item.kind, item: item.raw }];
    const intentIds = findRelatedIntentIds(payload);
    setConfirm({
      open: true,
      message: 'Remove this item from your Library?',
      payload,
      intentIds,
      archiveIntents: intentIds.length > 0,
    });
  }, [findRelatedIntentIds]);

  const handleBulkDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    // Build payload from current state
    const payload: { kind: 'file' | 'link'; item: { id: string; name?: string; url?: string; size?: string; type?: string; createdAt?: string; lastSyncAt?: string | null; lastStatus?: string | null; lastError?: string | null; contentUrl?: string } }[] = [];
    files.forEach(f => { if (selectedIds.has(`f-${f.id}`)) payload.push({ kind: 'file', item: f }); });
    links.forEach(l => { if (selectedIds.has(`l-${l.id}`)) payload.push({ kind: 'link', item: l }); });
    setSelectedIds(new Set());
    setSelectMode(false);
    if (payload.length > 0) {
      const intentIds = findRelatedIntentIds(payload);
      setConfirm({
        open: true,
        message: `Remove ${payload.length} item(s) from your Library?`,
        payload,
        intentIds,
        archiveIntents: intentIds.length > 0,
      });
    }
  }, [files, links, selectedIds, findRelatedIntentIds]);

  // Integrations (compact section)
  const loadIntegrations = useCallback(async () => {
    try {
      const response = await api.get<{ 
        integrations: Array<{ 
          id: string; // integrationId (UUID)
          type: string; // integration type (slack, discord, etc.)
          name: string; 
          connected: boolean; 
          indexId?: string | null;
        }>;
        availableTypes: Array<{
          type: string;
          name: string;
          toolkit: string;
        }>;
      }>('/integrations');
      
      const connectedIntegrations = response.integrations || [];
      const availableTypes = response.availableTypes || [];
      
      // Create integration state combining connected and available types
      const updatedIntegrations = availableTypes.map(availableType => {
        const connectedIntegration = connectedIntegrations.find(i => i.type === availableType.type);
        return {
          id: connectedIntegration?.id || null, // The actual UUID
          type: availableType.type as IntegrationName, // The integration type
          name: availableType.name,
          connected: !!connectedIntegration,
          indexId: connectedIntegration?.indexId || null
        };
      });
      
      setIntegrations(updatedIntegrations);
      setIntegrationsLoaded(true);
    } catch (error) {
      console.error('Failed to fetch integrations:', error);
      // Keep default state if API fails
      setIntegrationsLoaded(true);
    }
  }, [api]);


  const loadLibraryIntents = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    try {
      if (!silent) setIsLoadingIntents(true);
      const res = await api.get<{ intents?: LibrarySourceIntent[] }>(`/intents/library`);
      const incoming = res.intents ?? [];

      const prevIds = knownIntentIds.current;
      const nextIds = new Set(incoming.map(item => item.id));
      const isInitialLoad = prevIds.size === 0;

      if (!isInitialLoad) {
        const freshIds = incoming.filter(item => !prevIds.has(item.id)).map(item => item.id);
        if (freshIds.length > 0) {
          setNewIntentIds(prev => {
            const next = new Set(prev);
            freshIds.forEach(id => next.add(id));
            return next;
          });
          freshIds.forEach(id => {
            const existing = highlightTimers.current.get(id);
            if (existing) clearTimeout(existing);
            const timeout = setTimeout(() => {
              setNewIntentIds(prev => {
                if (!prev.has(id)) return prev;
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
              highlightTimers.current.delete(id);
            }, 6000);
            highlightTimers.current.set(id, timeout);
          });
        }
      }

      knownIntentIds.current = nextIds;
      setLibraryIntents(incoming);
    } catch {
      setLibraryIntents([]);
    } finally {
      if (!silent) setIsLoadingIntents(false);
    }
  }, [api]);

  const handleJumpToSources = useCallback(() => {
    setActiveMobileSection('library');
    requestAnimationFrame(() => {
      connectSourcesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const handleArchiveIntent = useCallback(async (intent: LibrarySourceIntent) => {
    try {
      await api.patch(`/intents/${intent.id}/archive`);
      success('Intent archived');
      // Refresh intents after archiving
      await loadLibraryIntents();
    } catch {
      error('Failed to archive intent');
    }
  }, [api, success, error, loadLibraryIntents]);

  const handleOpenIntentSource = useCallback((intent: LibrarySourceIntent) => {
    if (intent.sourceType === 'link' && intent.sourceValue && /^https?:/i.test(intent.sourceValue)) {
      window.open(intent.sourceValue, '_blank', 'noopener');
      return;
    }
    handleJumpToSources();
  }, [handleJumpToSources]);


  const toggleIntegration = useCallback(async (type: IntegrationName) => {
    const item = integrations.find(i => i.type === type);
    if (!item) return;
    try {
      setPendingIntegration(type);
      if (item.connected && item.id) {
        // Disconnect using integration UUID
        await api.delete(`/integrations/${item.id}`);
        setIntegrations(prev => prev.map(x => x.type === type ? { ...x, connected: false, id: null } : x));
        success(`${item.name} disconnected`);
      } else {
        const popup = typeof window !== 'undefined' ? window.open('', `oauth_${type}`, 'width=560,height=720') : null;
        const res = await api.post<{ redirectUrl?: string; integrationId?: string }>(`/integrations/connect/${type}`, { indexId: selectedIndexIds[0] });
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
              return;
            }
            
            try {
              const s = await api.get<{ status: 'pending' | 'connected'; connectedAt?: string }>(
                `/integrations/${integrationId}/status`
              );
              
              if (s.status === 'connected') {
                clearInterval(poll);
                if (popup && !popup.closed) popup.close();
                setIntegrations(prev => prev.map(x => x.type === type ? { ...x, connected: true, id: integrationId } : x));
                // Auto-filter the newly connected integration
                setActiveSourceFilters(prev => new Set([...prev, type]));
                success(`${item.name} connected`);
              }
              if (Date.now() - started > 90000) {
                clearInterval(poll);
                if (popup && !popup.closed) popup.close();
                error('Connection timeout - please try again');
              }
            } catch (err) {
              console.error('Error checking connection status:', err);
            }
          }, 1500);
        }
      }
    } catch {
      // ignore
    } finally {
      setPendingIntegration(null);
    }
  }, [api, integrations, success, error, selectedIndexIds]);

  const handleSourceFilter = useCallback((integrationType: string) => {
    setActiveSourceFilters(prev => {
      const next = new Set(prev);
      if (next.has(integrationType)) {
        // If already filtering by this source, remove it
        next.delete(integrationType);
      } else {
        // Add this source to the filter
        next.add(integrationType);
      }
      return next;
    });
    // Switch to intents view to show the filtered results
    setActiveMobileSection('intents');
  }, []);

  const handleFilesSelected = useCallback(async (f: FileList | null) => {
    if (!f || f.length === 0) return;
    setIsUploading(true);
    try {
      const uploadedFiles = await Promise.all(Array.from(f).map(async file => {
        const res = await api.uploadFile<{ file: { id: string; name: string; size: string; type: string; createdAt: string; url: string } }>(`/files`, file);
        return res.file;
      }));
      
      onChanged?.();
      await loadLists();
      await loadLibraryIntents();
      
      // Auto-select the newly uploaded files
      const newFileIds = uploadedFiles.map(file => `f-${file.id}`);
      setSelectedIds(prev => new Set([...prev, ...newFileIds]));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [api, onChanged, loadLists, loadLibraryIntents]);

  const handleAddLink = useCallback(async () => {
    if (!linkUrl) return;
    
    // Normalize URL - add https:// if no protocol is specified
    let normalizedUrl = linkUrl.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = `https://${normalizedUrl}`;
    }
    
    try {
      setIsAddingLink(true);
      const res = await api.post<{ link: { id: string; url: string; createdAt?: string; lastSyncAt?: string | null; lastStatus?: string | null; lastError?: string | null; contentUrl?: string } }>(`/links`, { url: normalizedUrl });
      setLinkUrl("");
      onChanged?.();
      await loadLists();
      await loadLibraryIntents();
      
      // Auto-select the newly added link
      if (res.link?.id) {
        setSelectedIds(prev => new Set([...prev, `l-${res.link.id}`]));
      }
      
      success('Link added successfully');
    } catch {
      error('Failed to add link. Please check the URL and try again.');
    } finally {
      setIsAddingLink(false);
    }
  }, [api, linkUrl, onChanged, loadLists, loadLibraryIntents, success, error]);

  const handleSyncIntegration = useCallback(async (integrationType: string) => {
    try {
      setSyncingIntegrations(prev => new Set([...prev, integrationType]));
      
      // Find the connected integration for this type
      const connectedIntegration = integrations.find(i => i.type === integrationType && i.connected);
      if (!connectedIntegration?.id) {
        error(`${integrationType} is not connected`);
        return;
      }
      
      await syncService.syncIntegration(integrationType as SyncProviderName, connectedIntegration.id);
      success(`${integrationType.charAt(0).toUpperCase() + integrationType.slice(1)} sync started`);
    } catch {
      error(`Failed to sync ${integrationType}`);
    } finally {
      await loadLibraryIntents();
      setSyncingIntegrations(prev => {
        const next = new Set(prev);
        next.delete(integrationType);
        return next;
      });
    }
  }, [syncService, integrations, success, error, loadLibraryIntents]);

  const totalIntentCount = libraryIntents.length;
  const displayedIntentCount = (isSelectionFiltering || isSourceFiltering) ? visibleIntents.length : totalIntentCount;
  const intentCountLabel = (isSelectionFiltering || isSourceFiltering) ? `${displayedIntentCount} of ${totalIntentCount}` : `${displayedIntentCount}`;

  const handleSyncLink = useCallback(async (linkId: string) => {
    try {
      setSyncingLinks(prev => new Set([...prev, linkId]));
      await syncService.syncLink(linkId);
      success('Link sync started');
    } catch {
      error('Failed to sync link');
    } finally {
      await loadLibraryIntents();
      setSyncingLinks(prev => {
        const next = new Set(prev);
        next.delete(linkId);
        return next;
      });
    }
  }, [syncService, success, error, loadLibraryIntents]);


  // Fetch once per open (ignore function identity changes)
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      wasOpen.current = true;
      loadLists();
      loadIntegrations();
      loadLibraryIntents();
    }
    if (!open && wasOpen.current) {
      wasOpen.current = false;
    }
    // Intentionally omit deps to avoid re-fetch noise
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) {
      knownIntentIds.current = new Set();
      setNewIntentIds(() => new Set());
      highlightTimers.current.forEach(clearTimeout);
      highlightTimers.current.clear();
      return;
    }
    setActiveMobileSection('library');
    const interval = setInterval(() => {
      void loadLibraryIntents({ silent: true });
    }, 5000);
    return () => clearInterval(interval);
  }, [open, loadLibraryIntents]);

  useEffect(() => () => {
    highlightTimers.current.forEach(clearTimeout);
    highlightTimers.current.clear();
  }, []);

  useEffect(() => {
    if (!open) return;
    if (isSelectionFiltering) setActiveMobileSection('intents');
  }, [isSelectionFiltering, open]);

  // Auto-toggle intents panel based on filtering state
  useEffect(() => {
    if (!open) return;
    const hasActiveFiltering = isSelectionFiltering || isSourceFiltering;
    if (hasActiveFiltering && !showIntentsPanel) {
      // Show panel when filtering becomes active
      setShowIntentsPanel(true);
    } else if (!hasActiveFiltering && showIntentsPanel) {
      // Hide panel when no filtering is active
      setShowIntentsPanel(false);
    }
  }, [isSelectionFiltering, isSourceFiltering, showIntentsPanel, open]);

  // no index context needed for library mode

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 animate-in fade-in duration-200" />
        <Dialog.Content className={`library-modal fixed inset-0 w-screen h-[100dvh] p-4 rounded-none bg-[#FAFAFA] border border-[#E0E0E0] text-gray-900 shadow-lg focus:outline-none overflow-hidden overflow-x-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[96vw] sm:h-auto sm:max-h-[85vh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-sm sm:p-6 transition-all sm:duration-300 ${showIntentsPanel ? 'sm:max-w-[1144px]' : 'sm:max-w-[804px]'}`}>
          <div className="flex items-center justify-between mb-2 sm:mb-3 sticky top-0 bg-[#FAFAFA] z-10">
            <div>
              <Dialog.Title className="text-xl font-bold text-[#333] font-ibm-plex-mono">Library</Dialog.Title>
              <p className="text-sm text-[#666] font-ibm-plex-mono mt-1">Add files, links, and integrations to generate intents.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onOpenChange(false)}
                className="p-1 hover:bg-[#F0F0F0] rounded-sm cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
                aria-label="Close modal"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#666] hover:text-[#333] transition-colors duration-150 ease-in-out">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>

          <div className="lg:hidden mb-3 mt-4 flex items-center gap-2 rounded-sm bg-[#F2F2F2] p-1">
            <button
              type="button"
              className={`relative flex-1 px-3 py-1.5 text-xs font-ibm-plex-mono rounded-sm transition-colors ${activeMobileSection === 'library' ? 'bg-white text-[#222] shadow-sm' : 'text-[#555]'}`}
              onClick={() => setActiveMobileSection('library')}
            >
              Library
            </button>
            <button
              type="button"
              className={`relative flex-1 px-3 py-1.5 text-xs font-ibm-plex-mono rounded-sm transition-colors ${activeMobileSection === 'intents' ? 'bg-white text-[#222] shadow-sm' : 'text-[#555]'}`}
              onClick={() => setActiveMobileSection('intents')}
            >
              Intents
              <span className="ml-1 text-[10px] text-[#666]">({intentCountLabel})</span>
              {newIntentIds.size > 0 && (
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-[#0A8F5A]"></span>
              )}
            </button>
          </div>

          <div className="relative flex flex-col lg:flex-row gap-3.5 lg:gap-4 flex-1 overflow-hidden mt-4 lg:mt-6">
            <div className={`${activeMobileSection === 'library' ? 'block' : 'hidden'} lg:block lg:w-[744px] lg:flex-shrink-0 min-w-0`}
            >
              <div className="space-y-2 sm:space-y-3 lg:space-y-4">

            {/* Connect your sources */}
            <section ref={connectSourcesRef} className="pr-2">
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="text-sm font-bold font-ibm-plex-mono text-[#333]">Connect Sources</h3>
              </div>

              <div className="grid grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-3 gap-1.5 sm:gap-3">
                {integrations.map((it) => {
                  const isFiltered = activeSourceFilters.has(it.type);
                  // Count intents from this integration that are currently visible in the filtered results
                  const intentCount = it.connected ? visibleIntents.filter(intent => 
                    intent.sourceType === 'integration' && intent.sourceValue === it.type
                  ).length : 0;
                  
                  return (
                    <div 
                      key={it.type} 
                      className={`flex flex-col gap-2 border border-black border-b-2 rounded-none px-2.5 py-2 transition-colors md:px-3 md:py-2.5 ${
                        it.connected ? 'cursor-pointer' : 'cursor-default'
                      } ${
                        isFiltered 
                          ? 'border-[#007EFF] bg-[#F0F7FF] shadow-sm shadow-[rgba(0,126,255,0.16)]' 
                          : intentCount > 0
                            ? 'border-black bg-[#F8F9FA] hover:bg-[#F0F0F0] hover:border-black'
                            : 'border-black bg-[#FAFAFA] hover:bg-[#F0F0F0] hover:border-black'
                      }`}
                      onClick={() => it.connected && handleSourceFilter(it.type)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/integrations/${it.type}.png`} width={20} height={20} alt="" />
                          <span className="text-xs font-medium text-[#333] font-ibm-plex-mono">{it.name}</span>
                          {it.connected && isFiltered && intentCount > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#E6F2FF] text-[#005BBF] font-ibm-plex-mono">
                              {intentCount}
                            </span>
                          )}
                          {integrationsLoaded && it.connected && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSyncIntegration(it.type);
                              }}
                              disabled={syncingIntegrations.has(it.type)}
                              className="group p-1 hover:bg-[#F0F0F0] rounded-sm cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
                              aria-label={`Sync ${it.name}`}
                            >
                              {syncingIntegrations.has(it.type) ? (
                                <div className="w-[14px] h-[14px] flex items-center justify-center">
                                  <span className="h-3.5 w-3.5 border-2 border-[#666] border-t-transparent rounded-full animate-spin inline-block" />
                                </div>
                              ) : (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#666] group-hover:text-[#333] transition-colors duration-150 ease-in-out">
                                  <polyline points="23 4 23 10 17 10"></polyline>
                                  <polyline points="1 20 1 14 7 14"></polyline>
                                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                                </svg>
                              )}
                            </button>
                          )}
                        </span>
                        <div className="flex items-center gap-1">
                          {!integrationsLoaded ? (
                            // Show loading placeholder for toggle only
                            <div className="w-11 h-6 bg-[#F5F5F5] rounded-full animate-pulse" />
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleIntegration(it.type);
                              }}
                              disabled={pendingIntegration === it.type}
                              className={`relative h-5 w-9 rounded-full transition-colors duration-200 cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0 ${
                                it.connected ? 'bg-[#006D4B]' : 'bg-[#D9D9D9]'
                              } ${pendingIntegration === it.type ? 'opacity-70' : ''}`}
                              aria-pressed={it.connected}
                              aria-busy={pendingIntegration === it.type}
                              aria-label={`${it.name} ${it.connected ? 'connected' : 'disconnected'}`}
                            >
                              <span
                                className={`absolute top-[1px] left-[1px] h-[18px] w-[18px] rounded-full bg-white transition-transform duration-200 shadow-sm`}
                              style={{ transform: it.connected ? 'translateX(16px)' : 'translateX(0px)' }}
                            />
                            {pendingIntegration === it.id && (
                              <span className="absolute inset-0 grid place-items-center">
                                <span className="h-2.5 w-2.5 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
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
            </section>

            {/* Add new content */}
            <section className="pr-2">
              <div className="flex items-center justify-between mb-2 min-h-[40px]">
                <h3 className="text-sm font-bold font-ibm-plex-mono text-[#333]">Files and URLs</h3>
                <div className="flex items-center gap-3">
                  {selectedIds.size > 0 && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs border-[#E0E0E0] text-[#444] hover:bg-[#F5F5F5] font-ibm-plex-mono rounded-sm focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
                        onClick={() => handleBulkDelete()}
                      >
                        Delete ({selectedIds.size})
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs border-[#DDDDDD] text-[#333] hover:bg-[#F0F0F0] font-ibm-plex-mono rounded-sm focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
                        onClick={() => setSelectedIds(new Set())}
                      >
                        Clear
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
                {/* File upload */}
                <div className="border border-[#E0E0E0] rounded-sm">
                  <div className="relative w-full">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      id="library-file-upload"
                      onChange={(e) => handleFilesSelected(e.target.files)}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="w-full h-10 px-3 py-2 text-sm font-ibm-plex-mono bg-white text-[#333] hover:bg-[#F0F0F0] transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0 rounded-sm flex items-center justify-center gap-1.5"
                    >
                      {isUploading ? (
                        <>
                          <span className="h-4 w-4 border-2 border-[#DDDDDD] border-t-transparent rounded-full animate-spin" />
                          Uploading…
                        </>
                      ) : (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="text-[#666]">
                            <path d="M12 5v14"></path>
                            <path d="M5 12h14"></path>
                          </svg>
                          Upload files
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Link input */}
                <div className="border border-[#E0E0E0] rounded-sm">
                  <div className="relative w-full">
                    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-sm pointer-events-none">
                      🔗
                    </span>
                    <Input
                      placeholder="Paste URL here"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddLink(); }}
                      className="text-sm bg-white rounded-sm font-ibm-plex-mono w-full pl-10 pr-10 focus:ring-2 focus:ring-[rgba(0,0,0,0.1)] border-0"
                    />
                    {isAddingLink ? (
                      <div className="absolute right-3 top-1/2 transform -translate-y-1/2 w-6 h-6 border-2 border-[#DDDDDD] border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <button
                        onClick={handleAddLink}
                        disabled={!linkUrl}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 hover:bg-[#F0F0F0] rounded-sm cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
                        aria-label="Add URL"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#666]">
                          <line x1="12" y1="5" x2="12" y2="19"></line>
                          <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Library items */}
            <section className="pr-2">
              <div className="space-y-2 max-h-[45vh] sm:h-[400px] overflow-y-auto pb-8">
                {(() => {
                  type RecentItem = { id: string; kind: 'file' | 'link'; title: string; sub: string; onClick?: () => void | Promise<void>; createdAt: number; raw: { id: string; name?: string; url?: string; type?: string; createdAt?: string; lastSyncAt?: string | null } };
                  const map: RecentItem[] = [
                    ...files.map(f => ({
                      id: `f-${f.id}`,
                      kind: 'file' as const,
                      title: f.name,
                      sub: `${formatSize(f.size)} • ${formatDate(f.createdAt).split(',')[0]}`,
                      createdAt: new Date(f.createdAt).getTime(),
                      raw: f,
                    })),
                    ...links.map(l => ({
                      id: `l-${l.id}`,
                      kind: 'link' as const,
                      title: l.url,
                      sub: l.lastSyncAt ? formatDate(l.lastSyncAt) : (l.createdAt ? formatDate(l.createdAt) : ''),
                      onClick: async () => {
                        const id = l.id;
                        setPreview({ id, title: l.url });
                        const res = await api.get<{ content?: string; pending?: boolean; url?: string; lastStatus?: string | null; lastSyncAt?: string | null }>(`/links/${id}/content`);
                        if (res?.content) setPreview({ id, title: l.url, content: res.content });
                      },
                      createdAt: (l.lastSyncAt ? new Date(l.lastSyncAt).getTime() : (l.createdAt ? new Date(l.createdAt).getTime() : 0)),
                      raw: l,
                    })),
                  ];
                  const filtered = map;
                  const recent = filtered.sort((a,b) => a.createdAt < b.createdAt ? 1 : -1);
                  if (recent.length === 0) return <div className="text-sm text-[#666]">No items yet.</div>;
                  return recent.map(item => (
                    <div
                      key={item.id}
                      className={`w-full border rounded-sm px-2.5 py-2 transition-colors cursor-pointer md:px-3 ${
                        selectedIds.has(item.id)
                          ? 'border-[#99CFFF] bg-[#F0F7FF]'
                          : 'border-[#E0E0E0] bg-white hover:border-[#CCCCCC]'
                      }`}
                      onClick={() => toggleSelected(item.id, !selectedIds.has(item.id))}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {selectedIds.has(item.id) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSelected(item.id, !selectedIds.has(item.id));
                              }}
                              className="h-4 w-4 border border-[#007EFF] bg-[#007EFF] rounded-[4px] flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,126,255,0.35)] focus-visible:ring-offset-0"
                              aria-label={`Select ${item.kind}`}
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                                <polyline points="20,6 9,17 4,12"></polyline>
                              </svg>
                            </button>
                          )}
                          {item.kind === 'file' && (
                            <span className="text-[10px] px-1.5 py-0.5 border border-[#E0E0E0] rounded-sm font-ibm-plex-mono text-[#333] bg-[#F5F5F5]">
                              {fileBadge(item.raw.type, item.raw.name || '')}
                            </span>
                          )}
                          {/* Icon for links only */}
                          {item.kind === 'link' && (
                            <div className="flex-shrink-0">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#666]">
                                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                              </svg>
                            </div>
                          )}
                          <span className="text-sm text-[#333] truncate font-medium">{item.title}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {item.kind === 'link' && (
                            <>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleSyncLink(item.raw.id);
                                }} 
                                className="group p-1 hover:bg-[#F0F0F0] rounded-sm cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0" 
                                disabled={syncingLinks.has(item.raw.id)}
                                aria-label="Sync link"
                              >
                                {syncingLinks.has(item.raw.id) ? (
                                  <span className="h-3.5 w-3.5 border-2 border-[#666] border-t-transparent rounded-full animate-spin inline-block" />
                                ) : (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#666] group-hover:text-[#333] transition-colors duration-150 ease-in-out">
                                    <polyline points="23 4 23 10 17 10"></polyline>
                                    <polyline points="1 20 1 14 7 14"></polyline>
                                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                                  </svg>
                                )}
                              </button>
                            </>
                          )}
                          <button
                            className="group p-1 hover:bg-[#F0F0F0] rounded-sm cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSingleDelete(item);
                            }}
                            aria-label={`Delete ${item.kind}`}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#666] group-hover:text-[#333] transition-colors duration-150 ease-in-out">
                              <polyline points="3,6 5,6 21,6"></polyline>
                              <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                              <line x1="10" y1="11" x2="10" y2="17"></line>
                              <line x1="14" y1="11" x2="14" y2="17"></line>
                            </svg>
                          </button>
                        </div>
                      </div>
                      <div className="text-xs text-[#666] mt-1 truncate font-ibm-plex-mono">
                        {String(item.sub)}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </section>
              </div>
            </div>
            <aside className={`${activeMobileSection === 'intents' ? 'flex flex-col' : 'hidden'} pr-3 lg:flex lg:flex-col w-full flex-shrink-0 bg-[#FAFAFA] shadow-[0_1px_3px_rgba(15,23,42,0.08)] max-h-[70vh] lg:max-h-none overflow-x-hidden ease-out ${showIntentsPanel ? 'lg:opacity-100 lg:w-[340px] transition-all duration-150' : 'lg:opacity-0 lg:pointer-events-none lg:w-0 lg:overflow-hidden transition-none'}`}>
                <div className="flex items-center justify-between pb-2 border-b border-[#E4E4E4] pl-3 pr-3">
                  <h3 className="text-sm font-bold font-ibm-plex-mono text-[#333]">Intents</h3>
                  <div className="flex items-center gap-2">
                    {isSourceFiltering && (
                      <button
                        onClick={() => setActiveSourceFilters(new Set())}
                        className="text-[10px] px-2 py-1 rounded-sm bg-[#F0F0F0] text-[#666] hover:bg-[#E6E6E6] transition-colors font-ibm-plex-mono"
                        aria-label="Clear source filters"
                      >
                        Clear
                      </button>
                    )}
                    <span className="text-xs text-[#666] font-ibm-plex-mono">{intentCountLabel}</span>
                  </div>
                </div>
                <div className="pt-3 flex-1 pr-3 space-y-3 p-3 pt-0 overflow-y-scroll">
                  <IntentList
                    intents={visibleIntents}
                    isLoading={isLoadingIntents}
                    emptyMessage={
                      isSelectionFiltering && isSourceFiltering ? 
                        `No intents match the selected sources and ${Array.from(activeSourceFilters).map(id => integrations.find(i => i.id === id)?.name).filter(Boolean).join(', ')}.` :
                        isSourceFiltering ? 
                          `No intents from ${Array.from(activeSourceFilters).map(id => integrations.find(i => i.id === id)?.name).filter(Boolean).join(', ')} yet.` :
                          isSelectionFiltering ? 'No intents match the selected sources.' : 'No intents yet.'
                    }
                    onArchiveIntent={handleArchiveIntent}
                    onOpenIntentSource={handleOpenIntentSource}
                    newIntentIds={newIntentIds}
                    selectedIntentIds={selectedIntentIds}
                  />
                </div>
            </aside>
          </div>

          {/* Link Preview */}
          <Dialog.Root open={!!preview} onOpenChange={(v) => { if (!v) setPreview(null); }}>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 bg-black/40" />
              <Dialog.Content className="fixed inset-0 w-screen h-[100dvh] p-4 rounded-none bg-[#FAFAFA] border border-[#E0E0E0] shadow-lg overflow-auto sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[90vw] sm:max-w-[760px] sm:max-h-[80vh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-sm sm:p-5">
                <Dialog.Title className="text-base font-bold font-ibm-plex-mono text-[#333] mb-3">{preview?.title}</Dialog.Title>
                {!preview?.content ? (
                  <div className="text-sm text-[#666]">Loading content…</div>
                ) : (
                  <div className="prose prose-sm max-w-none text-[#333]">
                    <ReactMarkdown>{preview.content}</ReactMarkdown>
                  </div>
                )}
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>



          {/* Styled Confirm Dialog */}
          <Dialog.Root open={!!confirm?.open} onOpenChange={(v) => { if (!v) setConfirm(null); }}>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 bg-black/40" />
              <Dialog.Content className="fixed inset-x-0 bottom-0 mx-auto w-[92vw] max-w-[440px] rounded-t-lg bg-[#FAFAFA] border border-[#E0E0E0] text-gray-900 p-4 shadow-lg sm:left-1/2 sm:top-1/2 sm:inset-auto sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-sm sm:p-5">
                <Dialog.Title className="text-lg font-bold mb-2 font-ibm-plex-mono text-[#333]">Confirm Delete</Dialog.Title>
                <p className="text-sm text-[#444] mb-2">{confirm?.message}</p>
                {relatedIntentCount > 0 ? (
                  <label className="flex items-start gap-2 text-sm text-[#444] mb-4">
                    <input
                      type="checkbox"
                      checked={Boolean(confirm?.archiveIntents)}
                      onChange={(e) => setConfirm(prev => prev ? { ...prev, archiveIntents: e.target.checked } : prev)}
                      className="mt-1 h-4 w-4 rounded border border-[#BBBBBB]"
                    />
                    <span>
                      Also archive {relatedIntentCount} generated intent{relatedIntentCount === 1 ? '' : 's'} linked to these item(s).
                    </span>
                  </label>
                ) : (
                  <p className="text-xs text-[#666] mb-4">This action can&apos;t be undone.</p>
                )}
                <div className="flex justify-end space-x-3">
                  <Button 
                    type="button"
                    variant="outline" 
                    onClick={() => setConfirm(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="border-red-600 text-red-600 hover:bg-red-50"
                    onClick={() => { if (confirm) { queueDeletion(confirm.payload, confirm.archiveIntents ? confirm.intentIds : []); setConfirm(null); } }}
                  >
                    Delete
                  </Button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// Helpers: size formatting and file badge
function formatSize(size: string): string {
  // If already human-readable, return as-is
  if (/\d+\s?(KB|MB|GB|B)$/i.test(size)) return size;
  const n = Number(size);
  if (Number.isNaN(n)) return size;
  const units = ['B','KB','MB','GB'];
  let v = n; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function fileBadge(mime: string | undefined, name: string): string {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return 'PDF';
  if (['doc','docx','rtf','odt'].includes(ext)) return 'DOC';
  if (['xls','xlsx','csv'].includes(ext)) return 'SHEET';
  if (['ppt','pptx','key'].includes(ext)) return 'SLIDE';
  if (['png','jpg','jpeg','gif','svg','webp'].includes(ext)) return 'IMG';
  if (['mp4','mov','avi','mkv','webm'].includes(ext)) return 'VID';
  if (['mp3','wav','m4a','flac'].includes(ext)) return 'AUD';
  if (['zip','rar','7z','tar','gz'].includes(ext)) return 'ARCH';
  if (['md','txt','json','yaml','yml'].includes(ext)) return 'TXT';
  if (mime?.includes('pdf')) return 'PDF';
  if (mime?.startsWith('image/')) return 'IMG';
  if (mime?.startsWith('video/')) return 'VID';
  if (mime?.startsWith('audio/')) return 'AUD';
  return 'FILE';
}


// Deletion helpers
type RecentItem = { id: string; kind: 'file' | 'link'; title: string; sub: string; onClick?: () => void | Promise<void>; createdAt: number; raw: { id: string; name?: string; url?: string; type?: string; createdAt?: string; lastSyncAt?: string | null } };
