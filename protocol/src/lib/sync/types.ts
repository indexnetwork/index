export type SyncProviderName = 'links' | 'gmail' | 'notion' | 'slack' | 'discord' | 'calendar';

export type SyncRun = {
  id: string;
  provider: SyncProviderName;
  userId: string;
  createdAt: number;
  progress?: {
    total?: number;
    completed?: number;
    notes?: string[];
  };
  stats?: Record<string, any>;
};

export interface SyncProvider<Params extends Record<string, any> = any> {
  name: SyncProviderName;
  start(run: SyncRun, params: Params, update: (patch: Partial<SyncRun>) => Promise<void>): Promise<void>;
}
