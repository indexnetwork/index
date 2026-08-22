/**
 * HyDE corpus prompts and constants tests.
 * Validates that prompt templates produce non-empty strings containing the source text.
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, expect, it } from 'bun:test';
import { HYDE_CORPUS_PROMPTS, HYDE_DEFAULT_CACHE_TTL } from '../hyde.strategies.js';

describe('HyDE Corpus Prompts', () => {
  it('profiles prompt embeds source text and lens with intent-aware framing', () => {
    const result = HYDE_CORPUS_PROMPTS.profiles('Looking for a React co-founder', 'senior frontend engineer');
    expect(result).toContain('Looking for a React co-founder');
    expect(result).toContain('senior frontend engineer');
    expect(result).toContain('fulfill');
    expect(result.length).toBeGreaterThan(0);
  });

  it('intents prompt embeds source text and lens', () => {
    const result = HYDE_CORPUS_PROMPTS.intents('I need funding for my startup', 'early-stage VC investor');
    expect(result).toContain('I need funding for my startup');
    expect(result).toContain('early-stage VC investor');
    expect(result.length).toBeGreaterThan(0);
  });

  it('HYDE_DEFAULT_CACHE_TTL is 1 hour in seconds', () => {
    expect(HYDE_DEFAULT_CACHE_TTL).toBe(3600);
  });

  it('premises prompt embeds source text and lens with identity framing', () => {
    const result = HYDE_CORPUS_PROMPTS.premises('Passionate about decentralized governance', 'community-first builder');
    expect(result).toContain('Passionate about decentralized governance');
    expect(result).toContain('community-first builder');
    expect(result.length).toBeGreaterThan(0);
  });

  it('all three corpus types have prompt templates', () => {
    expect(typeof HYDE_CORPUS_PROMPTS.profiles).toBe('function');
    expect(typeof HYDE_CORPUS_PROMPTS.intents).toBe('function');
    expect(typeof HYDE_CORPUS_PROMPTS.premises).toBe('function');
  });
});
