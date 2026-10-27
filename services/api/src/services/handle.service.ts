import { log } from '../lib/log';
import { isUUID } from '../lib/keys';
import { handleDatabaseAdapter, normalizeHandle, type HandleDatabaseAdapter, type HandleHolder } from '../adapters/handle.database.adapter';

const logger = log.service.from('HandleService');

export type { HandleHolder };

/**
 * The root namespace of the web app. A handle at `index.network/<handle>` is
 * a username or a network key, never both; claiming one is checked against
 * the other in `HandleDatabaseAdapter.check`.
 */
export class HandleService {
  constructor(private readonly db: HandleDatabaseAdapter = handleDatabaseAdapter) {}

  /**
   * Who `index.network/<handle>` points at.
   *
   * @param raw - The URL segment, any case, with or without a leading `@`.
   * @returns The live person or network holding it, or null.
   */
  async resolve(raw: string): Promise<HandleHolder | null> {
    const handle = normalizeHandle(raw);
    if (!handle || isUUID(handle)) return null;
    logger.verbose('Resolving handle', { handle });
    return this.db.findHolder(handle);
  }
}

export const handleService = new HandleService();
