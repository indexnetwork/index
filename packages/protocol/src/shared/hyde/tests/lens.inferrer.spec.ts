/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, expect, it, beforeAll } from 'bun:test';
import { LensInferrer, type Lens } from '../lens.inferrer.js';

describe('LensInferrer', () => {
  let inferrer: LensInferrer;

  beforeAll(() => {
    inferrer = new LensInferrer();
  });

  describe('output schema', () => {
    it('returns lenses with label, corpus, and reasoning', async () => {
      const result = await inferrer.infer({
        sourceText: 'I am raising a seed round for my DePIN project',
      });

      expect(result.lenses.length).toBeGreaterThanOrEqual(1);
      expect(result.lenses.length).toBeLessThanOrEqual(5);

      for (const lens of result.lenses) {
        expect(typeof lens.label).toBe('string');
        expect(lens.label.length).toBeGreaterThan(0);
        expect(['profiles', 'intents']).toContain(lens.corpus);
        expect(typeof lens.reasoning).toBe('string');
        expect(lens.reasoning.length).toBeGreaterThan(0);
      }
    }, 30_000);

    it('respects maxLenses cap', async () => {
      const result = await inferrer.infer({
        sourceText: 'I need help with everything: investors, mentors, collaborators, hires, designers',
        maxLenses: 2,
      });

      expect(result.lenses.length).toBeLessThanOrEqual(2);
    }, 30_000);
  });

  describe('corpus assignment', () => {
    it('assigns profiles corpus for person-seeking queries', async () => {
      const result = await inferrer.infer({
        sourceText: 'Looking for an experienced machine learning engineer',
      });

      const profileLenses = result.lenses.filter(l => l.corpus === 'profiles');
      expect(profileLenses.length).toBeGreaterThanOrEqual(1);
    }, 30_000);

    it('assigns intents corpus for goal-complementing queries', async () => {
      const result = await inferrer.infer({
        sourceText: 'I am building a marketplace and looking for early users',
      });

      const intentLenses = result.lenses.filter(l => l.corpus === 'intents');
      expect(intentLenses.length).toBeGreaterThanOrEqual(1);
    }, 30_000);
  });

  describe('profile context', () => {
    it('contextualizes lenses with profile information', async () => {
      const withContext = await inferrer.infer({
        sourceText: 'find me investors',
        profileContext: 'Building decentralized physical infrastructure for IoT sensor networks',
      });

      const withoutContext = await inferrer.infer({
        sourceText: 'find me investors',
      });

      // Both should return valid lenses
      expect(withContext.lenses.length).toBeGreaterThanOrEqual(1);
      expect(withoutContext.lenses.length).toBeGreaterThanOrEqual(1);

      // Context should produce more specific labels (check via domain terms)
      const contextLabels = withContext.lenses.map(l => l.label).join(' ');
      const hasDomainTerms = /depin|iot|sensor|infrastructure|hardware|crypto|decentralized|physical/i.test(contextLabels);
      expect(hasDomainTerms).toBe(true);
    }, 60_000);
  });
});
