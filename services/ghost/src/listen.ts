import { createRedisClient } from '@indexnetwork/api/src/adapters/cache.adapter';
import { log } from '@indexnetwork/api/src/lib/log';
import { ackUserEvent, readUserEventGroup, scanUserEventStreams, userEventStream, type UserEventRecord } from '@indexnetwork/api/src/lib/user-events';

import { introduceSignal, outreachPass } from './ghost';

const logger = log.job.from('ghost.listen');
const GROUP = 'ghost-introducer';
const BLOCK_MS = 2000;

let reader: ReturnType<typeof createRedisClient> | undefined;
let running = false;
let tail: Promise<void> = Promise.resolve();

/** One piece of work at a time: research calls are slow, and order keeps the cap honest. */
function enqueue(work: () => Promise<void>): void {
  tail = tail.then(work, work);
}

async function join(userId: string): Promise<void> {
  try {
    await reader!.xgroup('CREATE', userEventStream(userId), GROUP, '$', 'MKSTREAM');
  } catch (error: unknown) {
    if (!String(error).includes('BUSYGROUP')) throw error;
  }
}

function handle(record: UserEventRecord): void {
  let frame: { type?: string; data?: { intentId?: string } };
  try { frame = JSON.parse(record.data); } catch { frame = {}; }
  const intentId = frame.data?.intentId;
  const work = frame.type === 'intent.created' && intentId
    ? () => introduceSignal(intentId)
    : frame.type === 'opportunity.status'
      ? () => outreachPass()
      : null;
  if (!work) {
    void ackUserEvent(GROUP, record);
    return;
  }
  enqueue(async () => {
    try {
      const count = await work();
      if (count) logger.info('Ghost event handled', { type: frame.type, intentId, count });
    } catch (error: unknown) {
      logger.error('Ghost event failed', { type: frame.type, intentId, error: error instanceof Error ? error.message : String(error) });
    } finally {
      await ackUserEvent(GROUP, record);
    }
  });
}

/** Read intent creation and opportunity status from every owner's stream. */
export function startListener(): void {
  running = true;
  reader = createRedisClient();
  const joined = new Set<string>();
  let from: '>' | '0' = '0';

  void (async () => {
    while (running && reader) {
      try {
        const userIds = await scanUserEventStreams();
        for (const userId of userIds) {
          if (joined.has(userId)) continue;
          await join(userId);
          joined.add(userId);
        }
        if (!userIds.length) {
          await Bun.sleep(BLOCK_MS);
          continue;
        }
        const records = await readUserEventGroup(reader, {
          group: GROUP, consumer: GROUP, userIds, from, blockMs: BLOCK_MS,
        });
        from = '>';
        for (const record of records) handle(record);
      } catch (error: unknown) {
        if (!running) return;
        logger.error('Ghost listen failed', { error: error instanceof Error ? error.message : String(error) });
        joined.clear();
        from = '0';
        await Bun.sleep(BLOCK_MS);
      }
    }
  })();
}

/** Stop reading and wait for the event already being handled. */
export async function stopListener(): Promise<void> {
  running = false;
  reader?.disconnect();
  reader = undefined;
  await tail;
}
