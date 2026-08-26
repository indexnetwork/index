import { describe, expect, it, mock } from 'bun:test';
import { PersonalAgentTurns } from '../personal-agent';
import type { PersonalAgentInput, PersonalAgentResult } from '@indexnetwork/protocol';

function emptyResult(): PersonalAgentResult {
  return { acts: [], messages: [], error: undefined } as PersonalAgentResult;
}

describe('PersonalAgentTurns', () => {
  it('serializes turns for the same intent', async () => {
    const order: string[] = [];
    const invoke = mock(async (input: PersonalAgentInput) => {
      order.push('start:' + (input as { event: string }).event);
      await new Promise((r) => setTimeout(r, 20));
      order.push('end:' + (input as { event: string }).event);
      return emptyResult();
    });
    const turns = new PersonalAgentTurns(invoke, async () => {});
    await Promise.all([
      turns.runUserMessageTurn({
        event: 'user_message',
        userId: 'u1',
        intentId: 'i1',
        messageId: 'm1',
        text: 'hi',
      } as never),
      turns.addMatchesReadyEvent({ userId: 'u1', intentId: 'i1' }),
    ]);
    await new Promise((r) => setTimeout(r, 50));
    expect(order[0]).toBe('start:user_message');
    expect(order[1]).toBe('end:user_message');
  });

  it('runs all_paused once per generation', async () => {
    const invoke = mock(async () => emptyResult());
    const turns = new PersonalAgentTurns(invoke, async () => {});
    const job = { userId: 'u1', intentId: 'i1', round: 1, generation: 'g1' };
    await turns.addAllPausedEvent(job);
    await turns.addAllPausedEvent(job);
    await new Promise((r) => setTimeout(r, 20));
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
