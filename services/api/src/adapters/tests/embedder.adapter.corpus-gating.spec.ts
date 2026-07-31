import { describe, expect, it } from 'bun:test';
import { planHydeCorpusSearches } from '../embedder.adapter.js';

describe('planHydeCorpusSearches', () => {
  const lens = { lens: 'l1', corpus: 'profiles' as const, embedding: [0.1] };

  it('defaults: searches intents + premises, profiles hint remaps to premises', () => {
    expect(planHydeCorpusSearches(lens)).toEqual({
      intents: true,
      premises: true,
      userContexts: false,
      preferred: 'premises',
    });
  });

  it('lightweight mode: profiles hint remaps to user_contexts, premises off', () => {
    expect(
      planHydeCorpusSearches(lens, { profile: true, profileCorpus: 'user_context' }),
    ).toEqual({
      intents: true,
      premises: false,
      userContexts: true,
      preferred: 'user_contexts',
    });
  });

  it('intent-only: profile corpora off', () => {
    expect(planHydeCorpusSearches(lens, { profile: false })).toEqual({
      intents: true,
      premises: false,
      userContexts: false,
      preferred: 'premises',
    });
  });

  it('profile-only lightweight: intents off, user_contexts on', () => {
    expect(
      planHydeCorpusSearches(
        { ...lens, corpus: 'intents' },
        { intents: false, profile: true, profileCorpus: 'user_context' },
      ),
    ).toEqual({
      intents: false,
      premises: false,
      userContexts: true,
      preferred: 'user_contexts',
    });
  });
});
