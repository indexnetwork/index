import { Intents, type IntentFollowUp } from '@indexnetwork/protocol';

import { background } from '../background';
import { intentDatabaseAdapter } from '../../adapters/database.adapter';

/** Host follow-up: independent scoring and lifecycle follow-up. */
export class IntentIndexing implements IntentFollowUp {
  /**
   * Rescore final revisions after saving without applying admission or lifecycle changes.
   * @param data - Saved intent, owner, and the exact final text.
   * @returns Immediately after scheduling best-effort metadata work.
   */
  scoreIntent(data: { intentId: string; userId: string; payload: string }): Promise<unknown> {
    background('intent-score', async () => {
      const metadata = await new Intents().scoreIntent(data.payload);
      await intentDatabaseAdapter.updateSemanticMetadata(data.intentId, data.userId, data.payload, metadata);
    });
    return Promise.resolve();
  }

  /**
   * Intent saved follow-up.
   * @param _data - Saved intent data.
   */
  onIntentSaved(_data: { intentId: string; userId: string }): Promise<unknown> {
    return Promise.resolve();
  }

  /**
   * Intent archived follow-up.
   * @param _data - Archived intent data.
   */
  onIntentArchived(_data: { intentId: string }): Promise<unknown> {
    return Promise.resolve();
  }

  /**
   * Intent resumed follow-up.
   * @param _data - Resumed intent data.
   */
  onIntentResumed(_data: { intentId: string; userId: string; lifecycleVersionMs: number }): Promise<unknown> {
    return Promise.resolve();
  }
}

/** Singleton intent follow-up. Use for triggering handlers and background work. */
export const intentIndexing = new IntentIndexing();
