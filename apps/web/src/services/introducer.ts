import type { useAuthenticatedAPI } from '../lib/api';

export interface IntroducerStatus {
  google: { linked: boolean; contactsScope: boolean; gmailScope: boolean };
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
  /** avatar: the face Google shows you for them, else the one Introduce found on the web. */
  /** ghostUserId: the identity-only ghost research found for them; their page is /u/<ghostUserId>. */
  contact: { id: string; name: string; line: string; detail: string | null; avatar: string | null; ghostUserId: string | null };
  draft: string;
}

/** Someone you can pick on Introduce: a member of your networks (id = user id) or one of your contacts (id = contact id). */
export interface PickablePerson {
  kind: 'member' | 'contact';
  id: string;
  name: string;
  avatar: string | null;
  /** A member's public intent, or what's known about a contact. */
  line: string | null;
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
  /** What Introduce found on the public web for them, once it has looked them up. */
  web: { name: string; headline: string | null } | null;
  /** Their photo when one is known: the member's own, or the one found on the web. */
  avatar: string | null;
}

/** A member of your networks you said never to suggest. */
export interface ExcludedMember {
  userId: string;
  name: string;
  avatar: string | null;
}

export type ContactFilter = 'all' | 'not_on_index' | 'on_index' | 'researched' | 'excluded';

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
/** `private`: it ended, and one of the two keeps how it went from introducers. */
export type IntroductionPhase = 'talking' | 'agreed' | 'met' | 'no_fit' | 'quiet' | 'private';

export interface IntroductionProgress {
  opportunityId: string;
  createdAt: string;
  updatedAt: string;
  context: string;
  a: IntroductionPerson;
  b: IntroductionPerson;
  phase: IntroductionPhase;
  /** Notes either side sent back. Never says which side. */
  reports: { note: string; at: string }[];
}

/** Google scopes the Intro Desk asks for: saved contacts and people you've emailed. */
export const CONTACT_SCOPES = [
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/contacts.other.readonly',
];

const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.metadata';

/** Scopes to request when connecting: Gmail (sent-mail frequency only) is added when its flag is on. */
export const requestedScopes = (): string[] =>
  process.env.NEXT_PUBLIC_INTRODUCER_GMAIL === '1' ? [...CONTACT_SCOPES, GMAIL_SCOPE] : CONTACT_SCOPES;

export const createIntroducerService = (api: ReturnType<typeof useAuthenticatedAPI>) => ({
  status: () => api.get<IntroducerStatus>('/introducer/status'),
  importContacts: () => api.post<{ total: number; onIndex: number }>('/introducer/contacts/import'),
  proposals: () => api.get<{ proposals: OpportunityProposal[] }>('/introducer/proposals').then((r) => r.proposals),
  introductions: () => api.get<{ introductions: IntroductionProgress[] }>('/introducer/introductions').then((r) => r.introductions),
  skip: (id: string) => api.post<{ ok: true }>(`/introducer/proposals/${id}/skip`),
  /** New pairs from contacts research already found; judging runs in the background. */
  regenerate: () => api.post<{ contacts: number; pairs: number }>('/introducer/regenerate'),
  /** Whether a regenerate run is still judging. */
  regenerating: () => api.get<{ running: boolean }>('/introducer/regenerate').then((r) => r.running),
  /** Who you can pick on Introduce: members of your networks and your contacts, by name. */
  people: (q: string) => api.get<{ people: PickablePerson[] }>(`/introducer/people?${new URLSearchParams({ q })}`).then((r) => r.people),
  /** New pairs for one person you picked; checked in the background, and `regenerating` says when it's done. */
  generate: (person: Pick<PickablePerson, 'kind' | 'id'>) => api.post<{ pairs: number }>('/introducer/generate', { kind: person.kind, id: person.id }),
  /** Open a proposal: your contact is seated through you and both agents wake, in the background. */
  open: (id: string, context: string) => api.post<{ ok: true }>(`/introducer/proposals/${id}/open`, { context }),
  contacts: (q: string, filter: ContactFilter, offset: number) =>
    api.get<{ contacts: ContactEntry[]; total: number }>(`/introducer/contacts?${new URLSearchParams({ q, filter, offset: String(offset) })}`),
  setExcluded: (id: string, excluded: boolean) => api.post<{ ok: true }>(`/introducer/contacts/${id}/exclude`, { excluded }),
  /** Members you said never to suggest. */
  excludedMembers: () => api.get<{ members: ExcludedMember[] }>('/introducer/members/excluded').then((r) => r.members),
  /** Never pair this member with your contacts, or allow them again. */
  setMemberExcluded: (userId: string, excluded: boolean) => api.post<{ ok: true }>(`/introducer/members/${encodeURIComponent(userId)}/exclude`, { excluded }),
  /** Remove one contact for good: hidden, never suggested, and not brought back by the daily sync. */
  removeContact: (id: string) => api.delete<{ ok: true }>(`/introducer/contacts/${id}`),
  deleteContacts: () => api.delete<{ deleted: number }>('/introducer/contacts'),
});
