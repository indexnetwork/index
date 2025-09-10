import { useMemo } from 'react';
import { useAuthenticatedAPI } from '@/lib/api';

export interface LibraryFile { id: string; name: string; size: string; type: string; createdAt: string; url: string; }
export interface LibraryLink { id: string; url: string; createdAt?: string; lastSyncAt?: string | null; lastStatus?: string | null; lastError?: string | null; contentUrl?: string; }

export const createLibraryService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  getFiles: async (): Promise<LibraryFile[]> => {
    const res = await api.get<{ files: LibraryFile[] }>(`/files`);
    return res.files || [];
  },
  uploadFile: async (file: File): Promise<LibraryFile> => {
    const res = await api.uploadFile<{ file: LibraryFile }>(`/files`, file);
    return res.file;
  },
  getLinks: async (): Promise<LibraryLink[]> => {
    const res = await api.get<{ links: LibraryLink[] }>(`/links`);
    return res.links || [];
  },
  addLink: async (url: string): Promise<LibraryLink> => {
    const res = await api.post<{ link: LibraryLink }>(`/links`, { url });
    return res.link;
  },
  deleteFile: async (id: string): Promise<void> => {
    await api.delete(`/files/${id}`);
  },
  deleteLink: async (id: string): Promise<void> => {
    await api.delete(`/links/${id}`);
  },
  getLinkContent: async (id: string): Promise<{ content?: string; pending?: boolean; url?: string; lastStatus?: string | null; lastSyncAt?: string | null }> => {
    return await api.get(`/links/${id}/content`);
  }
});

export function useLibraryService() {
  const api = useAuthenticatedAPI();
  return useMemo(() => createLibraryService(api), [api]);
}
