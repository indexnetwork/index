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
    // #1494: the negotiator's chat-side answer-routing tools died with
    // consult/park-settlement — needs_principal is a pause turn now, not a
    // question the persona answers out of band. negotiatorVerdictTools (the
    // owner's accept/reject lever) is untouched.
    expect(mcp).not.toContain('negotiatorAnswerTools');
    expect(mcp).toContain('negotiatorVerdictTools');
  });

  it('#1494: the park-payload enqueue seam is retired, not repointed — a pause is a persisted turn, not a separate wake event', () => {
    // NegotiationGraph's apply node never calls an injected questioner-enqueue
    // callback; the routing layer that used to carry one has nothing left to
    // route. Waking the principal from a pause is IS-A's reflect phase
    // (step 2 of the personal-agent-and-negotiation-graphs plan), not this.
    expect(() => read('src/queues/parked-question.enqueue.ts')).toThrow();
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
