export interface LinkRecord {
  id: string;
  url: string;
  createdAt?: string;
  lastSyncAt?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
  contentUrl?: string;
}

export interface LinkContentResponse {
  content?: string;
  pending?: boolean;
  url?: string;
  lastStatus?: string | null;
  lastSyncAt?: string | null;
}

export const createLinksService = (api: ReturnType<typeof import('../lib/api').useAuthenticatedAPI>) => ({
  // Get all links
  getLinks: async (): Promise<LinkRecord[]> => {
    const res = await api.get<{ links: LinkRecord[] }>('/links');
    return res.links || [];
  },

  // Create a new link
  createLink: async (url: string): Promise<LinkRecord> => {
    const res = await api.post<{ link: LinkRecord }>('/links', { url });
    return res.link;
  },

  // Delete a link
  deleteLink: async (linkId: string): Promise<void> => {
    await api.delete(`/links/${linkId}`);
  },

  // Get link content for preview
  getLinkContent: async (linkId: string): Promise<LinkContentResponse> => {
    return await api.get<LinkContentResponse>(`/links/${linkId}/content`);
  }
});
