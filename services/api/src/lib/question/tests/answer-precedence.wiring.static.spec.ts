/**
 * Static invariants of the answer-precedence WIRING (#1466).
 *
 * The precedence decision itself is unit-tested in `answer-precedence.spec.ts`.
 * What this pins is the thing that unit test cannot reach: the ORDER inside
 * the chat controller's SSE handler, which is the whole fix. The 2026-08-20
 * incident was not a wrong decision by any component — it was the orchestrator
 * running first. A refactor that moves this evaluation back below the stream,
 * or that lets an accepted answer reach the orchestrator anyway, reopens the
 * incident while every unit test still passes.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const controller = readFileSync(new URL('../../../controllers/chat.controller.ts', import.meta.url), 'utf8');
const composition = readFileSync(new URL('../../../controllers/mcp.controller.ts', import.meta.url), 'utf8');
const gate = readFileSync(new URL('../answer-precedence.ts', import.meta.url), 'utf8');
const host = readFileSync(new URL('../negotiator-answer.host.ts', import.meta.url), 'utf8');
const chatService = readFileSync(new URL('../../../services/chat.service.ts', import.meta.url), 'utf8');

describe('answer-precedence wiring', () => {
  it('evaluates precedence BEFORE the orchestrator stream, not after it', () => {
    const evaluated = controller.indexOf('evaluateQuestionAnswerPrecedence');
    const streamed = controller.indexOf('factory.streamChatEventsWithContext');
    const persisted = controller.indexOf('await chatSessionService.addMessage');

    expect(evaluated).toBeGreaterThan(-1);
    expect(streamed).toBeGreaterThan(-1);
    expect(evaluated).toBeLessThan(streamed);
    // And before anything is written, so a decision can still change the turn.
    expect(evaluated).toBeLessThan(persisted);
  });

  it('runs the orchestrator only for a reply the evaluator did not take as an answer', () => {
    // An accepted answer swaps the orchestrator's event stream for an empty
    // one: no tool runs, so the signal edit rule cannot fire on it.
    expect(controller).toContain("answerPrecedence.status === 'answered'");
    expect(controller).toContain('emptyEventStream()');
  });

  it('gates the precedence check on the negotiator DM of one signal', () => {
    expect(controller).toContain("sessionPersona === NEGOTIATOR_PERSONA_ID && effectiveScope?.scopeType === 'intent'");
  });

  it('never enqueues consumption for a reply the evaluator declined', () => {
    // The queue would only re-run the same evaluator on the same text and
    // reach the same verdict. `unavailable` is the exception on purpose: no
    // verdict was reached, so the job is enqueued unrouted and the queue's
    // retry covers the outage.
    expect(controller).toContain("if (answerPrecedence.status !== 'answered' && answerPrecedence.status !== 'unavailable') return;");
    expect(controller).toContain('precedence: {');
  });

  it('registers the long-tail routing tool at the composition root', () => {
    expect(composition).toContain('negotiatorAnswerTools: negotiatorAnswerToolsHost');
  });

  /**
   * The second half of the 2026-08-20 incident was not an order problem: every
   * lane agreed the reply was not an answer, because each one asked whether the
   * newest agent message was a question block. One resolver is what makes them
   * unable to disagree — so it is pinned as wiring, not left to convention.
   */
  it('resolves openness through the one shared resolver in every lane', () => {
    for (const lane of [gate, host, chatService]) {
      expect(lane).toContain('readOpenQuestionsForIntent');
    }
  });

  it('never re-derives openness from the newest agent message', () => {
    // The predicate that buried a live question. Neither lane may reintroduce
    // it: openness is the parked set, and the delivered message is searched
    // for rather than required at the tail.
    for (const lane of [gate, host]) {
      expect(lane).not.toContain("find((message) => message.role === 'assistant')");
    }
  });
});
