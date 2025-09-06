import { useAuthenticatedAPI } from '@/lib/api';

export type SyncRun = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  progress?: { total?: number; completed?: number; notes?: string[] };
  stats?: { filesImported?: number; intentsGenerated?: number; pagesVisited?: number; [k: string]: any };
  error?: string | null;
};

export const createSyncService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  getRun: async (runId: string): Promise<{ run: SyncRun }> => {
    const res = await api.get<{ run: SyncRun }>(`/sync/runs/${runId}`);
    return res;
  },
});

