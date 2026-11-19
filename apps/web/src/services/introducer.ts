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

export interface ProgressStep {
  side: 'a' | 'b' | 'both' | 'you';
  kind: 'opened' | 'turn' | 'agreed' | 'committed' | 'declined' | 'expired';
  action?: string;
  turn?: number;
  at: string;
}

export interface IntroductionPerson {
  userId: string;
  name: string;
  avatar: string | null;
  intentText: string;
}

export interface IntroductionProgress {
  opportunityId: string;
  status: string;
  createdAt: string;
  context: string;
  a: IntroductionPerson;
  b: IntroductionPerson;
  awaiting: 'a' | 'b' | null;
  phase: 'negotiating' | 'agreed' | 'accepted' | 'declined' | 'expired';
  steps: ProgressStep[];
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
