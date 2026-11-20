import type { useAuthenticatedAPI } from '../lib/api';

export interface IntroducerStatus {
  google: { linked: boolean; contactsScope: boolean };
  contacts: { total: number; onIndex: number; lastImportAt: string | null };
}

/** A pair on the Intro Desk: a member's need ⇄ one of your contacts who is not on Index. */
export interface PairSuggestion {
  id: string;
  status: 'open' | 'skipped' | 'waking' | 'woken' | 'failed';
  /** Why a wake failed, in plain words. */
  failure: string | null;
  networkTitle: string;
  opportunityId: string | null;
  member: { userId: string; name: string; avatar: string | null; line: string; intentText: string };
  contact: { name: string; line: string; detail: string | null };
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
  skip: (id: string) => api.post<{ ok: true }>(`/introducer/pairs/${id}/skip`),
  /** Wake both agents: the contact is seated through you and both agents start, in the background. */
  wake: (id: string, context: string) => api.post<{ ok: true }>(`/introducer/pairs/${id}/wake`, { context }),
});
