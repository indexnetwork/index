export type SyncProviderName = 'links' | 'gmail' | 'notion' | 'slack' | 'discord' | 'calendar';

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type SyncRun = {
  id: string;
  provider: SyncProviderName;
  userId: string;
  params: Record<string, any>;
  status: RunStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  progress?: {
    total?: number;
    completed?: number;
    notes?: string[];
  };
  stats?: Record<string, any>;
  error?: string | null;
};

export interface SyncProvider<Params extends Record<string, any> = any> {
  name: SyncProviderName;
  start(run: SyncRun, params: Params, update: (patch: Partial<SyncRun>) => Promise<void>): Promise<void>;
}
