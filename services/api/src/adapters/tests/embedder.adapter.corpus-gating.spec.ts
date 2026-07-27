import { afterEach, describe, expect, it } from 'bun:test';
import { planHydeCorpusSearches } from '../embedder.adapter.js';

const saved = { ...process.env };
afterEach(() => {
  process.env.DISCOVERY_ALLOWED_TYPES = saved.DISCOVERY_ALLOWED_TYPES;
  process.env.DISCOVERY_PROFILE_SOURCE = saved.DISCOVERY_PROFILE_SOURCE;
});

describe('planHydeCorpusSearches', () => {
  const lens = { lens: 'l1', corpus: 'profiles' as const, embedding: [0.1] };

  it('defaults: searches intents + premises, profiles hint remaps to premises', () => {
    delete process.env.DISCOVERY_ALLOWED_TYPES;
    delete process.env.DISCOVERY_PROFILE_SOURCE;
    expect(planHydeCorpusSearches(lens)).toEqual({ intents: true, premises: true, userContexts: false, preferred: 'premises' });
  });

  it('lightweight mode: profiles hint remaps to user_contexts, premises off', () => {
    process.env.DISCOVERY_PROFILE_SOURCE = 'user_context';
    expect(planHydeCorpusSearches(lens)).toEqual({ intents: true, premises: false, userContexts: true, preferred: 'user_contexts' });
  });

  it('intent-only: profile corpora off', () => {
    process.env.DISCOVERY_ALLOWED_TYPES = 'intent';
    expect(planHydeCorpusSearches(lens)).toEqual({ intents: true, premises: false, userContexts: false, preferred: 'premises' });
  });

  it('profile-only lightweight: intents off, user_contexts on', () => {
    process.env.DISCOVERY_ALLOWED_TYPES = 'profile';
    process.env.DISCOVERY_PROFILE_SOURCE = 'user_context';
    expect(planHydeCorpusSearches({ ...lens, corpus: 'intents' })).toEqual({ intents: false, premises: false, userContexts: true, preferred: 'user_contexts' });
  });
});
