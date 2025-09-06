import db from '../../db';
import { userIntegrations, providerCursors } from '../../schema';
import { eq, and, isNull } from 'drizzle-orm';
import { handlers } from '../../integrations';
import { log } from '../../log';
import { processFilesToIntents } from '../process';
import type { SyncProvider, SyncRun } from '../types';

type IntegrationType = 'notion' | 'gmail' | 'slack' | 'discord' | 'calendar';

type Params = { indexId?: string };

async function getConnectedIntegration(userId: string, integrationType: IntegrationType) {
  const rows = await db
    .select()
    .from(userIntegrations)
    .where(
      and(
        eq(userIntegrations.userId, userId),
        eq(userIntegrations.integrationType, integrationType),
        eq(userIntegrations.status, 'connected'),
        isNull(userIntegrations.deletedAt)
      )
    )
    .limit(1);
  return rows[0] || null;
}

export function createIntegrationProvider(type: IntegrationType): SyncProvider<Params> {
  return {
    name: type,
    async start(run: SyncRun, params: Params, update) {
      const integrationRec = await getConnectedIntegration(run.userId, type);
      if (!integrationRec) throw new Error('Integration not connected');

      const handler = handlers[type];
      if (!handler) throw new Error('Unsupported integration type');

      // Load provider cursor (store lastSyncAt as a simple delta cursor for now)
      const cursorRows = await db.select().from(providerCursors).where(and(eq(providerCursors.userId, run.userId), eq(providerCursors.provider, type))).limit(1);
      const cursor = cursorRows[0]?.cursor as any | undefined;
      const lastSyncAt = cursor?.lastSyncAt ? new Date(cursor.lastSyncAt) : integrationRec.lastSyncAt || undefined;

      await update({ progress: { notes: [`fetching ${type} files`] } });
      const files = await handler.fetchFiles(run.userId, lastSyncAt || undefined);
      await update({ progress: { total: files.length, completed: 0, notes: [`fetched ${files.length} files`] } });

      const { intentsGenerated, filesImported } = await processFilesToIntents({
        userId: run.userId,
        indexId: params.indexId,
        files,
        textInstruction: `Generate intents based on content from ${type} integration`,
        count: 30,
        summarize: false,
        onProgress: async (completed, total, note) => {
          await update({ progress: { total, completed, notes: note ? [note] : [] } });
        },
      });

      const finishedAt = new Date();
      await db
        .update(userIntegrations)
        .set({ lastSyncAt: finishedAt })
        .where(eq(userIntegrations.id, integrationRec.id));

      // Persist provider cursor
      const newCursor = { lastSyncAt: finishedAt.toISOString() } as any;
      if (cursorRows.length) {
        await db.update(providerCursors).set({ cursor: newCursor, updatedAt: finishedAt }).where(eq(providerCursors.id, cursorRows[0].id));
      } else {
        await db.insert(providerCursors).values({ userId: run.userId, provider: type, cursor: newCursor });
      }

      log.info(`${type}-sync-run`, { runId: run.id, filesImported, intentsGenerated });
      await update({ stats: { filesImported, intentsGenerated } });
    },
  };
}
