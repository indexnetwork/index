import { Intents } from '@indexnetwork/protocol';
import type { IntentFollowUp } from '@indexnetwork/protocol';

import { background } from '../background';
import { intentDatabaseAdapter } from '../../adapters/database.adapter';

/**
 * The host side of {@link IntentFollowUp}.
 *
 * Writing a signal no longer starts a search. Discovery is on demand: the
 * owner's agent searches with its own query through `POST /intents/:id/discover`
 * and picks who becomes an opportunity, so there is nothing to prepare when a
 * signal is saved, archived, or resumed.
 *
 * Rescoring stays: it measures the text that was just written and is
 * independent of who the signal reaches.
 */
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

  /** @returns Immediately. A saved signal is searched on demand, not on write. */
  onIntentSaved(): Promise<unknown> {
    return Promise.resolve();
  }

  /** @returns Immediately. There are no per-signal search artifacts to clean up. */
  onIntentArchived(): Promise<unknown> {
    return Promise.resolve();
  }

  /** @returns Immediately. A resumed signal is searched on demand, not on resume. */
  onIntentResumed(): Promise<unknown> {
    return Promise.resolve();
  }
}

/** Singleton intent follow-up. Use for triggering handlers and background work. */
export const intentIndexing = new IntentIndexing();
