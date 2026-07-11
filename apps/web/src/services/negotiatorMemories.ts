/**
 * Types for the negotiator memory inspection API (P5.4 / IND-408).
 *
 * GET    /users/:userId/negotiator/memories?kind=
 * PATCH  /users/:userId/negotiator/memories/:memoryId
 * DELETE /users/:userId/negotiator/memories/:memoryId
 *
 * Strict self-only: the API returns 403 for any non-self caller.
 */

export type NegotiatorMemoryKind =
  | 'disclosure_rule'
  | 'playbook'
  | 'threshold'
  | 'counterparty_dossier';

export interface NegotiatorMemorySourceRef {
  type: 'negotiation' | 'question_answer' | 'chat' | 'manual';
  id: string;
  turnIndexes?: number[];
}

export interface NegotiatorMemory {
  id: string;
  kind: NegotiatorMemoryKind;
  content: string;
  /** 0..1 — how established the memory is (decays when stale). */
  confidence: number;
  /** For counterparty notes: who the note is about. */
  subjectUser: { id: string; name: string; avatar: string | null } | null;
  sourceRefs: NegotiatorMemorySourceRef[];
  createdAt: string;
  updatedAt: string;
}

export interface NegotiatorMemoriesResponse {
  memories: NegotiatorMemory[];
}

export interface UpdateNegotiatorMemoryBody {
  content?: string;
  confidence?: number;
}

export const negotiatorMemoriesPath = (userId: string) =>
  `/users/${userId}/negotiator/memories`;

export const negotiatorMemoryPath = (userId: string, memoryId: string) =>
  `/users/${userId}/negotiator/memories/${memoryId}`;
