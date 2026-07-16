/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, expect, it } from "bun:test";
import type { Runnable } from "@langchain/core/runnables";
import { OpportunityEvaluator, type EvaluatorInput } from "../opportunity.evaluator.js";

describe('OpportunityEvaluator', () => {
  const evaluator = new OpportunityEvaluator();

  describe('invokeEntityBundle', () => {
    it('returns no opportunities when entity-bundle model returns empty (e.g. already know each other)', async () => {
      const mockEntityBundleModel = {
        invoke: async () => ({ opportunities: [] }),
      } as unknown as Runnable;
      const evaluatorWithMock = new OpportunityEvaluator({
        entityBundleModel: mockEntityBundleModel,
      });
      const input: EvaluatorInput = {
        discovererId: 'discoverer-1',
        entities: [
          {
            userId: 'user-a',
            profile: {
              name: 'Alice',
              bio: 'Co-founder at Acme Corp.',
              context: 'Building Acme Corp. with Bob.',
            },
            networkId: 'index-1',
          },
          {
            userId: 'user-b',
            profile: {
              name: 'Bob',
              bio: 'Co-founder at Acme Corp.',
              context: 'Building Acme Corp. with Alice.',
            },
            networkId: 'index-1',
          },
        ],
      };
      const result = await evaluatorWithMock.invokeEntityBundle(input, { minScore: 70 });
      expect(result).toHaveLength(0);
    });

    it('includes same-side matching rule in entity bundle prompt', async () => {
      let capturedMessages: unknown[] = [];
      const mockEntityBundleModel = {
        invoke: async (messages: unknown[]) => {
          capturedMessages = messages;
          return { opportunities: [] };
        },
      } as unknown as Runnable;

      const evaluatorWithMock = new OpportunityEvaluator({ entityBundleModel: mockEntityBundleModel });

      const input: EvaluatorInput = {
        discovererId: 'user-1',
        entities: [
          {
            userId: 'user-1',
            profile: { name: 'Alice', bio: 'Founder raising capital' },
            intents: [{ intentId: 'i1', payload: 'Looking for investors' }],
            networkId: 'idx-1',
          },
          {
            userId: 'user-2',
            profile: { name: 'Bob', bio: 'Founder raising capital' },
            intents: [{ intentId: 'i2', payload: 'Seeking investors for my startup' }],
            networkId: 'idx-1',
          },
        ],
        discoveryQuery: 'find me investors',
      };

      await evaluatorWithMock.invokeEntityBundle(input, { minScore: 30 });

      // Verify the system prompt contains same-side matching rule
      const systemMsg = capturedMessages[0] as { content: string };
      expect(systemMsg.content).toContain('SAME-SIDE MATCHING');
      expect(systemMsg.content).toContain('retrieval context only');
      expect(systemMsg.content).not.toContain('CO-ATTENDANCE SIGNAL');
      expect(systemMsg.content).not.toContain('CO-ATTENDANCE ROLE');

      // Verify the human message contains same-side check in discovery query rules
      const humanMsg = capturedMessages[1] as { content: string };
      expect(humanMsg.content).toContain('SAME-SIDE CHECK');
    }, 10000);

    it('rejects unsupported presence claims before score filtering and returnAll', async () => {
      const mockEntityBundleModel = {
        invoke: async () => ({
          opportunities: [
            {
              reasoning: 'The source and candidate attended the same event.',
              score: 99,
              actors: [
                { userId: 'user-1', role: 'peer', intentId: null },
                { userId: 'user-2', role: 'peer', intentId: null },
              ],
            },
            {
              reasoning: 'The candidate builds privacy tools that match the source goal.',
              score: 40,
              actors: [
                { userId: 'user-1', role: 'patient', intentId: null },
                { userId: 'user-2', role: 'agent', intentId: null },
              ],
            },
          ],
        }),
      } as unknown as Runnable;
      const evaluatorWithMock = new OpportunityEvaluator({
        entityBundleModel: mockEntityBundleModel,
      });
      const input: EvaluatorInput = {
        discovererId: 'user-1',
        entities: [
          { userId: 'user-1', profile: { name: 'Alice' }, networkId: 'event-1' },
          { userId: 'user-2', profile: { name: 'Bob' }, networkId: 'event-1' },
        ],
      };

      const returnAll = await evaluatorWithMock.invokeEntityBundle(input, {
        minScore: 70,
        returnAll: true,
      });
      expect(returnAll).toHaveLength(1);
      expect(returnAll[0].reasoning).toContain('privacy tools');

      const scoreFiltered = await evaluatorWithMock.invokeEntityBundle(input, {
        minScore: 70,
      });
      expect(scoreFiltered).toHaveLength(0);
    });

    it.skip('returns no opportunity when entities clearly already know each other (e.g. co-founders) [integration: live LLM]', async () => {
      const input: EvaluatorInput = {
        discovererId: 'discoverer-1',
        entities: [
          {
            userId: 'user-a',
            profile: {
              name: 'Alice',
              bio: 'Co-founder at Acme Corp.',
              context: 'Building Acme Corp. with Bob.',
            },
            networkId: 'index-1',
          },
          {
            userId: 'user-b',
            profile: {
              name: 'Bob',
              bio: 'Co-founder at Acme Corp.',
              context: 'Building Acme Corp. with Alice.',
            },
            networkId: 'index-1',
          },
        ],
      };
      const result = await evaluator.invokeEntityBundle(input, { minScore: 70 });
      expect(result).toHaveLength(0);
    }, 30000);
  });
});
