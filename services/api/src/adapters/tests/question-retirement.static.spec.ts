/**
 * Static retirement invariants for the card-question generators
 * (docs/plans/2026-08-18-conversational-questions.md, "Retirements").
 *
 * Each retired generator gets one block proving its trigger can no longer
 * enqueue: the wiring that used to hand the QuestionerAgent a payload is gone
 * from the source that owned it, and the one-time migration voiding its
 * leftover pending rows exists with the auditable `retired_mode` marker.
 * Static source assertions are the repo's idiom for trigger-wiring
 * properties (see negotiation-question-routing.static.spec.ts).
 */
import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

const read = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const main = read('../../main.ts');
const opportunityService = read('../../services/opportunity.service.ts');
const opportunityTools = read('../../../../../packages/protocol/src/opportunities/opportunity.tools.ts');
const parkedEnqueue = read('../../queues/parked-question.enqueue.ts');

describe('question retirement static invariants', () => {
  describe('pre-accept uptake', () => {
    it('no longer enqueues from the opportunity-pending trigger', () => {
      // The onPending → UptakeQuestionService → addGenerateJob chain is gone:
      // the service and its adapter no longer exist, and main.ts wires no
      // question work onto the pending transition.
      expect(existsSync(new URL('../../services/uptake-question.service.ts', import.meta.url))).toBe(false);
      expect(existsSync(new URL('../../adapters/uptake-question.database.adapter.ts', import.meta.url))).toBe(false);
      expect(main).not.toContain('uptakeQuestionService');
      expect(main).not.toContain('OpportunityEvents.onPending');
      expect(existsSync(new URL('../../queues/questioner.queue.ts', import.meta.url))).toBe(false);
    });

    it('acceptance paths carry no advisory interlock', () => {
      expect(existsSync(new URL('../../lib/opportunity/uptake-acceptance.guard.ts', import.meta.url))).toBe(false);
      expect(opportunityService).not.toContain('uptake');
      expect(opportunityTools).not.toContain('uptake');
    });

    it('voids its leftover pending rows with the retired_mode marker', () => {
      const migration = read('../../../drizzle/0132_dismiss_retired_uptake_questions.sql');
      expect(migration).toContain("detection->>'purpose' = 'uptake'");
      expect(migration).toContain("'\"retired_mode\"'::jsonb");
      expect(migration).toContain("status = 'pending'");
    });
  });

  describe('pool-discriminator mining', () => {
    it('no longer enqueues from any discovery-completion or visit trigger', () => {
      // The mining hook, its deterministic question synthesis, the proactive
      // push cycle (worker + minutely recovery sweep), the visit-triggered
      // re-mine, and the answer-reaction chaining are all gone.
      for (const relative of [
        '../../queues/pool/mining.shared.ts',
        '../../queues/pool/question.shared.ts',
        '../../queues/pool/questionpush.queue.ts',
        '../../queues/pool/visitmining.queue.ts',
        '../../queues/pool/answer.shared.ts',
        '../../queues/pool/newborn.shared.ts',
        '../../events/handlers/question.answer.pool.ts',
      ]) {
        expect(existsSync(new URL(relative, import.meta.url))).toBe(false);
      }
      const fromIntent = read('../../queues/opportunity/from-intent.queue.ts');
      expect(fromIntent).not.toContain('minePoolDiscriminators');
      expect(fromIntent).not.toContain('pool_answer');
      expect(parkedEnqueue).not.toContain('pool_discovery');
      expect(main).not.toContain('poolQuestionPushQueue');
      expect(main).not.toContain('handlePoolAnswer');
      expect(main).not.toContain('handleMaterialIntentUpdate');
      expect(read('../../controllers/question.controller.ts')).not.toContain('VisitPoolMining');
    });

    it('keeps the Lens C evidence shadow alive on its own flag', () => {
      const fromIntent = read('../../queues/opportunity/from-intent.queue.ts');
      expect(fromIntent).toContain('maybeRunNegotiationEvidenceShadow');
    });

    it('voids its leftover pending rows with the retired_mode marker', () => {
      const migration = read('../../../drizzle/0133_dismiss_retired_pool_questions.sql');
      expect(migration).toContain("detection->>'mode' = 'pool_discovery'");
      expect(migration).toContain("'\"retired_mode\"'::jsonb");
      expect(migration).toContain("status = 'pending'");
    });
  });

  describe('post-discovery recovery', () => {
    it('no longer enqueues from any discovery-completion trigger', () => {
      // The failure-isolated completion hook, its shared enqueue wrapper, and
      // the dedicated recovery job are gone; the refinement service admits
      // only the intent-creation source.
      expect(existsSync(new URL('../../queues/questioner/recovery.shared.ts', import.meta.url))).toBe(false);
      const fromIntent = read('../../queues/opportunity/from-intent.queue.ts');
      expect(fromIntent).not.toContain('recoverAfterCompletion');
      expect(fromIntent).not.toContain('maybeEnqueueIntentRecovery');
      expect(parkedEnqueue).not.toContain('recovery');
      // The whole refinement service retired with intent refinement (next
      // block); nothing remains that could consume a recovery completion.
      expect(existsSync(new URL('../../services/intent-recovery-refinement.service.ts', import.meta.url))).toBe(false);
    });

    it('voids its leftover pending rows with the retired_mode marker', () => {
      const migration = read('../../../drizzle/0134_dismiss_retired_recovery_questions.sql');
      expect(migration).toContain("detection->>'purpose' = 'recovery'");
      expect(migration).toContain("IN ('from_intent', 'discovery_run')");
      expect(migration).toContain("'\"retired_mode\"'::jsonb");
      expect(migration).toContain("status = 'pending'");
    });
  });

  describe('intent refinement', () => {
    it('no longer enqueues from intent creation, the intent graph, or the answer reaction', () => {
      // The refinement service, its answer-driven refinement reaction, and the
      // backfill CLI are gone; no composition site passes a questioner enqueue
      // into the Intents graph; the worker drops stale intent-mode payloads.
      for (const relative of [
        '../../services/intent-recovery-refinement.service.ts',
        '../../events/handlers/question.answer.intent.ts',
        '../../cli/backfill-intent-questions.ts',
      ]) {
        expect(existsSync(new URL(relative, import.meta.url))).toBe(false);
      }
      const intentService = read('../../services/intent.service.ts');
      expect(intentService).not.toContain('questionerEnqueue');
      const intentGraphExecute = read('../../../../../packages/protocol/src/intents/graph/intent.graph.execute.ts');
      expect(intentGraphExecute).not.toContain('questionerEnqueue');
      expect(main).not.toContain('enqueueIntentRefinement');
    });

    it('voids its leftover pending rows with the retired_mode marker', () => {
      const migration = read('../../../drizzle/0135_dismiss_retired_intent_questions.sql');
      expect(migration).toContain("detection->>'mode' = 'intent'");
      expect(migration).toContain("'\"retired_mode\"'::jsonb");
      expect(migration).toContain("status = 'pending'");
    });
  });

  describe('chat ask_user_question', () => {
    it('no longer mints chat-mode rows from any chat or intake surface', () => {
      // The blocking tool, its wait bus, the host bridge, and the fast-intake
      // analytics mirror are gone; personas ask in plain conversation.
      expect(existsSync(new URL('../../lib/chat-question.events.ts', import.meta.url))).toBe(false);
      expect(existsSync(new URL(
        '../../../../../packages/protocol/src/questions/question.ask.tool.ts',
        import.meta.url,
      ))).toBe(false);
      expect(read('../../controllers/mcp.controller.ts')).not.toContain('chatQuestions');
      expect(read('../../services/signal-intake.service.ts')).not.toContain('recordAnsweredQuestion');
      for (const persona of ['signal', 'onboarding']) {
        expect(read(
          `../../../../../packages/protocol/src/chat/${persona}.persona.ts`,
        )).not.toContain('ask_user_question');
      }
    });

    it('voids its leftover pending rows with the retired_mode marker', () => {
      const migration = read('../../../drizzle/0136_dismiss_retired_chat_questions.sql');
      expect(migration).toContain("detection->>'mode' = 'chat'");
      expect(migration).toContain("'\"retired_mode\"'::jsonb");
      expect(migration).toContain("status = 'pending'");
    });
  });

  describe('generation half', () => {
    it('deletes the QuestionerAgent, its presets, and the generation envelope', () => {
      for (const relative of [
        '../../../../../packages/protocol/src/questions/question.agent.ts',
        '../../../../../packages/protocol/src/questions/question.presets.ts',
        '../../../../../packages/protocol/src/questions/question.ask.tool.ts',
        '../../queues/questioner.queue.ts',
      ]) {
        expect(existsSync(new URL(relative, import.meta.url))).toBe(false);
      }
      // The input union admits only the two park families; the generator's
      // per-mode envelope, its runtime contract, and the master switch died
      // with the queue.
      const input = read('../../../../../packages/protocol/src/questions/question.input.ts');
      expect(input).toContain('PostStallQuestionerInput');
      expect(input).toContain('InflightQuestionerInput');
      for (const retired of [
        'isValidQuestionerInputContract',
        'UptakeQuestionerInput',
        'RecoveryQuestionerInput',
        'ChatContext',
        'PoolDiscoveryContext',
        'StandardQuestionerInput',
      ]) {
        expect(input).not.toContain(retired);
      }
      expect(read('../../../../../packages/protocol/src/questions/question.env.ts'))
        .not.toContain('QUESTIONER_ENABLED');
      expect(main).not.toContain('QUESTIONER_ENABLED');
      // The park routing is unconditional: composition sites inject
      // parkedQuestionEnqueue, which drops retired families.
      expect(main).toContain('parkedQuestionEnqueue');
      expect(parkedEnqueue).toContain('routeParkedQuestionEnqueue');
    });
  });

  describe('adapter surface', () => {
    it('keeps only the settlement core and names the table drop', () => {
      const adapter = read('../questioner.adapter.ts');
      // Survivors: park/resume settlement, the DM answer settle, Lens C
      // evidence reads, and the leftover-row void.
      for (const survivor of [
        'settleInflightNegotiationAnswerFromDm',
        'expireInflightQuestion',
        'recordOpportunityUserAnswer',
        'claimNegotiationContinuationExecution',
        'getAnsweredNegotiationQuestionsForOpportunity',
        'voidLeftoverQuestion',
        'TODO(questions-table drop)',
      ]) {
        expect(adapter).toContain(survivor);
      }
      // The generation/read/card-answer surface is gone.
      for (const retired of [
        'prepareNegotiationQuestion',
        'persistFreshNegotiationQuestions',
        'prepareRecoveryRefinement',
        'bindChatQuestionsToMessage',
        'persistFreshPoolQuestion',
        'findPending',
        'findAnswered',
        'countPending',
        'aggregateQuestionFunnel',
        'handleMaterialIntentUpdate',
        'claimPoolQuestionPush',
        'async answer(',
        'async dismiss(',
        'async persist(',
      ]) {
        expect(adapter).not.toContain(retired);
      }
    });
  });
});
