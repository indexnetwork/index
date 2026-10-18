import db from '../lib/drizzle/drizzle';
import type { ParsedEmailEvent } from '../lib/email/resend-webhook';
import * as schema from '../schemas/database.schema';

class EmailEventService {
  /**
   * Store one Resend event. A repeat of the same webhook message id is
   * ignored, so retries from Resend do not change the counts.
   */
  async record(messageId: string, event: ParsedEmailEvent): Promise<void> {
    await db
      .insert(schema.emailEvents)
      .values({
        id: messageId,
        emailId: event.emailId,
        type: event.type,
        kind: event.kind,
        userId: event.userId,
        occurredAt: event.occurredAt,
      })
      .onConflictDoNothing();
  }
}

export const emailEventService = new EmailEventService();
