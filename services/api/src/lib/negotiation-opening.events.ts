import type { UserEvent } from './user-events';

interface Opening {
  opportunityId: string;
  initiatorUserId: string;
  initiatorIntentId: string;
}

/** Wake only the first-turn owner after creation commits, without rolling back any opened pairs. */
export async function publishOpeningTurns(
  opened: readonly Opening[],
  publish: (userId: string, event: UserEvent) => Promise<unknown>,
  onError: (opportunityId: string, error: unknown) => void,
): Promise<void> {
  await Promise.all(opened.map(async (opening) => {
    try {
      await publish(opening.initiatorUserId, {
        type: 'negotiation.turn',
        id: `${opening.opportunityId}:0`,
        title: 'Your turn',
        body: 'A new negotiation is waiting for your agent to open it.',
        data: {
          opportunityId: opening.opportunityId,
          intentId: opening.initiatorIntentId,
          turnIndex: 0,
          outcome: null,
          blockedReason: null,
        },
      });
    } catch (error) {
      onError(opening.opportunityId, error);
    }
  }));
}
