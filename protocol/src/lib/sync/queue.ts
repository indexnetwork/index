import { runStore } from './run-store';
import { SyncProvider, SyncRun, SyncProviderName } from './types';
import { emitRunUpdate } from './events';

let queuePromise: Promise<any> | null = null;
async function getQueue() {
  if (!queuePromise) {
    queuePromise = import('p-queue').then((m) => new m.default({ concurrency: Number(process.env.SYNC_CONCURRENCY || '2') }));
  }
  return queuePromise;
}

const providers = new Map<SyncProviderName, SyncProvider>();

export function registerProvider(p: SyncProvider) {
  providers.set(p.name, p);
}

export async function enqueue(provider: SyncProviderName, userId: string, params: Record<string, any>) {
  const p = providers.get(provider);
  if (!p) throw new Error(`Unknown provider: ${provider}`);
  const run = await runStore.create({ provider, userId, params, status: 'queued' });
  emitRunUpdate(run.id, run);

  (await getQueue()).add(async () => {
    const start = Date.now();
    const started = await runStore.update(run.id, { status: 'running', startedAt: start });
    if (started) emitRunUpdate(run.id, started);
    const update = async (patch: Partial<SyncRun>) => {
      const updated = await runStore.update(run.id, patch);
      if (updated) emitRunUpdate(run.id, updated);
    };
    try {
      await p.start(run, params, update);
      const finishedAt = Date.now();
      await update({ status: 'succeeded', finishedAt });
    } catch (e: any) {
      const finishedAt = Date.now();
      await update({ status: 'failed', finishedAt, error: e?.message || String(e) });
    }
  }).catch(() => void 0);

  return run.id;
}

export async function getRun(runId: string) {
  return runStore.get(runId);
}
