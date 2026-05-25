/**
 * HyDE Generator agent tests.
 * Tests lens-based generation for both corpus types (profiles and intents).
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, expect, it, beforeAll } from 'bun:test';
import { HydeGenerator, type HydeGenerateInput } from '../hyde.generator.js';

describe('HydeGenerator', () => {
  let generator: HydeGenerator;

  beforeAll(() => {
    generator = new HydeGenerator();
  });

  describe('profiles corpus', () => {
    it('generates a professional biography for a person-type lens', async () => {
      const input: HydeGenerateInput = {
        sourceText: 'Looking for a technical co-founder to build a B2B SaaS in AI.',
        lens: 'senior full-stack engineer with AI/ML experience',
        corpus: 'profiles',
      };
      const result = await generator.generate(input);
      expect(result.text.length).toBeGreaterThan(0);
    }, 30_000);

    it('generates an investor profile for an investor lens', async () => {
      const input: HydeGenerateInput = {
        sourceText: 'Building a fintech startup seeking seed funding.',
        lens: 'early-stage fintech investor',
        corpus: 'profiles',
      };
      const result = await generator.generate(input);
      expect(result.text.length).toBeGreaterThan(0);
    }, 30_000);
  });

  describe('intents corpus', () => {
    it('generates a goal statement for a complementary lens', async () => {
      const input: HydeGenerateInput = {
        sourceText: 'I offer React and TypeScript consulting.',
        lens: 'startup looking for frontend development help',
        corpus: 'intents',
      };
      const result = await generator.generate(input);
      expect(result.text.length).toBeGreaterThan(0);
    }, 30_000);

    it('generates a collaboration-seeking statement', async () => {
      const input: HydeGenerateInput = {
        sourceText: 'Looking for a design co-founder for a consumer app.',
        lens: 'designer seeking a technical co-founder for a consumer product',
        corpus: 'intents',
      };
      const result = await generator.generate(input);
      expect(result.text.length).toBeGreaterThan(0);
    }, 30_000);
  });

  describe('premises corpus', () => {
    it('generates an identity statement for a premise lens', async () => {
      const input: HydeGenerateInput = {
        sourceText: 'I believe in open-source collaboration and decentralized governance.',
        lens: 'community-driven builder passionate about open protocols',
        corpus: 'premises',
      };
      const result = await generator.generate(input);
      expect(result.text.length).toBeGreaterThan(0);
    }, 30_000);
  });

  describe('output structure', () => {
    it('returns an object with text property', async () => {
      const input: HydeGenerateInput = {
        sourceText: 'We are hiring a senior backend engineer.',
        lens: 'experienced Go/Rust backend engineer seeking new role',
        corpus: 'profiles',
      };
      const result = await generator.generate(input);
      expect(result).toHaveProperty('text');
      expect(typeof result.text).toBe('string');
    }, 30_000);
  });
});
