import { useMemo } from 'react';
import { useAuthenticatedAPI } from '../lib/api';

// Link interface
export interface Link {
  id: string;
  url: string;
  createdAt?: string;
  lastSyncAt?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
}

export const createLinksService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  // Get links (Library-scoped)
  getLinks: async (): Promise<Link[]> => {
    const res = await api.get<{ links: Link[] }>(`/links`);
    return res.links || [];
  },

  // Add a new link
  addLink: async (link: { url: string }): Promise<Link> => {
    const res = await api.post<{ link: Link }>(`/links`, link);
    return res.link;
  },

  // Delete a link
  deleteLink: async (linkId: string): Promise<void> => {
    await api.delete(`/links/${linkId}`);
  }
});

// Non-authenticated service for public endpoints
export const linksService = {
  // Legacy methods that require authentication
  getLinks: () => { throw new Error('Use useLinksService() hook instead of linksService directly'); },
  addLink: () => { throw new Error('Use useLinksService() hook instead of linksService directly'); },
  deleteLink: () => { throw new Error('Use useLinksService() hook instead of linksService directly'); }
};

// Hook for using links service with proper error handling
export function useLinksService() {
  const api = useAuthenticatedAPI();
  return useMemo(() => createLinksService(api), [api]);
}
