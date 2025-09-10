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
  const [isSyncing, setIsSyncing] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isAddingLink, setIsAddingLink] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [integrations, setIntegrations] = useState<Array<{ id: 'notion'|'slack'|'discord'; name: string; connected: boolean }>>([]);
  const [pendingIntegration, setPendingIntegration] = useState<null | 'notion' | 'slack' | 'discord'>(null);

  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [links, setLinks] = useState<LibraryLink[]>([]);
  const [preview, setPreview] = useState<{ id: string; title: string; content?: string } | null>(null);

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

  const handleSyncLinks = useCallback(async () => {
    // No manual sync; auto-crawl on add
  }, []);

  const loadIntegrations = useCallback(async () => {
    try {
      const res = await api.get<{ integrations: Array<{ id: string; name: string; connected: boolean }> }>(`/integrations`);
      const wanted: Array<'notion'|'slack'|'discord'> = ['notion','slack','discord'];
      const items = wanted.map(id => {
        const found = res.integrations?.find(i => i.id === id);
        return { id, name: found?.name ?? id[0].toUpperCase()+id.slice(1), connected: !!found?.connected } as const;
      });
      setIntegrations(items as any);
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
        const redirect = (res as any).redirectUrl as string | undefined;
        const reqId = (res as any).connectionRequestId as string | undefined;
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
            } catch (e) {
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
    let t: any;
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
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[90vw] max-w-[800px] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 rounded-md bg-white p-6 shadow-lg focus:outline-none overflow-hidden flex flex-col">
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

            {/* Recent (bottom, own scroll) */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold font-ibm-plex-mono text-gray-900">Recent</h3>
              </div>
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-2 pb-12">
                {(() => {
                  const map = [
                    ...files.map(f => ({
                      id: `f-${f.id}`,
                      kind: 'file' as const,
                      title: f.name,
                      sub: `${f.size} • ${new Date(f.createdAt).toLocaleDateString()}`,
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
                      }
                    })),
                  ];
                  const byDate = (x: any) => {
                    const f = x.id.startsWith('f-');
                    const src: any = f ? files.find(ff => `f-${ff.id}` === x.id) : links.find(ll => `l-${ll.id}` === x.id);
                    const d = f ? (src?.createdAt ? new Date(src.createdAt).getTime() : 0) : (src?.createdAt ? new Date(src.createdAt as any).getTime() : (src?.lastSyncAt ? new Date(src.lastSyncAt as any).getTime() : 0));
                    return d;
                  };
                  const recent = map.sort((a,b) => byDate(b)-byDate(a));
                  if (recent.length === 0) return <div className="text-sm text-gray-500">No items yet.</div>;
                  return recent.map(item => (
                    <div key={item.id} className="w-full bg-gray-100 px-3 py-2 hover:bg-gray-200 transition-colors">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] px-1.5 py-0.5 border border-black rounded-[1px] font-ibm-plex-mono">
                            {item.kind === 'file' ? 'FILE' : 'LINK'}
                          </span>
                          <span className="text-sm font-ibm-plex-mono text-gray-900 truncate">{item.title}</span>
                        </div>
                        {item.kind === 'link' && (
                          <button onClick={item.onClick} className="text-xs border border-black px-2 py-1 rounded-[1px] cursor-pointer disabled:cursor-not-allowed" disabled={String(item.sub).startsWith('fetch') || String(item.sub).startsWith('progress:')}>
                            View
                          </button>
                        )}
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
