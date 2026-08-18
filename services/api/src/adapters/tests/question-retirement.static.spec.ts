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
const questionerQueue = read('../../queues/questioner.queue.ts');

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
      expect(questionerQueue).not.toContain('uptake');
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
});
