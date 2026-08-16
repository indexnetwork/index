// Env must be set before any imports that transitively call createModel
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect, beforeAll } from 'bun:test';
import { PremiseDecomposer } from '../premise.decomposer.js';

const HAS_OPENROUTER_KEY = !!process.env.OPENROUTER_API_KEY;

describe.skipIf(!HAS_OPENROUTER_KEY)('PremiseDecomposer', () => {
  let decomposer: PremiseDecomposer;

  beforeAll(() => {
    decomposer = new PremiseDecomposer();
  });

  it('should decompose a multi-fact bio into individual premises', async () => {
    const input = "I'm a software engineer at Google based in Mountain View. I specialize in distributed systems and have 5 years of experience in Go and Rust.";

    const result = await decomposer.invoke(input);

    expect(result.premises.length).toBeGreaterThanOrEqual(3);
    expect(result.reasoning).toBeTruthy();

    // All premises should be first-person
    for (const p of result.premises) {
      expect(p.text.toLowerCase()).toMatch(/^i\b/);
      expect(['assertive', 'contextual']).toContain(p.tier);
    }

    // Should contain core facts
    const allText = result.premises.map(p => p.text.toLowerCase()).join(' | ');
    expect(allText).toContain('google');
    expect(allText).toMatch(/mountain view|mv/i);
  }, 30_000);

  it('should convert third-person input to first-person premises', async () => {
    const input = "Jane Doe is a product designer at Figma. She lives in San Francisco and is passionate about accessibility.";

    const result = await decomposer.invoke(input);

    expect(result.premises.length).toBeGreaterThanOrEqual(2);

    // All should be first-person
    for (const p of result.premises) {
      expect(p.text.toLowerCase()).toMatch(/^i\b/);
    }
  }, 30_000);

  it('should classify temporal facts as contextual', async () => {
    const input = "I am attending ETHDenver this week and am currently fundraising for my seed round.";

    const result = await decomposer.invoke(input);

    expect(result.premises.length).toBeGreaterThanOrEqual(2);

    const contextual = result.premises.filter(p => p.tier === 'contextual');
    expect(contextual.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('should return empty array for confirmation-only input', async () => {
    const result = await decomposer.invoke("Yes, create my profile");

    expect(result.premises).toEqual([]);
  }, 30_000);

  it('should return empty array for non-descriptive input', async () => {
    const result = await decomposer.invoke("Hello, how are you?");

    expect(result.premises).toEqual([]);
  }, 30_000);

  it('should handle scraped LinkedIn-style content', async () => {
    const input = `Name: Alex Chen
Location: Berlin, Germany
Current Role: Senior Backend Engineer at Stripe
Previous: Software Engineer at Amazon (3 years)
Skills: Python, Kotlin, PostgreSQL, AWS, microservices architecture
Education: MS Computer Science, Stanford University
Interests: fintech, open-source tooling, developer experience`;

    const result = await decomposer.invoke(input);

    expect(result.premises.length).toBeGreaterThanOrEqual(5);

    const allText = result.premises.map(p => p.text.toLowerCase()).join(' | ');
    expect(allText).toContain('berlin');
    expect(allText).toContain('stripe');
    expect(allText).toContain('stanford');
  }, 30_000);

  it('should flag disavowed existing premises for retraction', async () => {
    const existing = [
      { id: '11111111-1111-1111-1111-111111111111', text: 'I am the creator of the HOPE programming language' },
      { id: '22222222-2222-2222-2222-222222222222', text: 'I specialize in compiler design' },
      { id: '33333333-3333-3333-3333-333333333333', text: 'I am based in Istanbul' },
    ];

    const result = await decomposer.invoke(
      'Remove all mentions of the HOPE programming language. I have nothing to do with it.',
      existing,
    );

    expect(result.retractedPremiseIds).toContain('11111111-1111-1111-1111-111111111111');
    expect(result.retractedPremiseIds).not.toContain('22222222-2222-2222-2222-222222222222');
    expect(result.retractedPremiseIds).not.toContain('33333333-3333-3333-3333-333333333333');

    // The denial itself must not become a new premise
    const allText = result.premises.map(p => p.text.toLowerCase()).join(' | ');
    expect(allText).not.toContain('hope');
  }, 30_000);

  it('should revise the bio when the input disavows facts that appear in it', async () => {
    const result = await decomposer.invoke(
      'Remove all mentions of the HOPE programming language. I have nothing to do with it.',
      [{ id: '11111111-1111-1111-1111-111111111111', text: 'I am the creator of the HOPE programming language' }],
      'Software Engineer specializing in memory management. Creator of the HOPE Programming Language. Experienced in Linux.',
    );

    expect(result.revisedBio).toBeTruthy();
    expect(result.revisedBio!.toLowerCase()).not.toContain('hope');
    // Undisputed facts survive the rewrite
    expect(result.revisedBio!.toLowerCase()).toContain('linux');
  }, 30_000);

  it('should return null revisedBio when the bio is unaffected', async () => {
    const result = await decomposer.invoke(
      'I also enjoy woodworking on weekends.',
      [],
      'Software Engineer experienced in Linux.',
    );

    expect(result.revisedBio).toBeNull();
  }, 30_000);

  it('should return no retractions when nothing is disavowed', async () => {
    const existing = [
      { id: '11111111-1111-1111-1111-111111111111', text: 'I am a designer' },
    ];

    const result = await decomposer.invoke('I also enjoy woodworking on weekends.', existing);

    expect(result.retractedPremiseIds).toEqual([]);
  }, 30_000);

  it('should skip intents and desires', async () => {
    const input = "I am a designer based in NYC. I'm looking for a co-founder for my startup. I want to find investors.";

    const result = await decomposer.invoke(input);

    // Should extract the factual premises
    const allText = result.premises.map(p => p.text.toLowerCase()).join(' | ');
    expect(allText).toContain('designer');
    expect(allText).toContain('nyc');

    // Should NOT include desires/intents
    expect(allText).not.toContain('looking for');
    expect(allText).not.toContain('want to find');
  }, 30_000);
});
