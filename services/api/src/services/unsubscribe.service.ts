import { log } from '../lib/log';

import { ChatDatabaseAdapter } from '../adapters/database.adapter';

const logger = log.service.from('UnsubscribeService');

/**
 * UnsubscribeService
 *
 * Handles ghost user opt-out (unsubscribe) logic.
 * Delegates to the database adapter for soft-deletion.
 */
export class UnsubscribeService {
  constructor(private db = new ChatDatabaseAdapter()) {}

  /**
   * Soft-delete a ghost user by their unsubscribe token.
   * Looks up the user via userNotificationSettings, then soft-deletes if eligible.
   * @param token - The unsubscribe token from the email link
   * @returns true if the user was soft-deleted, false if not found or ineligible
   */
  async softDeleteGhostByToken(token: string): Promise<boolean> {
    logger.verbose('Soft-deleting ghost user by token');
    const result = await this.db.softDeleteGhostByUnsubscribeToken(token);
    if (result) {
      logger.info('Ghost user unsubscribed via token');
    } else {
      logger.verbose('Ghost user not found or already deleted for token');
    }
    return result;
  }
}
