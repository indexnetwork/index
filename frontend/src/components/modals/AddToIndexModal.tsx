"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useIndexes } from "@/contexts/APIContext";
import { useAuthenticatedAPI } from "@/lib/api";
import { Index } from "@/lib/types";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  index: Index | null;
  indexId?: string; // optional fallback; modal will fetch index
  onChanged?: () => void; // ask parent to refresh after any action
};

export default function AddToIndexModal({ open, onOpenChange, index, indexId, onChanged }: Props) {
  const indexes = useIndexes();
  const api = useAuthenticatedAPI();
  const [isUploading, setIsUploading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [integrations, setIntegrations] = useState<Array<{ id: 'notion'|'slack'|'discord'; name: string; connected: boolean }>>([]);

  const [fetchedIndex, setFetchedIndex] = useState<Index | null>(null);
  const effectiveIndex = index ?? fetchedIndex;
  const files = useMemo(() => effectiveIndex?.files ?? [], [effectiveIndex]);

  const handleFilesSelected = useCallback(async (f: FileList | null) => {
    const targetId = effectiveIndex?.id || indexId;
    if (!targetId || !f || f.length === 0) return;
    setIsUploading(true);
    try {
      await Promise.all(Array.from(f).map(file => indexes.uploadFile(targetId, file)));
      onChanged?.();
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [effectiveIndex?.id, indexId, indexes, onChanged]);

  const handleAddLink = useCallback(async () => {
    const targetId = effectiveIndex?.id || indexId;
    if (!targetId || !linkUrl) return;
    try {
      await indexes.addIndexLink(targetId, { url: linkUrl.trim() });
      setLinkUrl("");
      onChanged?.();
    } catch {}
  }, [effectiveIndex?.id, indexId, indexes, linkUrl, onChanged]);

  const handleSyncLinks = useCallback(async () => {
    const targetId = effectiveIndex?.id || indexId;
    if (!targetId) return;
    setIsSyncing(true);
    try {
      await indexes.syncIndexLinks(targetId);
      onChanged?.();
    } finally {
      setIsSyncing(false);
    }
  }, [effectiveIndex?.id, indexId, indexes, onChanged]);

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
      if (item.connected) {
        await api.delete(`/integrations/${id}`);
        setIntegrations(prev => prev.map(x => x.id === id ? { ...x, connected: false } : x));
      } else {
        const res = await api.post<{ redirectUrl?: string }>(`/integrations/connect/${id}`);
        if (res && (res as any).redirectUrl) {
          window.location.href = (res as any).redirectUrl as string;
        }
      }
    } catch {
      // ignore
    }
  }, [api, integrations]);

  useEffect(() => {
    if (open) loadIntegrations();
  }, [open, loadIntegrations]);

  useEffect(() => {
    const loadIndex = async () => {
      if (!open) return;
      if (index || !indexId) return;
      try {
        const data = await indexes.getIndex(indexId);
        setFetchedIndex(data || null);
      } catch {
        setFetchedIndex(null);
      }
    };
    loadIndex();
  }, [open, index, indexId, indexes]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[90vw] max-w-[800px] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 rounded-md bg-white p-6 shadow-lg focus:outline-none overflow-hidden flex flex-col">
          <div className="flex items-center justify-between mb-6">
            <Dialog.Title className="text-xl font-bold text-gray-900 font-ibm-plex-mono">Library</Dialog.Title>
          </div>

          <div className="flex-1 overflow-y-auto pr-1 space-y-8">
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
                      className={`relative h-[25px] w-[42px] rounded-full ${it.connected ? 'bg-black' : 'bg-black/40'}`}
                      aria-pressed={it.connected}
                      aria-label={`${it.name} ${it.connected ? 'connected' : 'disconnected'}`}
                    >
                      <span
                        className={`absolute top-[2px] ${it.connected ? 'right-[2px]' : 'left-[2px]'} h-[21px] w-[21px] rounded-full bg-white`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* Files */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-base font-bold font-ibm-plex-mono text-gray-900">Files</h3>
              </div>
              {/* Simple recent list (first 4) */}
              <div className="space-y-2">
                {files.slice(0, 4).map((f) => (
                  <div key={f.id} className="bg-gray-100 px-3 py-2">
                    <div className="text-sm font-ibm-plex-mono text-gray-900">{f.name}</div>
                    <div className="text-xs text-gray-600 font-ibm-plex-mono">{f.size} • {new Date(f.createdAt).toLocaleDateString()}</div>
                  </div>
                ))}
              </div>

              {/* Add new */}
              <div className="mt-4">
                <h4 className="text-base font-bold font-ibm-plex-mono text-gray-900 mb-2">Add new</h4>
                <div className="border border-gray-400 rounded p-3">
                  <div className="border border-dashed border-gray-400 bg-gray-100 p-5 text-center">
                    <div className="text-sm font-ibm-plex-mono text-gray-900 mb-2">Drop your files</div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      id="index-file-upload"
                      onChange={(e) => handleFilesSelected(e.target.files)}
                    />
                    <label htmlFor="index-file-upload" className="text-sm underline cursor-pointer">or browse</label>
                    {isUploading && <div className="mt-2 text-xs text-gray-600">Uploading…</div>}
                  </div>

                  <div className="mt-3 flex gap-2 items-center">
                    <Input
                      placeholder="or paste link https://…"
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddLink(); }}
                    />
                    <Button variant="outline" className="border-black text-black" onClick={handleAddLink} disabled={!linkUrl}>Add</Button>
                    <Button variant="outline" className="border-black text-black" onClick={handleSyncLinks} disabled={isSyncing}> {isSyncing ? "Syncing…" : "Sync links"}</Button>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
