"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNotifications } from "@/contexts/NotificationContext";
import { useAuthenticatedAPI } from "@/lib/api";
import ReactMarkdown from 'react-markdown';
import { useIdentityToken } from '@privy-io/react-auth';
import { useAPI } from "@/contexts/APIContext";

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
  const { identityToken } = useIdentityToken();
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
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [activeMobileSection, setActiveMobileSection] = useState<'library' | 'intents'>('library');
  const highlightTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const knownIntentIds = useRef<Set<string>>(new Set());
  const connectSourcesRef = useRef<HTMLDivElement | null>(null);

  // Enhance UX: select and undo state
  const [, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [undoBatch, setUndoBatch] = useState<{
    items: { kind: 'file' | 'link'; item: any }[];
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    open: boolean;
    message: string;
    payload: { kind: 'file' | 'link'; item: any }[];
  } | null>(null);
  type IntegrationId = 'notion' | 'slack' | 'discord' | 'calendar' | 'gmail';
  const [integrations, setIntegrations] = useState<Array<{ id: IntegrationId; name: string; connected: boolean }>>([]);
  const [pendingIntegration, setPendingIntegration] = useState<null | IntegrationId>(null);

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

  const finalizeDeletion = useCallback(async (batch: { kind: 'file' | 'link'; item: any }[]) => {
    try {
      await Promise.all(batch.map(({ kind, item }) => kind === 'file'
        ? api.delete(`/files/${(item as any).id}`)
        : api.delete(`/links/${(item as any).id}`)
      ));
      success(batch.length === 1 ? 'Item deleted' : `${batch.length} items deleted`);
      onChanged?.();
    } catch {
      error('Failed to delete some items');
    } finally {
      setUndoBatch(null);
    }
  }, [api, success, error, onChanged]);

  const handleUndo = useCallback(() => {
    if (!undoBatch) return;
    if (undoBatch.timer) clearTimeout(undoBatch.timer);
    // Restore items into state
    const filesToRestore = undoBatch.items.filter(i => i.kind === 'file').map(i => i.item as any);
    const linksToRestore = undoBatch.items.filter(i => i.kind === 'link').map(i => i.item as any);
    if (filesToRestore.length > 0) setFiles(prev => [...prev, ...filesToRestore]);
    if (linksToRestore.length > 0) setLinks(prev => [...prev, ...linksToRestore]);
    setUndoBatch(null);
  }, [undoBatch]);

  const queueDeletion = useCallback((items: { kind: 'file' | 'link'; item: any }[]) => {
    // Remove items immediately from UI
    const fileIds = new Set(items.filter(i => i.kind === 'file').map(i => (i.item as any).id));
    const linkIds = new Set(items.filter(i => i.kind === 'link').map(i => (i.item as any).id));
    if (fileIds.size > 0) setFiles(prev => prev.filter(f => !fileIds.has(f.id)));
    if (linkIds.size > 0) setLinks(prev => prev.filter(l => !linkIds.has(l.id)));

    // Start 5s timer for actual delete
    const timer = setTimeout(() => finalizeDeletion(items), 5000);
    setUndoBatch({ items, timer });
  }, [finalizeDeletion]);

  const handleSingleDelete = useCallback((item: RecentItem) => {
    const payload = [{ kind: item.kind, item: item.raw }];
    setConfirm({ open: true, message: 'This permanently removes it from your Library. Continue?', payload });
  }, []);

  const handleBulkDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    // Build payload from current state
    const payload: { kind: 'file' | 'link'; item: any }[] = [];
    files.forEach(f => { if (selectedIds.has(`f-${f.id}`)) payload.push({ kind: 'file', item: f }); });
    links.forEach(l => { if (selectedIds.has(`l-${l.id}`)) payload.push({ kind: 'link', item: l }); });
    setSelectedIds(new Set());
    setSelectMode(false);
    if (payload.length > 0) setConfirm({ open: true, message: `This permanently removes ${payload.length} item(s) from your Library. Continue?`, payload });
  }, [files, links, selectedIds]);

  // Integrations (compact section)
  const loadIntegrations = useCallback(async () => {
    try {
      const res = await api.get<{ integrations: Array<{ id: string; name: string; connected: boolean }> }>(`/integrations`);
      const wanted: Array<IntegrationId> = ['notion','slack','discord','calendar','gmail'];
      const items: Array<{ id: IntegrationId; name: string; connected: boolean }> = wanted.map(id => {
        const found = res.integrations?.find(i => i.id === id);
        const friendlyName: Record<IntegrationId, string> = {
          notion: 'Notion',
          slack: 'Slack',
          discord: 'Discord',
          'calendar': 'Google Calendar',
          gmail: 'Gmail',
        };
        return { id, name: found?.name ?? friendlyName[id], connected: !!found?.connected };
      });
      setIntegrations(items);
    } catch {
      setIntegrations([
        { id: 'notion', name: 'Notion', connected: false },
        { id: 'slack', name: 'Slack', connected: false },
        { id: 'discord', name: 'Discord', connected: false },
        { id: 'calendar', name: 'Google Calendar', connected: false },
        { id: 'gmail', name: 'Gmail', connected: false },
      ]);
    }
  }, [api]);

  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }), []);

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

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const handleCopyIntent = useCallback(async (intent: LibrarySourceIntent) => {
    try {
      const text = intent.summary?.trim() && intent.summary.trim().length > 0 ? intent.summary : intent.payload;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        success('Intent copied');
        return;
      }
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (!ok) throw new Error('execCommand failed');
      success('Intent copied');
    } catch {
      error('Clipboard unavailable');
    }
  }, [success, error]);

  const handleOpenIntentSource = useCallback((intent: LibrarySourceIntent) => {
    if (intent.sourceType === 'link' && intent.sourceValue && /^https?:/i.test(intent.sourceValue)) {
      window.open(intent.sourceValue, '_blank', 'noopener');
      return;
    }
    handleJumpToSources();
  }, [handleJumpToSources]);

  const intentsByDate = useMemo(() => {
    const msPerDay = 24 * 60 * 60 * 1000;
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    const ordered = [...libraryIntents].sort((a, b) => {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    const sections: Array<{ label: string; key: string; items: LibrarySourceIntent[] }> = [];
    const bucket = new Map<string, { label: string; items: LibrarySourceIntent[] }>();

    for (const intent of ordered) {
      const createdDate = new Date(intent.createdAt);
      if (Number.isNaN(createdDate.getTime())) {
        if (!bucket.has('unknown')) bucket.set('unknown', { label: 'Undated', items: [] });
        bucket.get('unknown')!.items.push(intent);
        continue;
      }
      const startOfCreated = new Date(createdDate.getFullYear(), createdDate.getMonth(), createdDate.getDate());
      const diff = Math.round((startOfToday.getTime() - startOfCreated.getTime()) / msPerDay);
      let label: string;
      if (diff === 0) label = 'Today';
      else if (diff === 1) label = 'Yesterday';
      else label = dateFormatter.format(createdDate);
      const key = `${startOfCreated.getTime()}-${label}`;
      if (!bucket.has(key)) bucket.set(key, { label, items: [] });
      bucket.get(key)!.items.push(intent);
    }

    const sortedKeys = Array.from(bucket.keys()).sort((a, b) => {
      const [timeA] = a.split('-');
      const [timeB] = b.split('-');
      return Number(timeB) - Number(timeA);
    });

    for (const key of sortedKeys) {
      const entry = bucket.get(key);
      if (entry) sections.push({ label: entry.label, key, items: entry.items });
    }

    return sections;
  }, [libraryIntents, dateFormatter]);

  const toggleIntegration = useCallback(async (id: IntegrationId) => {
    const item = integrations.find(i => i.id === id);
    if (!item) return;
    try {
      setPendingIntegration(id);
      if (item.connected) {
        await api.delete(`/integrations/${id}`);
        setIntegrations(prev => prev.map(x => x.id === id ? { ...x, connected: false } : x));
        success(`${item.name} disconnected`);
      } else {
        const popup = typeof window !== 'undefined' ? window.open('', `oauth_${id}`, 'width=560,height=720') : null;
        const res = await api.post<{ redirectUrl?: string; connectionRequestId?: string }>(`/integrations/connect/${id}`);
        const redirect = res.redirectUrl;
        const reqId = res.connectionRequestId;
        if (popup && redirect) {
          popup.location.href = redirect;
        } else if (redirect) {
          window.location.href = redirect;
          return;
        }
        if (reqId) {
          const started = Date.now();
          const poll = setInterval(async () => {
            if (popup && popup.closed) {
              clearInterval(poll);
              return;
            }
            try {
              const s = await api.get<{ status: 'pending' | 'connected'; connectedAt?: string }>(`/integrations/status/${reqId}`);
              if (s.status === 'connected') {
                clearInterval(poll);
                if (popup && !popup.closed) popup.close();
                setIntegrations(prev => prev.map(x => x.id === id ? { ...x, connected: true } : x));
                success(`${item.name} connected`);
              }
              if (Date.now() - started > 90000) {
                clearInterval(poll);
                if (popup && !popup.closed) popup.close();
              }
            } catch {
              clearInterval(poll);
              if (popup && !popup.closed) popup.close();
              error(`Failed to complete ${item.name} connection`);
            }
          }, 1500);
        }
      }
    } catch {
      // ignore
    } finally {
      setPendingIntegration(null);
    }
  }, [api, integrations, success, error]);

  const handleFilesSelected = useCallback(async (f: FileList | null) => {
    if (!f || f.length === 0) return;
    setIsUploading(true);
    try {
      await Promise.all(Array.from(f).map(async file => {
        const res = await api.uploadFile<{ file: (typeof files)[number] }>(`/files`, file);
        return res.file;
      }));
      onChanged?.();
      await loadLists();
      await loadLibraryIntents();
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
      await api.post<{ link: (typeof links)[number] }>(`/links`, { url: normalizedUrl });
      setLinkUrl("");
      onChanged?.();
      await loadLists();
      await loadLibraryIntents();
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
      await syncService.syncIntegration(integrationType as any);
      success(`${integrationType.charAt(0).toUpperCase() + integrationType.slice(1)} sync started`);
    } catch {
      error(`Failed to sync ${integrationType}`);
    } finally {
      void loadLibraryIntents();
      setSyncingIntegrations(prev => {
        const next = new Set(prev);
        next.delete(integrationType);
        return next;
      });
    }
  }, [syncService, success, error, loadLibraryIntents]);

  const handleSyncLink = useCallback(async (linkId: string) => {
    try {
      setSyncingLinks(prev => new Set([...prev, linkId]));
      await syncService.syncLink(linkId);
      success('Link sync started');
    } catch {
      error('Failed to sync link');
    } finally {
      void loadLibraryIntents();
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

  // no index context needed for library mode

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 animate-in fade-in duration-200" />
        <Dialog.Content className="library-modal fixed inset-0 w-screen h-[100dvh] p-4 rounded-none bg-[#FAFAFA] border border-[#E0E0E0] text-gray-900 shadow-lg focus:outline-none overflow-hidden overflow-x-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[96vw] sm:h-auto sm:max-w-[1050px] sm:max-h-[85vh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-6">
          <div className="flex items-center justify-between mb-4 sm:mb-6 sticky top-0 bg-[#FAFAFA] z-10">
            <Dialog.Title className="text-xl font-bold text-[#333] font-ibm-plex-mono">Library</Dialog.Title>
            <button
              onClick={() => onOpenChange(false)}
              className="p-1 hover:bg-[#F0F0F0] rounded-lg cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
              aria-label="Close modal"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#666] hover:text-[#333] transition-colors duration-150 ease-in-out">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          <div className="lg:hidden mb-3 flex items-center gap-2 rounded-lg bg-[#F2F2F2] p-1">
            <button
              type="button"
              className={`relative flex-1 px-3 py-1.5 text-xs font-ibm-plex-mono rounded-md transition-colors ${activeMobileSection === 'library' ? 'bg-white text-[#222] shadow-sm' : 'text-[#555]'}`}
              onClick={() => setActiveMobileSection('library')}
            >
              Library
            </button>
            <button
              type="button"
              className={`relative flex-1 px-3 py-1.5 text-xs font-ibm-plex-mono rounded-md transition-colors ${activeMobileSection === 'intents' ? 'bg-white text-[#222] shadow-sm' : 'text-[#555]'}`}
              onClick={() => setActiveMobileSection('intents')}
            >
              Intents
              <span className="ml-1 text-[10px] text-[#666]">({libraryIntents.length})</span>
              {newIntentIds.size > 0 && (
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-[#0A8F5A]"></span>
              )}
            </button>
          </div>

          <div className="flex flex-col lg:flex-row gap-3.5 lg:gap-4 lg:flex-1 overflow-hidden">
            <div className={`${activeMobileSection === 'library' ? 'block' : 'hidden'} lg:block lg:flex-1 min-w-0`}
            >
              <div className="space-y-2 sm:space-y-3 lg:space-y-4">

            {/* Connect your sources */}
            <section ref={connectSourcesRef} className="pr-2">
              <div className="flex items-center justify-between mb-1.5">
                <h3 className="text-sm font-bold font-ibm-plex-mono text-[#333]">Connect Sources</h3>
                <span className="text-xs text-gray-500 font-ibm-plex-mono">
                  {integrations.filter(i => i.connected).length} of {integrations.length} connected
                </span>
              </div>
              <div className="grid grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-3 gap-1.5 sm:gap-3">
                {integrations.map((it) => (
                  <div key={it.id} className="flex flex-col gap-2 border border-[#E0E0E0] rounded-lg px-2.5 py-2 transition-colors bg-[#FAFAFA] hover:bg-[#F0F0F0] hover:border-[#CCCCCC] md:px-3 md:py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-3">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/integrations/${it.id === 'calendar' ? 'google-calendar' : it.id}.png`} width={20} height={20} alt="" />
                        <span className="text-xs font-medium text-[#333] font-ibm-plex-mono">{it.name}</span>
                        {it.connected && (
                          <button
                            onClick={() => handleSyncIntegration(it.id)}
                            disabled={syncingIntegrations.has(it.id)}
                            className="group p-1 hover:bg-[#F0F0F0] rounded-lg cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
                            aria-label={`Sync ${it.name}`}
                          >
                            {syncingIntegrations.has(it.id) ? (
                              <span className="h-3.5 w-3.5 border-2 border-[#666] border-t-transparent rounded-full animate-spin inline-block" />
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
                        <button
                          onClick={() => toggleIntegration(it.id)}
                          disabled={pendingIntegration === it.id}
                          className={`relative h-5 w-9 rounded-full transition-colors duration-200 cursor-pointer disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0 ${
                            it.connected ? 'bg-[#006D4B]' : 'bg-[#D9D9D9]'
                          } ${pendingIntegration === it.id ? 'opacity-70' : ''}`}
                          aria-pressed={it.connected}
                          aria-busy={pendingIntegration === it.id}
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
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Add new content */}
            <section className="pr-2">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold font-ibm-plex-mono text-[#333]">Files and URLs</h3>
                <span className="text-xs text-gray-500 font-ibm-plex-mono">
                  {files.length + links.length} items total
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 md:gap-3">
                {/* File upload */}
                <div className="border border-[#E0E0E0] rounded-lg">
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
                      className="w-full h-10 px-3 py-2 text-sm font-ibm-plex-mono bg-white text-[#333] hover:bg-[#F0F0F0] transition-colors disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0 rounded-lg flex items-center justify-center gap-1.5"
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
                <div className="border border-[#E0E0E0] rounded-lg">
                  <div className="relative w-full">
                    <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-sm pointer-events-none">
                      🔗
                    </span>
                    <Input
                      placeholder="Paste URL here"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddLink(); }}
                      className="text-sm bg-white rounded-lg font-ibm-plex-mono w-full pl-10 pr-10 focus:ring-2 focus:ring-[rgba(0,0,0,0.1)] border-0"
                    />
                    {isAddingLink ? (
                      <div className="absolute right-3 top-1/2 transform -translate-y-1/2 w-6 h-6 border-2 border-[#DDDDDD] border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <button
                        onClick={handleAddLink}
                        disabled={!linkUrl}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 hover:bg-[#F0F0F0] rounded-lg cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
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
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 mb-2">
                {selectedIds.size > 0 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs border-red-500 text-red-600 hover:bg-red-50 font-ibm-plex-mono rounded-lg focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
                      onClick={() => handleBulkDelete()}
                    >
                      Delete ({selectedIds.size})
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs border-[#DDDDDD] text-[#333] hover:bg-[#F0F0F0] font-ibm-plex-mono rounded-lg focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
                      onClick={() => setSelectedIds(new Set())}
                    >
                      Clear
                    </Button>
                  </div>
                )}
              </div>
              <div className="space-y-2 max-h-[45vh] sm:h-[400px] overflow-y-auto pb-8">
                {(() => {
                  type RecentItem = { id: string; kind: 'file' | 'link'; title: string; sub: string; onClick?: () => void | Promise<void>; createdAt: number; raw: any };
                  const map: RecentItem[] = [
                    ...files.map(f => ({
                      id: `f-${f.id}`,
                      kind: 'file' as const,
                      title: f.name,
                      sub: `${formatSize(f.size)} • ${new Date(f.createdAt).toLocaleDateString()}`,
                      createdAt: new Date(f.createdAt).getTime(),
                      raw: f as any,
                    })),
                    ...links.map(l => ({
                      id: `l-${l.id}`,
                      kind: 'link' as const,
                      title: l.url,
                      sub: l.lastSyncAt ? new Date(l.lastSyncAt).toLocaleString() : (l.createdAt ? new Date(l.createdAt).toLocaleString() : ''),
                      onClick: async () => {
                        const id = l.id;
                        setPreview({ id, title: l.url });
                        const res = await api.get<{ content?: string; pending?: boolean; url?: string; lastStatus?: string | null; lastSyncAt?: string | null }>(`/links/${id}/content`);
                        if (res?.content) setPreview({ id, title: l.url, content: res.content });
                      },
                      createdAt: (l.lastSyncAt ? new Date(l.lastSyncAt).getTime() : (l.createdAt ? new Date(l.createdAt).getTime() : 0)),
                      raw: l as any,
                    })),
                  ];
                  const filtered = map;
                  const recent = filtered.sort((a,b) => a.createdAt < b.createdAt ? 1 : -1);
                  if (recent.length === 0) return <div className="text-sm text-[#666]">No items yet.</div>;
                  return recent.map(item => (
                    <div 
                      key={item.id} 
                      className={`w-full border rounded-lg px-2.5 py-2 transition-colors cursor-pointer md:px-3 ${
                        selectedIds.has(item.id) 
                          ? 'border-[#CCCCCC] bg-[#F5F5F5]' 
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
                              className="h-4 w-4 border border-[#006D4B] bg-[#006D4B] rounded-[4px] flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
                              aria-label={`Select ${item.kind}`}
                            >
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                                <polyline points="20,6 9,17 4,12"></polyline>
                              </svg>
                            </button>
                          )}
                          {item.kind === 'file' && (
                            <span className="text-[10px] px-1.5 py-0.5 border border-[#E0E0E0] rounded-md font-ibm-plex-mono text-[#333] bg-[#F5F5F5]">
                              {fileBadge((item.raw as any).type, (item.raw as any).name)}
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
                                  handleSyncLink((item.raw as any).id);
                                }} 
                                className="group p-1 hover:bg-[#F0F0F0] rounded-lg cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0" 
                                disabled={syncingLinks.has((item.raw as any).id)}
                                aria-label="Sync link"
                              >
                                {syncingLinks.has((item.raw as any).id) ? (
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
                            className="group p-1 hover:bg-[#F0F0F0] rounded-lg cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
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
            <aside className={`${activeMobileSection === 'intents' ? 'flex flex-col' : 'hidden'} lg:flex lg:flex-col w-full lg:w-[330px] flex-shrink-0 rounded-lg bg-[#FAFAFA] shadow-[0_1px_3px_rgba(15,23,42,0.08)] lg:max-h-[70vh] lg:overflow-y-auto`}>
                <div className="flex items-center justify-between pb-2 border-b border-[#E4E4E4] pl-3">
                  <h3 className="text-sm font-bold font-ibm-plex-mono text-[#333]">Intents</h3>
                  <span className="text-xs text-[#666] font-ibm-plex-mono">{libraryIntents.length}</span>
                </div>
                <div className="mt-3 flex-1 lg:overflow-y-auto pr-1 space-y-3 p-3 pt-0">
                  {isLoadingIntents ? (
                    <div className="flex items-center justify-center py-6">
                      <span className="h-6 w-6 border-2 border-[#CCCCCC] border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : intentsByDate.length === 0 ? (
                    <div className="text-xs text-[#666] font-ibm-plex-mono py-4 text-center">
                      <p>No intents yet.</p>
                    </div>
                  ) : (
                    intentsByDate.map((section) => {
                      const isCollapsed = collapsedSections.has(section.key);
                      return (
                        <div key={section.key} className="space-y-2">
                          <button
                            type="button"
                            onClick={() => toggleSection(section.key)}
                            className="w-full flex items-center justify-between text-xs font-ibm-plex-mono font-medium text-[#444] border-b border-[#E8E8E8] pb-1"
                            aria-expanded={!isCollapsed}
                          >
                            <span>{section.label}</span>
                            <span className="flex items-center gap-1 text-[10px] text-[#777]">
                              {section.items.length}
                              <svg
                                width="10"
                                height="10"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className={`transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                              >
                                <polyline points="6 9 12 15 18 9"></polyline>
                              </svg>
                            </span>
                          </button>
                          {!isCollapsed && (
                            <div className="space-y-2">
                              {section.items.map((intent) => {
                                const summary = (intent.summary && intent.summary.trim().length > 0 ? intent.summary : intent.payload).trim();
                                const createdAt = new Date(intent.createdAt);
                                const createdLabel = Number.isNaN(createdAt.getTime()) ? null : createdAt.toLocaleDateString();
                                const detail = intent.sourceType === 'link' && intent.sourceValue && intent.sourceValue !== intent.sourceName ? intent.sourceValue : null;
                                const metaLabel = intent.sourceType === 'integration' && intent.sourceMeta ? (() => {
                                  const parsed = new Date(intent.sourceMeta!);
                                  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleString();
                                })() : null;
                                const isFresh = newIntentIds.has(intent.id);
                                const canOpenSource = intent.sourceType === 'link' && intent.sourceValue && /^https?:/i.test(intent.sourceValue);
                          const cardClasses = `relative border rounded-lg px-2.5 py-2 transition-colors md:px-3 md:py-2.5 ${isFresh ? 'border-[#0A8F5A] bg-[#F1FFF5] shadow-sm shadow-[rgba(10,143,90,0.12)]' : 'border-[#E0E0E0] bg-white hover:border-[#CCCCCC]'}`;

                                const icon = (() => {
                                  if (intent.sourceType === 'file') {
                                    return (
                                      <span className="text-[10px] px-1.5 py-0.5 border border-[#E0E0E0] rounded-md font-ibm-plex-mono text-[#333] bg-[#F5F5F5]">
                                        {fileBadge(intent.sourceMeta ?? undefined, intent.sourceName)}
                                      </span>
                                    );
                                  }
                                  if (intent.sourceType === 'link') {
                                    return (
                                      <svg
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className="text-[#666]"
                                      >
                                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                                      </svg>
                                    );
                                  }
                                  return (
                                    <div className="h-[18px] w-[18px] rounded-md bg-white border border-[#E0E0E0] flex items-center justify-center overflow-hidden">
                                      {intent.sourceValue ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img src={`/integrations/${intent.sourceValue}.png`} alt="" className="h-4 w-4 object-contain" />
                                      ) : (
                                        <span className="text-[9px] font-semibold text-[#555]">APP</span>
                                      )}
                                    </div>
                                  );
                                })();

                                return (
                                    <div key={intent.id} className={`group relative ${cardClasses}`}>
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="flex items-center gap-2">
                                        {icon}
                                        {isFresh && (
                                          <span className="px-1.5 py-0.5 rounded-full bg-[#0A8F5A] text-white text-[10px] tracking-wide font-ibm-plex-mono uppercase">New</span>
                                        )}
                                      </div>
                                      {createdLabel && (
                                        <span className="flex items-center gap-1 text-[10px] text-[#777] font-ibm-plex-mono whitespace-nowrap">
                                          <svg
                                            width="12"
                                            height="12"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.5"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="text-[#777]"
                                          >
                                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                            <line x1="16" y1="2" x2="16" y2="6" />
                                            <line x1="8" y1="2" x2="8" y2="6" />
                                            <line x1="3" y1="10" x2="21" y2="10" />
                                          </svg>
                                          {createdLabel}
                                        </span>
                                      )}
                                    </div>
                                    <div className="mt-1 text-xs text-[#333] font-medium leading-snug line-clamp-3 break-words">{summary}</div>
                                    {detail && (
                                      <div className="mt-0.5 text-[10px] text-[#888] break-words">{detail}</div>
                                    )}
                                    {metaLabel && (
                                      <div className="mt-1 text-[10px] text-[#888] font-ibm-plex-mono">Synced {metaLabel}</div>
                                    )}
                              <div className="mt-2 flex items-center justify-end gap-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 lg:absolute lg:right-2 lg:bottom-2">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); void handleCopyIntent(intent); }}
                                  className="h-6 w-6 grid place-items-center rounded-md bg-[#F2F2F2] text-[#555] hover:bg-[#E6E6E6]"
                                  aria-label="Copy intent"
                                >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                        </svg>
                                      </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleOpenIntentSource(intent); }}
                                  className={canOpenSource
                                    ? 'h-6 w-6 grid place-items-center rounded-md bg-[#F2F2F2] text-[#555] hover:bg-[#E6E6E6]'
                                    : 'h-6 w-6 grid place-items-center rounded-md bg-[#EEF5FF] text-[#3563E9]'}
                                        aria-label={canOpenSource ? 'Open source' : 'View source details'}
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                          <polyline points="7 7 17 7 17 17"></polyline>
                                          <line x1="7" y1="17" x2="17" y2="7"></line>
                                        </svg>
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}

                </div>
            </aside>
          </div>

          {/* Link Preview */}
          <Dialog.Root open={!!preview} onOpenChange={(v) => { if (!v) setPreview(null); }}>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 bg-black/40" />
              <Dialog.Content className="fixed inset-0 w-screen h-[100dvh] p-4 rounded-none bg-[#FAFAFA] border border-[#E0E0E0] shadow-lg overflow-auto sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[90vw] sm:max-w-[760px] sm:max-h-[80vh] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-5">
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


          {/* Undo Snackbar */}
          {undoBatch && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-[#333] text-white text-sm px-4 py-2 rounded-lg shadow-lg flex items-center gap-3">
              <span>
                {undoBatch.items.length === 1 ? 'Item removed' : `${undoBatch.items.length} items removed`}
              </span>
              <button
                className="underline rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
                onClick={() => handleUndo()}
                aria-label="Undo delete"
              >
                Undo
              </button>
            </div>
          )}

          {/* Styled Confirm Dialog */}
          <Dialog.Root open={!!confirm?.open} onOpenChange={(v) => { if (!v) setConfirm(null); }}>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 bg-black/40" />
              <Dialog.Content className="fixed inset-x-0 bottom-0 mx-auto w-[92vw] max-w-[440px] rounded-t-lg bg-[#FAFAFA] border border-[#E0E0E0] text-gray-900 p-4 shadow-lg sm:left-1/2 sm:top-1/2 sm:inset-auto sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:p-5">
                <Dialog.Title className="text-lg font-bold mb-2 font-ibm-plex-mono text-[#333]">Confirm Delete</Dialog.Title>
                <p className="text-sm text-[#444] mb-4">{confirm?.message}</p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" className="rounded-lg border-[#DDDDDD] text-[#333] hover:bg-[#F0F0F0] focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0" onClick={() => setConfirm(null)}>Cancel</Button>
                  <Button
                    variant="outline"
                    className="rounded-lg border-red-600 text-red-600 hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-[rgba(0,109,75,0.35)] focus-visible:ring-offset-0"
                    onClick={() => { if (confirm) { queueDeletion(confirm.payload); setConfirm(null); } }}
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
type RecentItem = { id: string; kind: 'file' | 'link'; title: string; sub: string; onClick?: () => void | Promise<void>; createdAt: number; raw: any };
