import { Intents, type IntentFollowUp } from '@indexnetwork/protocol';

import { intentDatabaseAdapter } from '../../adapters/database.adapter';
import { publishIntentLifecycle } from '../../adapters/intent.database.adapter';
import { background } from '../background';
import { publishUserEvent } from '../user-events';

/** Wake the owning personal-agent session after intent or assignment work has committed. */
export function requestIntentPursuit(data: { intentId: string; userId: string }): Promise<void> {
  return publishUserEvent(data.userId, {
    type: 'intent.pursuit', id: crypto.randomUUID(), title: 'Signal ready', body: 'Your agent can pursue this signal.',
    data: { intentId: data.intentId },
  });
}

/** Host follow-up: independent scoring and a wake-up for the existing personal-agent session. */
export class IntentIndexing implements IntentFollowUp {
  /** @param data - Saved owner and exact final text. @returns After scheduling best-effort metadata work. */
  scoreIntent(data: { intentId: string; userId: string; payload: string }): Promise<unknown> {
    background('intent-score', async () => {
      const metadata = await new Intents().scoreIntent(data.payload);
      await intentDatabaseAdapter.updateSemanticMetadata(data.intentId, data.userId, data.payload, metadata);
    });
    return Promise.resolve();
  }

  /** @param data - Intent whose creation/update and assignments have completed. @returns Event delivery. */
  async onIntentSaved(data: { intentId: string; userId: string }): Promise<unknown> {
    const intent = await intentDatabaseAdapter.getIntentById(data.intentId, data.userId);
    if (!intent || intent.archivedAt || (intent.status != null && intent.status !== 'ACTIVE')) return;
    // Creation/update announcements follow the graph's completed assignments,
    // so a newly started session cannot be woken by the pre-assignment row write.
    await publishIntentLifecycle(data.userId, data.intentId, 'ACTIVE', intent.updatedAt.getTime());
    return requestIntentPursuit(data);
  }

  /** @param _data - Archived intent; its lifecycle event stops the session. @returns Completion. */
  onIntentArchived(_data: { intentId: string }): Promise<unknown> { return Promise.resolve(); }

  /** @param data - Resumed intent. @returns Event delivery; failure retains protocol resume compensation. */
  onIntentResumed(data: { intentId: string; userId: string; lifecycleVersionMs: number }): Promise<unknown> {
    return requestIntentPursuit(data);
  }
}

export const intentIndexing = new IntentIndexing();
