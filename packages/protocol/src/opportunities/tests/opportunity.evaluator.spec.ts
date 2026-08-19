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
        invoke: async () => ({
          verdicts: [{ candidateId: 'user-b', accepted: false, score: 0, reasoning: 'They already know each other.', actors: [] }],
        }),
      } as unknown as Runnable;
      const evaluatorWithMock = new OpportunityEvaluator({
        entityBundleModel: mockEntityBundleModel,
      });
      const input: EvaluatorInput = {
        discovererId: 'discoverer-1',
        entities: [
          {
            userId: 'discoverer-1',
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
          return {
            verdicts: [{ candidateId: 'user-2', accepted: false, score: 0, reasoning: 'Same-side match.', actors: [] }],
          };
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
          verdicts: [
            {
              candidateId: 'user-2', accepted: true,
              reasoning: 'The source and candidate attended the same event.',
              score: 99,
              actors: [
                { userId: 'user-1', role: 'peer', intentId: null },
                { userId: 'user-2', role: 'peer', intentId: null },
              ],
            },
            {
              candidateId: 'user-3', accepted: true,
              reasoning: 'The candidate builds privacy tools that match the source goal.',
              score: 40,
              actors: [
                { userId: 'user-1', role: 'patient', intentId: null },
                { userId: 'user-3', role: 'agent', intentId: null },
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
          { userId: 'user-3', profile: { name: 'Cara' }, networkId: 'event-1' },
        ],
      };

      const returnAll = await evaluatorWithMock.invokeEntityBundle(input, {
        minScore: 70,
        returnAll: true,
      });
      const persistable = returnAll.filter((op) => op.rejection === undefined);
      expect(persistable).toHaveLength(1);
      expect(persistable[0].reasoning).toContain('privacy tools');
      // The claim-guard drop is reported, not swallowed: `returnAll` callers trace
      // every candidate and must be able to say why this one produced nothing.
      const dropped = returnAll.filter((op) => op.rejection !== undefined);
      expect(dropped).toHaveLength(1);
      expect(dropped[0].rejection).toEqual({ candidateId: 'user-2', reason: 'unsupported_claim' });
      expect(dropped[0].actors).toEqual([]);

      const scoreFiltered = await evaluatorWithMock.invokeEntityBundle(input, {
        minScore: 70,
      });
      expect(scoreFiltered).toHaveLength(0);
    });

    it('retries once then fails closed when a batch omits a candidate verdict', async () => {
      let calls = 0;
      const mockEntityBundleModel = {
        invoke: async () => {
          calls++;
          return {
            verdicts: [
              {
                candidateId: 'user-2',
                accepted: true,
                score: 90,
                reasoning: 'The candidate can help the source.',
                actors: [
                  { userId: 'user-1', role: 'patient', intentId: null },
                  { userId: 'user-2', role: 'agent', intentId: null },
                ],
              },
            ],
          };
        },
      } as unknown as Runnable;
      const evaluatorWithMock = new OpportunityEvaluator({ entityBundleModel: mockEntityBundleModel });
      const input: EvaluatorInput = {
        discovererId: 'user-1',
        entities: [
          { userId: 'user-1', profile: {}, networkId: 'idx-1' },
          { userId: 'user-2', profile: {}, networkId: 'idx-1' },
          { userId: 'user-3', profile: {}, networkId: 'idx-1' },
        ],
      };

      await expect(evaluatorWithMock.invokeEntityBundle(input, { minScore: 50 })).rejects.toThrow('evaluator-incomplete');
      expect(calls).toBe(2);
    });

    it('does not silently accept a legacy partial opportunities list', async () => {
      let calls = 0;
      const evaluatorWithMock = new OpportunityEvaluator({
        entityBundleModel: { invoke: async () => { calls++; return { opportunities: [] }; } } as unknown as Runnable,
      });
      await expect(evaluatorWithMock.invokeEntityBundle({
        discovererId: 'user-1',
        entities: [
          { userId: 'user-1', profile: {}, networkId: 'idx-1' },
          { userId: 'user-2', profile: {}, networkId: 'idx-1' },
        ],
      })).rejects.toThrow('evaluator-incomplete');
      expect(calls).toBe(2);
    });

    it('keeps an accepted score-50 verdict and excludes its rejected sibling', async () => {
      const evaluatorWithMock = new OpportunityEvaluator({
        entityBundleModel: {
          invoke: async () => ({
            verdicts: [
              { candidateId: 'user-2', accepted: true, score: 50, reasoning: 'A valid threshold match.', actors: [{ userId: 'user-1', role: 'patient', intentId: null }, { userId: 'user-2', role: 'agent', intentId: null }] },
              { candidateId: 'user-3', accepted: false, score: 0, reasoning: 'No match.', actors: [] },
            ],
          }),
        } as unknown as Runnable,
      });
      const result = await evaluatorWithMock.invokeEntityBundle({
        discovererId: 'user-1',
        entities: [
          { userId: 'user-1', profile: {}, networkId: 'idx-1' },
          { userId: 'user-2', profile: {}, networkId: 'idx-1' },
          { userId: 'user-3', profile: {}, networkId: 'idx-1' },
        ],
      }, { minScore: 50 });

      expect(result).toHaveLength(1);
      expect(result[0]?.score).toBe(50);
      expect(result[0]?.actors.map((actor) => actor.userId)).toContain('user-2');
    });

    it('fails closed when an accepted verdict binds actors to a different candidate', async () => {
      let calls = 0;
      const evaluatorWithMock = new OpportunityEvaluator({
        entityBundleModel: {
          invoke: async () => {
            calls++;
            return {
              verdicts: [
                { candidateId: 'user-2', accepted: false, score: 0, reasoning: 'No match.', actors: [] },
                { candidateId: 'user-3', accepted: true, score: 90, reasoning: 'Misbound match.', actors: [{ userId: 'user-1', role: 'patient', intentId: null }, { userId: 'user-2', role: 'agent', intentId: null }] },
              ],
            };
          },
        } as unknown as Runnable,
      });

      await expect(evaluatorWithMock.invokeEntityBundle({
        discovererId: 'user-1',
        entities: [
          { userId: 'user-1', profile: {}, networkId: 'idx-1' },
          { userId: 'user-2', profile: {}, networkId: 'idx-1' },
          { userId: 'user-3', profile: {}, networkId: 'idx-1' },
        ],
      })).rejects.toThrow('evaluator-incomplete');
      expect(calls).toBe(2);
    });

    it('retries one invalid response then returns a complete valid batch', async () => {
      let calls = 0;
      const evaluatorWithMock = new OpportunityEvaluator({
        entityBundleModel: {
          invoke: async () => {
            calls++;
            return calls === 1
              ? { verdicts: [{ candidateId: 'user-2', accepted: false, score: 0, reasoning: 'Missing candidate.', actors: [] }] }
              : { verdicts: [
                { candidateId: 'user-2', accepted: false, score: 0, reasoning: 'No match.', actors: [] },
                { candidateId: 'user-3', accepted: true, score: 75, reasoning: 'Valid match.', actors: [{ userId: 'user-1', role: 'patient', intentId: null }, { userId: 'user-3', role: 'agent', intentId: null }] },
              ] };
          },
        } as unknown as Runnable,
      });

      const result = await evaluatorWithMock.invokeEntityBundle({
        discovererId: 'user-1',
        entities: [
          { userId: 'user-1', profile: {}, networkId: 'idx-1' },
          { userId: 'user-2', profile: {}, networkId: 'idx-1' },
          { userId: 'user-3', profile: {}, networkId: 'idx-1' },
        ],
      }, { minScore: 50 });
      expect(calls).toBe(2);
      expect(result).toHaveLength(1);
      expect(result[0]?.actors.map((actor) => actor.userId)).toEqual(['user-1', 'user-3']);
    });

    it('rethrows transport failures without retrying', async () => {
      let calls = 0;
      const evaluatorWithMock = new OpportunityEvaluator({
        entityBundleModel: {
          invoke: async () => {
            calls++;
            throw new Error('transport unavailable');
          },
        } as unknown as Runnable,
      });

      await expect(evaluatorWithMock.invokeEntityBundle({
        discovererId: 'user-1',
        entities: [
          { userId: 'user-1', profile: {}, networkId: 'idx-1' },
          { userId: 'user-2', profile: {}, networkId: 'idx-1' },
        ],
      })).rejects.toThrow('transport unavailable');
      expect(calls).toBe(1);
    });

    it('retries once then fails closed for duplicate and unknown candidate verdicts', async () => {
      for (const verdicts of [
        [
          { candidateId: 'user-2', accepted: false, score: 0, reasoning: 'No match.', actors: [] },
          { candidateId: 'user-2', accepted: false, score: 0, reasoning: 'Duplicate.', actors: [] },
        ],
        [
          { candidateId: 'user-2', accepted: false, score: 0, reasoning: 'No match.', actors: [] },
          { candidateId: 'unknown', accepted: false, score: 0, reasoning: 'Unknown.', actors: [] },
        ],
      ]) {
        let calls = 0;
        const evaluatorWithMock = new OpportunityEvaluator({
          entityBundleModel: { invoke: async () => { calls++; return { verdicts }; } } as unknown as Runnable,
        });
        await expect(evaluatorWithMock.invokeEntityBundle({
          discovererId: 'user-1',
          entities: [
            { userId: 'user-1', profile: {}, networkId: 'idx-1' },
            { userId: 'user-2', profile: {}, networkId: 'idx-1' },
            { userId: 'user-3', profile: {}, networkId: 'idx-1' },
          ],
        })).rejects.toThrow('evaluator-incomplete');
        expect(calls).toBe(2);
      }
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
