/**
 * Host bridge behind the `answer_pending_question` tool — the negotiator
 * persona's long-tail lane and the MCP surface's answer lane alike.
 *
 * Since the holistic intent-agent collapse
 * (docs/plans/2026-08-21-holistic-intent-agent.md), what lands here is what
 * did not go through the agent's own inbox: the persona persona-turn's tool
 * call in a DM with nothing parked when the turn started, and external MCP
 * clients answering on their user's behalf. Nothing is re-implemented — the
 * open questions resolve through the SAME call the orchestrator's context
 * enumeration makes (`readOpenQuestionsForIntent`), the number the model was
 * shown maps onto that block's negotiation ref, and the answer executes
 * through the agent's ONE answer executor (`executeAnswerNegotiation`):
 * dossier entry first, then the #1432 settle/claim/resume spine, then the
 * ledger row naming this tool as what woke the act.
 *
 * The tool never sees or emits an id. It is given positions, it returns
 * positions, and this module owns the mapping — the same rule that keeps the
 * agent's turn from minting a ref that would resume the wrong negotiation.
 */
import { readOpenQuestionsForIntent } from './open-question-message';
import type { OpenQuestionsForIntentDeps } from './open-question-message';
import { executeAnswerNegotiation } from '../intent-agent/intent-agent.host';
import type { IntentAgentHostDeps } from '../intent-agent/intent-agent.host';
import { log } from '../log';

const logger = log.lib.from('negotiator-answer.host');

/** Mirrors the protocol's `NegotiatorAnswerRoutingResult`; structural by design. */
export type NegotiatorAnswerRoutingResult =
  | { status: 'routed'; label: string }
  | { status: 'no_open_question' }
  | { status: 'unknown_question'; open: number }
  | { status: 'error' };

/** Injectable seams; production resolves the real collaborators. */
export interface NegotiatorAnswerHostDeps extends OpenQuestionsForIntentDeps {
  executeAnswer?: typeof executeAnswerNegotiation;
  answerHostDeps?: IntentAgentHostDeps;
}

/**
 * Route one answer the caller extracted onto the open question it names.
 *
 * Never throws — a tool that throws costs the client their turn, and the
 * honest failure the model is told to report is strictly better than that.
 */
export async function answerOpenQuestion(
  userId: string,
  input: { intentId: string; question: number; answer: string },
  deps?: NegotiatorAnswerHostDeps,
): Promise<NegotiatorAnswerRoutingResult> {
  try {
    const answerText = input.answer.trim();
    if (!answerText) return { status: 'error' };

    const open = await readOpenQuestionsForIntent(userId, input.intentId, deps);
    // Nothing parked on this user's side for this signal. The only state in
    // which telling the client the negotiations moved on is the truth.
    if (!open || open.questions.length === 0) return { status: 'no_open_question' };

    const question = open.questions.find((candidate) => candidate.position === input.question);
    if (!question) {
      logger.info('negotiator_answer_unknown_question', {
        userId,
        intentId: input.intentId,
        question: input.question,
        open: open.questions.length,
        source: open.source,
      });
      return { status: 'unknown_question', open: open.questions.length };
    }

    const executeAnswer = deps?.executeAnswer ?? executeAnswerNegotiation;
    const executed = await executeAnswer(
      {
        kind: 'answer_tool',
        userId,
        intentId: input.intentId,
        opportunityId: question.opportunityId,
        source: 'persona_tool',
      },
      { opportunityId: question.opportunityId, answer: answerText },
      deps?.answerHostDeps,
    );

    // Resumed or durably recorded: the answer was heard. `not_parked` means
    // the park resolved between the read above and the resume — the copy for
    // `no_open_question` is the truth of that state. The rest are refusals
    // that should be impossible from a position the resolver just served.
    if (executed.outcome === 'not_parked' || executed.outcome === 'no_negotiation') {
      return { status: 'no_open_question' };
    }
    if (executed.outcome === 'wrong_recipient') return { status: 'error' };

    logger.info('negotiator_answer_routed', {
      userId,
      intentId: input.intentId,
      source: open.source,
      opportunityId: question.opportunityId,
      outcome: executed.outcome,
    });
    return { status: 'routed', label: question.label };
  } catch (err) {
    logger.error('negotiator_answer_route_failed', {
      userId,
      intentId: input.intentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: 'error' };
  }
}

/** The host object the composition root injects into the negotiator toolset. */
export const negotiatorAnswerToolsHost = {
  answerOpenQuestion: (
    userId: string,
    input: { intentId: string; question: number; answer: string },
  ) => answerOpenQuestion(userId, input),
};
