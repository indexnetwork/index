import { log } from './log';
import { traceAppOperation } from './sentry-performance';

/**
 * Run `fn` fire-and-forget: returns immediately, catches everything, logs
 * failures under `log.job.from(name)`, and opens one Sentry span per run
 * (`queue.process` is Sentry's own op name for background work). No retry.
 */
export function background(name: string, fn: () => Promise<void>): void {
  const logger = log.job.from(name);

  void (async () => {
    try {
      await traceAppOperation(
        {
          name: `background ${name}`,
          op: 'queue.process',
          forceTransaction: true,
          attributes: {
            subsystem: 'background',
            job: name,
          },
        },
        fn,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Background job failed', { error: message });
    }
  })();
}
