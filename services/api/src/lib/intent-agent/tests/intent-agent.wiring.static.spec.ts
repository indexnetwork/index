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
  it('the chat controller routes every intent-scoped negotiator turn through the serialized inbox — ownership is unconditional', () => {
    const controller = read('src/controllers/chat.controller.ts');
    // Phase 2 (full chat ownership): the parked-set ownership gate is gone —
    // the agent owns the turn because the scope is its, not because
    // something happens to be parked.
    expect(controller).not.toContain('intentAgentOwnsTurn');
    expect(controller).toContain('runUserMessageTurn');
    // The reply streams over the turn's channel, subscribed before enqueue.
    expect(controller.indexOf('subscribeIntentAgentReply(')).toBeGreaterThan(0);
    expect(controller.indexOf('subscribeIntentAgentReply(')).toBeLessThan(controller.indexOf('runIntentAgentUserTurn({'));
    // Order: the agent turn is decided before the orchestrator stream is
    // even constructed — no persona tool can consume an answer first.
    expect(controller.indexOf('runUserMessageTurn')).toBeLessThan(controller.indexOf('streamChatEventsWithContext'));
    // The replaced gate machinery is gone, not dormant.
    expect(controller).not.toContain('evaluateQuestionAnswerPrecedence');
    expect(controller).not.toContain('enqueueQuestionAnswerReply');
  });

  it('the negotiator persona graph is retired from chat — no factory derivation, no persona tool registrations for this scope', () => {
    const controller = read('src/controllers/chat.controller.ts');
    const service = read('src/services/chat.service.ts');
    // Phase 2: intent-scope negotiator turns never invoke the persona
    // factory; the persona's chat-side tool registrations (answer, verdict,
    // memory) died with it. The MCP surface registers the shared hosts
    // through its own toolDeps and is deliberately untouched.
    expect(controller).not.toContain('getNegotiatorGraphFactory');
    expect(service).not.toContain('getNegotiatorGraphFactory');
    expect(service).not.toContain('createNegotiatorPersona');
    const mcp = read('src/controllers/mcp.controller.ts');
    expect(mcp).toContain('negotiatorAnswerTools');
    expect(mcp).toContain('negotiatorVerdictTools');
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
