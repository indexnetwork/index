import { log } from './log';
import { traceAppOperation } from './sentry-performance';

export interface BackgroundOptions {
  /** Number of retries after the first attempt, with exponential backoff. Default: none. */
  retries?: number;
}

const BASE_RETRY_DELAY_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` fire-and-forget: returns immediately, catches everything, logs
 * failures under `log.job.from(name)`, and traces each attempt in the same
 * Sentry span shape a BullMQ worker processor used to open.
 */
export function background(name: string, fn: () => Promise<void>, opts?: BackgroundOptions): void {
  const logger = log.job.from(name);
  const retries = opts?.retries ?? 0;

  void (async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        await traceAppOperation(
          {
            name: `background ${name}`,
            op: 'queue.process',
            forceTransaction: true,
            attributes: {
              subsystem: 'background',
              job: name,
              'job.attempt': attempt + 1,
            },
          },
          fn,
        );
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt >= retries) {
          logger.error('Background job failed', { error: message, attempt: attempt + 1 });
          return;
        }
        const backoffMs = BASE_RETRY_DELAY_MS * 2 ** attempt;
        logger.warn('Background job failed, retrying', { error: message, attempt: attempt + 1, retries, backoffMs });
        await delay(backoffMs);
      }
    }
  })();
}
