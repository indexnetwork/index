import type { useAuthenticatedAPI } from '../lib/api';

export interface IntroducerStatus {
  google: { linked: boolean; contactsScope: boolean };
  contacts: { total: number; onIndex: number; lastImportAt: string | null };
}

/**
 * An opportunity nobody has opened yet, in the opportunity format, plus what
 * the card shows: a member's need ⇄ one of your contacts who is not on Index.
 */
export interface OpportunityProposal {
  id: string;
  status: 'proposed' | 'skipped' | 'opening' | 'opened' | 'failed';
  /** Why opening failed, in plain words. */
  failure: string | null;
  detection: Record<string, unknown>;
  actors: Record<string, unknown>[];
  interpretation: Record<string, unknown>;
  context: Record<string, unknown>;
  confidence: number;
  opportunityId: string | null;
  networkTitle: string;
  member: { userId: string; name: string; avatar: string | null; line: string; intentText: string };
  contact: { id: string; name: string; line: string; detail: string | null };
  draft: string;
}

/** One of your imported contacts. Only you ever see these. */
export interface ContactEntry {
  id: string;
  name: string;
  email: string;
  detail: string | null;
  source: 'saved' | 'emailed';
  onIndex: boolean;
  excluded: boolean;
  proposals: number;
}

export type ContactFilter = 'all' | 'not_on_index' | 'on_index' | 'excluded';

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
  proposals: () => api.get<{ proposals: OpportunityProposal[] }>('/introducer/proposals').then((r) => r.proposals),
  introductions: () => api.get<{ introductions: IntroductionProgress[] }>('/introducer/introductions').then((r) => r.introductions),
  skip: (id: string) => api.post<{ ok: true }>(`/introducer/proposals/${id}/skip`),
  /** Open a proposal: your contact is seated through you and both agents wake, in the background. */
  open: (id: string, context: string) => api.post<{ ok: true }>(`/introducer/proposals/${id}/open`, { context }),
  contacts: (q: string, filter: ContactFilter, offset: number) =>
    api.get<{ contacts: ContactEntry[]; total: number }>(`/introducer/contacts?${new URLSearchParams({ q, filter, offset: String(offset) })}`),
  setExcluded: (id: string, excluded: boolean) => api.post<{ ok: true }>(`/introducer/contacts/${id}/exclude`, { excluded }),
  /** Remove one contact for good: hidden, never suggested, and not brought back by the daily sync. */
  removeContact: (id: string) => api.delete<{ ok: true }>(`/introducer/contacts/${id}`),
  deleteContacts: () => api.delete<{ deleted: number }>('/introducer/contacts'),
});
