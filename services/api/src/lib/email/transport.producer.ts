import { emailQueue } from '../../queues/email.queue';

import { log } from '../log';

const logger = log.lib.from("lib/email/transport.producer.ts");

/**
 * Enqueue an email job and block until the worker finishes it (or times out).
 *
 * This is the producer-side entry point: it lives apart from {@link executeSendEmail}
 * (the pure Resend transport in `transport.helper.ts`) so that the email queue can
 * import the transport without creating an import cycle back through the queue singleton.
 */
export const sendEmail = async (options: {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}): Promise<any> => {
  const job = await emailQueue.addJob(options);

  // Wait for the job to complete with a 60 second timeout
  const WAIT_TIMEOUT_MS = 60000;

  try {
    const result = await job.waitUntilFinished(emailQueue.queueEvents, WAIT_TIMEOUT_MS);

    // Check for null OR undefined - BullMQ stores undefined as null
    if (result == null) {
      // Job completed but with no result - could indicate the job wasn't processed
      // or QueueEvents missed the completion event. Check job state.
      const jobState = await job.getState();
      const returnValue = job.returnvalue;

      // If job is still waiting/active, the timeout was hit or worker didn't process it
      if (jobState === 'waiting' || jobState === 'active' || jobState === 'delayed') {
        logger.error(`Email job ${job.id} timed out or not processed`, { jobState });
      } else if (jobState === 'completed') {
        // Job actually completed, QueueEvents missed the event - return the stored result
        return returnValue;
      }

      return returnValue || result;
    }

    return result;
  } catch (error) {
    // Handle timeout or other errors
    const jobState = await job.getState().catch(() => 'unknown');
    logger.error(`Email job ${job.id} error while waiting`, {
      error: error instanceof Error ? error.message : String(error),
      jobState,
    });
    throw error;
  }
};
