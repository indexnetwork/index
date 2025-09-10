"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthenticatedAPI } from "@/lib/api";
import { useNotifications } from "@/contexts/NotificationContext";
import { useLibraryService, LibraryFile, LibraryLink } from "@/services/library";
import ReactMarkdown from 'react-markdown';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged?: () => void; // ask parent to refresh after any action
};

export default function LibraryModal({ open, onOpenChange, onChanged }: Props) {
  const api = useAuthenticatedAPI();
  const { info, success, error } = useNotifications();
  const library = useLibraryService();
  // No backend progress numbers; show a local pending label.
  const parseProgress = () => 'fetching content…';
  const [isUploading, setIsUploading] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isAddingLink, setIsAddingLink] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [integrations, setIntegrations] = useState<Array<{ id: 'notion'|'slack'|'discord'; name: string; connected: boolean }>>([]);
  const [pendingIntegration, setPendingIntegration] = useState<null | 'notion' | 'slack' | 'discord'>(null);

  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [links, setLinks] = useState<LibraryLink[]>([]);
  const [preview, setPreview] = useState<{ id: string; title: string; content?: string } | null>(null);

  // Enhance UX: select, search, and undo state
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [undoBatch, setUndoBatch] = useState<{
    items: { kind: 'file' | 'link'; item: LibraryFile | LibraryLink }[];
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all'|'file'|'link'>('all');
  const [confirm, setConfirm] = useState<{
    open: boolean;
    message: string;
    payload: { kind: 'file' | 'link'; item: LibraryFile | LibraryLink }[];
  } | null>(null);

  const loadLists = useCallback(async () => {
    try {
      const [f, l] = await Promise.all([
        library.getFiles(),
        library.getLinks()
      ]);
      setFiles(f || []);
      setLinks(l || []);
    } catch {}
  }, [library]);

  const toggleSelected = useCallback((id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  const finalizeDeletion = useCallback(async (batch: { kind: 'file' | 'link'; item: LibraryFile | LibraryLink }[]) => {
    try {
      await Promise.all(batch.map(({ kind, item }) => kind === 'file'
        ? library.deleteFile((item as LibraryFile).id)
        : library.deleteLink((item as LibraryLink).id)
      ));
      success(batch.length === 1 ? 'Item deleted' : `${batch.length} items deleted`);
      onChanged?.();
    } catch {
      error('Failed to delete some items');
    } finally {
      setUndoBatch(null);
    }
  }, [library, success, error, onChanged]);

  const handleUndo = useCallback(() => {
    if (!undoBatch) return;
    if (undoBatch.timer) clearTimeout(undoBatch.timer);
    // Restore items into state
    const filesToRestore = undoBatch.items.filter(i => i.kind === 'file').map(i => i.item as LibraryFile);
    const linksToRestore = undoBatch.items.filter(i => i.kind === 'link').map(i => i.item as LibraryLink);
    if (filesToRestore.length > 0) setFiles(prev => [...prev, ...filesToRestore]);
    if (linksToRestore.length > 0) setLinks(prev => [...prev, ...linksToRestore]);
    setUndoBatch(null);
  }, [undoBatch]);

  const queueDeletion = useCallback((items: { kind: 'file' | 'link'; item: LibraryFile | LibraryLink }[]) => {
    // Remove items immediately from UI
    const fileIds = new Set(items.filter(i => i.kind === 'file').map(i => (i.item as LibraryFile).id));
    const linkIds = new Set(items.filter(i => i.kind === 'link').map(i => (i.item as LibraryLink).id));
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
    const payload: { kind: 'file' | 'link'; item: LibraryFile | LibraryLink }[] = [];
    files.forEach(f => { if (selectedIds.has(`f-${f.id}`)) payload.push({ kind: 'file', item: f }); });
    links.forEach(l => { if (selectedIds.has(`l-${l.id}`)) payload.push({ kind: 'link', item: l }); });
    setSelectedIds(new Set());
    setSelectMode(false);
    if (payload.length > 0) setConfirm({ open: true, message: `This permanently removes ${payload.length} item(s) from your Library. Continue?`, payload });
  }, [files, links, selectedIds]);

  const handleFilesSelected = useCallback(async (f: FileList | null) => {
    if (!f || f.length === 0) return;
    setIsUploading(true);
    try {
      await Promise.all(Array.from(f).map(file => library.uploadFile(file)));
      onChanged?.();
      await loadLists();
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [library, onChanged, loadLists]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer?.files || null;
    if (files && files.length > 0) {
      void handleFilesSelected(files);
    }
  }, [handleFilesSelected]);

  const handleAddLink = useCallback(async () => {
    if (!linkUrl) return;
    try {
      setIsAddingLink(true);
      await library.addLink(linkUrl.trim());
      setLinkUrl("");
      onChanged?.();
      await loadLists();
    } catch {}
    finally {
      setIsAddingLink(false);
    }
  }, [library, linkUrl, onChanged, loadLists]);


  const loadIntegrations = useCallback(async () => {
    try {
      const res = await api.get<{ integrations: Array<{ id: string; name: string; connected: boolean }> }>(`/integrations`);
      const wanted: Array<'notion'|'slack'|'discord'> = ['notion','slack','discord'];
      const items: Array<{ id: 'notion'|'slack'|'discord'; name: string; connected: boolean }> = wanted.map(id => {
        const found = res.integrations?.find(i => i.id === id);
        return { id, name: found?.name ?? (id[0].toUpperCase()+id.slice(1)), connected: !!found?.connected };
      });
      setIntegrations(items);
    } catch {
      setIntegrations([
        { id: 'notion', name: 'Notion', connected: false },
        { id: 'slack', name: 'Slack', connected: false },
        { id: 'discord', name: 'Discord', connected: false },
      ]);
    }
  }, [api]);

  const toggleIntegration = useCallback(async (id: 'notion'|'slack'|'discord') => {
    const item = integrations.find(i => i.id === id);
    if (!item) return;
    try {
      setPendingIntegration(id);
      if (item.connected) {
        await api.delete(`/integrations/${id}`);
        setIntegrations(prev => prev.map(x => x.id === id ? { ...x, connected: false } : x));
        success(`${item.name} disconnected`);
      } else {
        info(`Connecting to ${item.name}…`);
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
  }, [api, integrations, info, success, error]);

  useEffect(() => {
    if (open) loadIntegrations();
    if (open) loadLists();
    let t: ReturnType<typeof setInterval> | null = null;
    if (open) {
      t = setInterval(loadLists, 1500);
    }
    return () => { if (t) clearInterval(t); };
  }, [open, loadIntegrations, loadLists]);

  // no index context needed for library mode

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[90vw] max-w-[800px] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 rounded-md bg-white dark:bg-white text-gray-900 dark:text-gray-900 p-6 shadow-lg focus:outline-none overflow-hidden flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <Dialog.Title className="text-xl font-bold text-gray-900 font-ibm-plex-mono">Library</Dialog.Title>
          </div>

          <div className="flex-1 pr-1 space-y-8 overflow-hidden">
            {/* Connect your sources */}
            <section>
              <h3 className="text-base font-bold font-ibm-plex-mono text-gray-900 mb-3">Connect your sources</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {integrations.map((it) => (
                  <div key={it.id} className="flex items-center justify-between border border-black shadow-[0_1px_0_#000] rounded-[1px] px-4 py-3 bg-white">
                    <span className="flex items-center gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/integrations/${it.id}.png`} width={24} height={24} alt="" />
                      <span className="font-medium">{it.name}</span>
                    </span>
                    <button
                      onClick={() => toggleIntegration(it.id)}
                      disabled={pendingIntegration === it.id}
                      className={`relative h-[25px] w-[42px] rounded-full transition-colors duration-200 cursor-pointer disabled:cursor-not-allowed ${it.connected ? 'bg-black' : 'bg-black/40'} ${pendingIntegration === it.id ? 'opacity-70' : ''}`}
                      aria-pressed={it.connected}
                      aria-busy={pendingIntegration === it.id}
                      aria-label={`${it.name} ${it.connected ? 'connected' : 'disconnected'}`}
                    >
                      <span
                        className={`absolute top-[2px] left-[2px] h-[21px] w-[21px] rounded-full bg-white transition-transform duration-200`}
                        style={{ transform: it.connected ? 'translateX(17px)' : 'translateX(0px)' }}
                      />
                      {pendingIntegration === it.id && (
                        <span className="absolute inset-0 grid place-items-center">
                          <span className="h-3 w-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        </span>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* Add new (middle) */}
            <section>
              <div className="mt-4">
                <h4 className="text-base font-bold font-ibm-plex-mono text-gray-900 mb-2">Add new</h4>
                <div className="border border-gray-400 rounded p-3">
                  <div
                    className={`border border-dashed ${isDragging ? 'border-gray-600' : 'border-gray-400'} bg-gray-100 p-5 text-center cursor-pointer`}
                    onDragOver={handleDragOver}
                    onDragEnter={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <div className="text-sm font-ibm-plex-mono text-gray-900 mb-2">Drop your files</div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      id="library-file-upload"
                      onChange={(e) => handleFilesSelected(e.target.files)}
                    />
                    <label htmlFor="library-file-upload" className="text-sm underline cursor-pointer">or browse</label>
                    {isUploading && (
                      <div className="mt-2 space-y-2">
                        <div className="w-full h-2 bg-white border border-black overflow-hidden">
                          <div className="h-full bg-black w-1/2 animate-pulse" />
                        </div>
                        <div className="text-xs text-gray-600 inline-flex items-center gap-2">
                          <span className="h-3 w-3 border-2 border-gray-600 border-t-transparent rounded-full animate-spin" />
                          Uploading…
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex gap-2 items-center">
                    <Input
                      placeholder="or paste link https://…"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddLink(); }}
                    />
                    <Button variant="outline" className="border-black text-black" onClick={handleAddLink} disabled={!linkUrl || isAddingLink}>
                      {isAddingLink ? (
                        <span className="inline-flex items-center gap-2"><span className="h-4 w-4 border-2 border-black border-t-transparent rounded-full animate-spin" /> Adding…</span>
                      ) : 'Add'}
                    </Button>
                    {/* Sync removed: auto-crawl on add */}
                  </div>
                </div>
              </div>
            </section>

            {/* Library (bottom, own scroll) */}
            <section>
              <div className="flex items-center justify-between mb-3 gap-2">
                <h3 className="text-base font-bold font-ibm-plex-mono text-gray-900">Library</h3>
              <div className="flex items-center gap-2 ml-auto">
                  <Input
                    placeholder="Search files and links"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-8 w-[200px]"
                  />
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      className={`h-8 ${typeFilter==='all' ? 'bg-black text-white' : ''}`}
                      onClick={() => setTypeFilter('all')}
                    >
                      All
                    </Button>
                    <Button
                      variant="outline"
                      className={`h-8 ${typeFilter==='file' ? 'bg-black text-white' : ''}`}
                      onClick={() => setTypeFilter('file')}
                    >
                      Files
                    </Button>
                    <Button
                      variant="outline"
                      className={`h-8 ${typeFilter==='link' ? 'bg-black text-white' : ''}`}
                      onClick={() => setTypeFilter('link')}
                    >
                      Links
                    </Button>
                  </div>
                  <Button
                    variant="outline"
                    className={`h-8 ${selectMode ? 'bg-black text-white' : ''}`}
                    onClick={() => { setSelectMode(!selectMode); if (selectMode) setSelectedIds(new Set()); }}
                  >
                    {selectMode ? 'Done' : 'Select'}
                  </Button>
                  {selectMode && selectedIds.size > 0 && (
                    <Button
                      variant="outline"
                      className="h-8 border-red-600 text-red-600"
                      onClick={() => handleBulkDelete()}
                    >
                      Delete selected ({selectedIds.size})
                    </Button>
                  )}
                </div>
              </div>
              <div className="space-y-2 max-h-[360px] overflow-y-auto pr-2 pb-12">
                {(() => {
                  type RecentItem = { id: string; kind: 'file' | 'link'; title: string; sub: string; onClick?: () => void | Promise<void>; createdAt: number; raw: LibraryFile | LibraryLink };
                  const map: RecentItem[] = [
                    ...files.map(f => ({
                      id: `f-${f.id}`,
                      kind: 'file' as const,
                      title: f.name,
                      sub: `${formatSize(f.size)} • ${new Date(f.createdAt).toLocaleDateString()}`,
                      createdAt: new Date(f.createdAt).getTime(),
                      raw: f,
                    })),
                    ...links.map(l => ({
                      id: `l-${l.id}`,
                      kind: 'link' as const,
                      title: l.url,
                      sub: l.lastSyncAt ? `last: ${new Date(l.lastSyncAt).toLocaleString()}` : parseProgress(),
                      onClick: async () => {
                        const id = l.id;
                        setPreview({ id, title: l.url });
                        const res = await library.getLinkContent(id);
                        if (res?.content) setPreview({ id, title: l.url, content: res.content });
                      },
                      createdAt: (l.lastSyncAt ? new Date(l.lastSyncAt).getTime() : (l.createdAt ? new Date(l.createdAt).getTime() : 0)),
                      raw: l,
                    })),
                  ];
                  const filtered = map.filter(item => {
                    const q = item.title.toLowerCase().includes(search.toLowerCase());
                    const t = typeFilter === 'all' || item.kind === typeFilter;
                    return q && t;
                  });
                  const recent = filtered.sort((a,b) => a.createdAt < b.createdAt ? 1 : -1);
                  if (recent.length === 0) return <div className="text-sm text-gray-500">No items yet.</div>;
                  return recent.map(item => (
                    <div key={item.id} className="w-full bg-gray-100 px-3 py-2 hover:bg-gray-200 transition-colors">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {selectMode && (
                            <input
                              type="checkbox"
                              checked={selectedIds.has(item.id)}
                              onChange={(e) => toggleSelected(item.id, e.target.checked)}
                              className="h-3.5 w-3.5"
                              aria-label={`Select ${item.kind}`}
                            />
                          )}
                          <span className="text-[10px] px-1.5 py-0.5 border border-black rounded-[1px] font-ibm-plex-mono">
                            {item.kind === 'file' ? fileBadge((item.raw as LibraryFile).type, (item.raw as LibraryFile).name) : 'LINK'}
                          </span>
                          <span className="text-sm font-ibm-plex-mono text-gray-900 truncate">{item.title}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {item.kind === 'link' && !selectMode && (
                            <button onClick={item.onClick} className="text-xs border border-black px-2 py-1 rounded-[1px] cursor-pointer disabled:cursor-not-allowed" disabled={String(item.sub).startsWith('fetch') || String(item.sub).startsWith('progress:')}>
                              View
                            </button>
                          )}
                          {!selectMode && (
                            <button
                              className="text-xs border border-red-600 text-red-600 px-2 py-1 rounded-[1px]"
                              onClick={() => handleSingleDelete(item)}
                              aria-label={`Delete ${item.kind}`}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-gray-600 font-ibm-plex-mono mt-1 truncate">
                        {String(item.sub).startsWith('fetch') ? (
                          <div className="w-full h-2 bg-white border border-black overflow-hidden">
                            <div className="h-full bg-black w-1/2 animate-pulse" />
                          </div>
                        ) : (
                          String(item.sub)
                        )}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </section>
          </div>

          {/* Link Preview */}
          <Dialog.Root open={!!preview} onOpenChange={(v) => { if (!v) setPreview(null); }}>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 bg-black/40" />
              <Dialog.Content className="fixed left-1/2 top-1/2 w-[90vw] max-w-[760px] max-h-[80vh] -translate-x-1/2 -translate-y-1/2 rounded-md bg-white p-5 shadow-lg overflow-auto">
                <Dialog.Title className="text-base font-bold font-ibm-plex-mono text-gray-900 mb-3">{preview?.title}</Dialog.Title>
                {!preview?.content ? (
                  <div className="text-sm text-gray-600">Loading content…</div>
                ) : (
                  <div className="prose prose-sm max-w-none text-gray-900">
                    <ReactMarkdown>{preview.content}</ReactMarkdown>
                  </div>
                )}
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </div>

          {/* Undo Snackbar */}
          {undoBatch && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-black text-white text-sm px-4 py-2 rounded shadow-lg flex items-center gap-3">
              <span>
                {undoBatch.items.length === 1 ? 'Item removed' : `${undoBatch.items.length} items removed`}
              </span>
              <button
                className="underline"
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
              <Dialog.Content className="fixed left-1/2 top-1/2 w-[90vw] max-w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-md bg-white dark:bg-white text-gray-900 dark:text-gray-900 p-5 shadow-lg">
                <Dialog.Title className="text-lg font-bold mb-2 font-ibm-plex-mono">Confirm Delete</Dialog.Title>
                <p className="text-sm text-gray-700 mb-4">{confirm?.message}</p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
                  <Button
                    variant="outline"
                    className="border-red-600 text-red-600"
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
type RecentItem = { id: string; kind: 'file' | 'link'; title: string; sub: string; onClick?: () => void | Promise<void>; createdAt: number; raw: LibraryFile | LibraryLink };
