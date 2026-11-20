import type { useAuthenticatedAPI } from '../lib/api';

export interface IntroducerStatus {
  google: { linked: boolean; contactsScope: boolean };
  contacts: { total: number; onIndex: number; lastImportAt: string | null };
}

export interface PairSide {
  userId: string;
  name: string;
  avatar: string | null;
  intentId: string;
  intentText: string;
  isContact: boolean;
  /** One short line completing "<first name> …": what they need or bring. */
  line: string;
}

export interface PairSuggestion {
  key: string;
  networkId: string;
  networkTitle: string;
  score: number;
  a: PairSide;
  b: PairSide;
  draft: string;
}

export interface IntroductionPerson {
  userId: string;
  name: string;
  avatar: string | null;
  intentText: string;
}

/**
 * Where an introduction ended up, never how: the turns stay between the two
 * seats, and a no fit never says which side or who said it.
 */
export type IntroductionPhase = 'talking' | 'agreed' | 'met' | 'no_fit' | 'quiet';

export interface IntroductionProgress {
  opportunityId: string;
  createdAt: string;
  context: string;
  a: IntroductionPerson;
  b: IntroductionPerson;
  phase: IntroductionPhase;
}

/** Google scopes the Intro Desk asks for: saved contacts and people you've emailed. */
export const CONTACT_SCOPES = [
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/contacts.other.readonly',
];

export const createIntroducerService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  status: () => api.get<IntroducerStatus>('/introducer/status'),
  importContacts: () => api.post<{ total: number; onIndex: number }>('/introducer/contacts/import'),
  pairs: () => api.get<{ pairs: PairSuggestion[] }>('/introducer/pairs').then((r) => r.pairs),
  introductions: () => api.get<{ introductions: IntroductionProgress[] }>('/introducer/introductions').then((r) => r.introductions),
  /** Wake both agents: opens the opportunity through the existing introducer path. */
  wake: (pair: PairSuggestion, context: string) =>
    api.post<{ opportunityId: string }>('/opportunities', {
      networkId: pair.networkId,
      intents: [pair.a.intentId, pair.b.intentId],
      context,
    }),
});
