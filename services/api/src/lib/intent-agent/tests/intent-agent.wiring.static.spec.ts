/**
 * Static wiring pins for the intent-agent collapse
 * (docs/plans/2026-08-21-holistic-intent-agent.md). The collapse is an
 * ORDER and a routing as much as it is code: the agent's turn must sit
 * before the persona stream (the 2026-08-20 incident's fix, kept by
 * construction), every park must route to the inbox, and the deleted
 * judgment stages must stay deleted. Source-text pins, no runtime.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (relative: string) => readFileSync(join(__dirname, '../../../..', relative), 'utf8');

describe('intent-agent wiring', () => {
  it('the chat controller routes the owned turn through the serialized inbox, before the persona stream', () => {
    const controller = read('src/controllers/chat.controller.ts');
    expect(controller).toContain('intentAgentOwnsTurn');
    expect(controller).toContain('runUserMessageTurn');
    // Order: the agent turn is decided before the orchestrator stream is
    // even constructed — no persona tool can consume an answer first.
    expect(controller.indexOf('runUserMessageTurn')).toBeLessThan(controller.indexOf('streamChatEventsWithContext'));
    // The replaced gate machinery is gone, not dormant.
    expect(controller).not.toContain('evaluateQuestionAnswerPrecedence');
    expect(controller).not.toContain('enqueueQuestionAnswerReply');
  });

  it('every park wakes the agent through the one enqueue seam, behind the principal fence', () => {
    const enqueue = read('src/queues/parked-question.enqueue.ts');
    expect(enqueue).toContain('routeParkedQuestionEnqueue');
    expect(enqueue).toContain('addNeedsInputEvent');
    expect(enqueue).toContain('resolvePrincipalUnreachable');
    expect(enqueue).not.toContain('addRegenerateJob');
  });

  it('the inbox worker starts with the other queue workers and closes with them', () => {
    const main = read('src/main.ts');
    expect(main).toContain('intentAgentQueue.startWorker()');
    expect(main).toContain('intentAgentQueue.close()');
  });

  it('the question-message queue no longer authors or consumes — close-out only', () => {
    const queue = read('src/queues/question-message.queue.ts');
    expect(queue).not.toContain('QuestionMessageAuthor');
    expect(queue).not.toContain('consume_question_answers');
    expect(queue).toContain('close_out_question_message');
  });
});
