/**
 * QuestionAnswerRouter: the model maps a reply onto question INDICES; the
 * router validates the round trip and maps indices back to the block's
 * primary refs. Routing is fail-closed — an invalid mapping retries once and
 * then throws, never degrades to a guess — because a misroute resumes the
 * wrong negotiation with the wrong fact.
 */
import { describe, expect, it } from 'bun:test';

import { questionBlockFixture } from '@indexnetwork/protocol/question-block/fixture';

import { QuestionAnswerRouter } from '../question-answer.router';

class StubRouter extends QuestionAnswerRouter {
  readonly prompts: Array<Array<{ role: string; content: string }>> = [];
  private readonly outputs: unknown[];

  constructor(outputs: unknown[]) {
    super();
    this.outputs = outputs;
  }

  protected override async callModel(messages: Array<{ role: string; content: string }>): Promise<unknown> {
    this.prompts.push(messages);
    if (this.outputs.length === 0) throw new Error('no scripted output left');
    return this.outputs.shift();
  }
}

const block = questionBlockFixture;

describe('QuestionAnswerRouter', () => {
  it('maps question indices back to the block primary refs', async () => {
    const router = new StubRouter([{
      addressesQuestions: true,
      answers: [
        { question: 0, answerText: 'Yes, share the range. ' },
        { question: 1, answerText: 'March at the earliest.' },
      ],
    }]);

    const routed = await router.route({ block, replyText: 'Yes share it; March at the earliest.' });

    expect(routed.addressesQuestions).toBe(true);
    expect(routed.answers).toEqual([
      { ref: block.questions[0].opportunityId, answerText: 'Yes, share the range.' },
      { ref: block.questions[1].opportunityId, answerText: 'March at the earliest.' },
    ]);
    // The model sees prompts by index only — never a negotiation ref.
    expect(router.prompts[0][1].content).not.toContain(block.questions[0].opportunityId);
  });

  it('reports a non-answer reply without routing anything', async () => {
    const router = new StubRouter([{ addressesQuestions: false, answers: [] }]);
    const routed = await router.route({ block, replyText: 'Thanks! How are you?' });
    expect(routed).toEqual({ addressesQuestions: false, answers: [] });
  });

  it('rejects an out-of-range index and accepts the retry', async () => {
    const router = new StubRouter([
      { addressesQuestions: true, answers: [{ question: 99, answerText: 'Ghost answer.' }] },
      { addressesQuestions: true, answers: [{ question: 0, answerText: 'Real answer.' }] },
    ]);
    const routed = await router.route({ block, replyText: 'Real answer.' });
    expect(router.prompts).toHaveLength(2);
    expect(routed.answers).toEqual([{ ref: block.questions[0].opportunityId, answerText: 'Real answer.' }]);
  });

  it('throws after two invalid round trips — no deterministic fallback exists', async () => {
    const duplicate = {
      addressesQuestions: true,
      answers: [
        { question: 0, answerText: 'First.' },
        { question: 0, answerText: 'Second.' },
      ],
    };
    const router = new StubRouter([duplicate, duplicate]);
    await expect(router.route({ block, replyText: 'ambiguous' })).rejects.toThrow('no valid mapping');
  });

  it('rejects the contradictory shape: not an answer, yet routed answers', async () => {
    const router = new StubRouter([
      { addressesQuestions: false, answers: [{ question: 0, answerText: 'Sneaky.' }] },
      { addressesQuestions: true, answers: [{ question: 0, answerText: 'Clean.' }] },
    ]);
    const routed = await router.route({ block, replyText: 'Clean.' });
    expect(routed.answers).toEqual([{ ref: block.questions[0].opportunityId, answerText: 'Clean.' }]);
  });
});
