import type { ConversationMessage } from '@/services/conversation';

/** User-facing role vocabulary — internal agent/patient labels never surface. */
export const ROLE_LABELS: Record<string, string> = {
  agent: 'Helper',
  patient: 'Seeker',
  peer: 'Peer',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export interface ActionVerb {
  label: string;
  color: string;
}

/** Colored action verbs for the turn rail (proposals §2.3 palette). */
export const ACTION_VERBS: Record<string, ActionVerb> = {
  propose: { label: 'PROPOSED', color: 'text-blue-600' },
  counter: { label: 'COUNTERED', color: 'text-amber-600' },
  question: { label: 'QUESTIONED', color: 'text-[#35799C]' },
  ask_user: { label: 'ASKED YOU', color: 'text-[#35799C]' },
  outreach: { label: 'OPENED', color: 'text-[#35799C]' },
  accept: { label: 'ACCEPTED', color: 'text-emerald-600' },
  reject: { label: 'DECLINED', color: 'text-red-600' },
  decline: { label: 'DECLINED', color: 'text-red-600' },
  withdraw: { label: 'WITHDRAWN', color: 'text-red-600' },
};

export function verbFor(action: string | null): ActionVerb | null {
  if (!action) return null;
  return ACTION_VERBS[action] ?? { label: action.replace(/_/g, ' ').toUpperCase(), color: 'text-gray-500' };
}

export interface SuggestedRoles {
  ownUser?: string;
  otherUser?: string;
}

export interface TranscriptTurn {
  id: string;
  sessionId: string | null;
  senderId: string;
  createdAt: string;
  action: string | null;
  text: string;
  suggestedRoles: SuggestedRoles | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extract one renderable turn from an A2A message. Reasoning is shown verbatim
 * (transparency is the trust mechanism); messages without visible text are dropped.
 */
export function extractTurn(message: ConversationMessage): TranscriptTurn | null {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  let data: Record<string, unknown> | null = null;
  let textPart: string | null = null;
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (part.kind === 'data' && isRecord(part.data)) data = part.data;
    if (typeof part.text === 'string' && part.text.trim()) textPart = part.text;
  }
  const assessment = data && isRecord(data.assessment) ? data.assessment : null;
  const messageText = typeof data?.message === 'string' ? data.message : null;
  const reasoningText = typeof assessment?.reasoning === 'string' ? assessment.reasoning : null;
  const text = messageText ?? reasoningText ?? textPart ?? '';
  if (!text.trim()) return null;

  const suggestedRolesRaw = assessment?.suggestedRoles;
  const suggestedRoles = isRecord(suggestedRolesRaw)
    ? {
        ownUser: typeof suggestedRolesRaw.ownUser === 'string' ? suggestedRolesRaw.ownUser : undefined,
        otherUser: typeof suggestedRolesRaw.otherUser === 'string' ? suggestedRolesRaw.otherUser : undefined,
      }
    : null;

  return {
    id: message.id,
    sessionId: message.sessionId ?? null,
    senderId: message.senderId,
    createdAt: message.createdAt,
    action: typeof data?.action === 'string' ? data.action : null,
    text,
    suggestedRoles,
  };
}

/**
 * Role-suggestion chip label, viewer-first: "you → Helper · Dan → Seeker".
 * suggestedRoles is recorded from the sending agent's perspective, so the
 * mapping flips when the counterpart's agent authored the turn.
 */
export function roleChipLabel(
  suggestedRoles: SuggestedRoles | null,
  senderIsOwn: boolean,
  counterpartName: string,
): string | null {
  if (!suggestedRoles) return null;
  const viewerRole = senderIsOwn ? suggestedRoles.ownUser : suggestedRoles.otherUser;
  const counterpartRole = senderIsOwn ? suggestedRoles.otherUser : suggestedRoles.ownUser;
  const segments: string[] = [];
  if (viewerRole) segments.push(`you → ${roleLabel(viewerRole)}`);
  if (counterpartRole) segments.push(`${counterpartName} → ${roleLabel(counterpartRole)}`);
  return segments.length > 0 ? segments.join(' · ') : null;
}

/** Viewer's negotiated role from the latest turn that suggested roles. */
export function viewerRoleLabel(turns: TranscriptTurn[], ownAgentId: string | null): string | null {
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (!turn.suggestedRoles) continue;
    const role = turn.senderId === ownAgentId ? turn.suggestedRoles.ownUser : turn.suggestedRoles.otherUser;
    if (role) return roleLabel(role);
  }
  return null;
}

/** Relative timestamp, recomputed against a ticking `now` (IND-555). */
export function formatRelativeTime(createdAt: string, now: number): string {
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
