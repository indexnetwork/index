import { NEGOTIATION_PAUSE_REASONS, type ConversationMessage, type NegotiationPauseReason } from '@/services/conversation';

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

/**
 * Colored action verbs for the turn rail (proposals §2.3 palette).
 *
 * A negotiator turn is one of `outreach | counter | question` (continues) or
 * `pause` with a reason (`counterparty_silent | needs_principal |
 * ready_for_verdict`) — there is no `accept`/`decline`/`withdraw`/`ask_user`
 * on the turn surface any more; a negotiation only ever ends via a separate
 * verdict write, never a turn. Pauses use amber/gray, not red — none of them
 * are a decision.
 */
export const ACTION_VERBS: Record<string, ActionVerb> = {
  counter: { label: 'COUNTERED', color: 'text-amber-600' },
  question: { label: 'QUESTIONED', color: 'text-[#35799C]' },
  outreach: { label: 'OPENED', color: 'text-[#35799C]' },
  counterparty_silent: { label: 'WAITING', color: 'text-gray-500' },
  needs_principal: { label: 'ASKED YOU', color: 'text-[#35799C]' },
  ready_for_verdict: { label: 'READY FOR REVIEW', color: 'text-amber-600' },
  turn_cap: { label: 'PAUSED', color: 'text-gray-500' },
  open_failed: { label: 'COULD NOT START', color: 'text-gray-500' },
};

export function verbFor(action: string | null): ActionVerb | null {
  if (!action) return null;
  return ACTION_VERBS[action] ?? { label: action.replace(/_/g, ' ').toUpperCase(), color: 'text-gray-500' };
}

export interface SuggestedRoles {
  ownUser?: string;
  otherUser?: string;
}

export type { NegotiationPauseReason };

export interface TranscriptTurn {
  id: string;
  sessionId: string | null;
  senderId: string;
  createdAt: string;
  /** `outreach` | `counter` | `question` | `pause`. */
  verb: string | null;
  /** Set only when `verb === 'pause'`. */
  pauseReason: NegotiationPauseReason | null;
  /** Set only for `needs_principal` (`{question}`) and `ready_for_verdict` (`{recommendation, reasoning}`) pauses. */
  pausePayload: Record<string, unknown> | null;
  /** The chip key to look up in `ACTION_VERBS` — the verb for a continuing turn, the reason for a pause. */
  chipKey: string | null;
  text: string;
  suggestedRoles: SuggestedRoles | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const PAUSE_REASONS = new Set<NegotiationPauseReason>(NEGOTIATION_PAUSE_REASONS);

function isPauseReason(value: unknown): value is NegotiationPauseReason {
  return typeof value === 'string' && PAUSE_REASONS.has(value as NegotiationPauseReason);
}

/** Fallback text for a pause turn, which carries no top-level `message`. */
function pauseText(reason: NegotiationPauseReason, payload: Record<string, unknown> | null): string {
  if (reason === 'needs_principal') {
    const question = typeof payload?.question === 'string' ? payload.question : null;
    return question ?? 'Waiting on the principal for guidance.';
  }
  if (reason === 'ready_for_verdict') {
    const reasoning = typeof payload?.reasoning === 'string' ? payload.reasoning : null;
    const recommendation = typeof payload?.recommendation === 'string' ? payload.recommendation : null;
    if (reasoning) return reasoning;
    return recommendation ? `Recommending ${recommendation}.` : 'Ready for a verdict.';
  }
  if (reason === 'turn_cap') return 'This negotiation reached its limit and is waiting on review.';
  if (reason === 'open_failed') return 'This negotiation could not be started; nothing has been said yet.';
  return 'Waiting on the other side to respond.';
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

  const verb = typeof data?.verb === 'string' ? data.verb : null;
  const isPause = verb === 'pause';
  const pauseReason = isPause && isPauseReason(data?.reason) ? (data!.reason as NegotiationPauseReason) : null;
  const pausePayload = isPause && isRecord(data?.payload) ? (data!.payload as Record<string, unknown>) : null;

  const assessment = data && isRecord(data.assessment) ? data.assessment : null;
  const messageText = typeof data?.message === 'string' ? data.message : null;
  const reasoningText = typeof assessment?.reasoning === 'string' ? assessment.reasoning : null;
  const text = messageText
    ?? reasoningText
    ?? textPart
    ?? (pauseReason ? pauseText(pauseReason, pausePayload) : '');
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
    verb,
    pauseReason,
    pausePayload,
    chipKey: pauseReason ?? verb,
    text,
    suggestedRoles,
  };
}

/**
 * Turns that reflect actual contact with the counterparty. A `needs_principal`
 * pause is the agent's own private pause to ask its principal — it settles
 * nothing about whether the counterparty was ever reached, so it must not
 * count as one. Without this exclusion, a screened_out negotiation whose only
 * turn is its own pre-contact pause reads as contacted, which hides the
 * owner-only gate card behind a generic "declined" banner that names no
 * reasoning at all.
 */
export function contactTurns(turns: readonly TranscriptTurn[]): TranscriptTurn[] {
  return turns.filter((turn) => turn.pauseReason !== 'needs_principal');
}

/** Who authored the turn that ended a negotiation, from the viewer's side. */
export type TerminalTurnAuthor = 'own' | 'counterparty';

/**
 * A negotiation no longer ends via a turn — `resolve` is a separate write
 * (a verdict of `pending` or `reject`), not part of the transcript at all,
 * and a negotiator turn can only ever continue or pause, never decide. There
 * is therefore nothing in the transcript that reliably names who ended a
 * negotiation any more: the closest thing, a `ready_for_verdict` pause
 * recommending `reject`, is exactly that — a recommendation to that side's
 * own principal, not the decision itself, and IS-A (not yet built) is free
 * to act on it, override it, or wait. Always returns null; kept as a named
 * function (rather than deleted at every call site) so a future caller that
 * gains a real verdict-attribution field can wire it in without re-deriving
 * this reasoning. See ResolvedBanner's terminalAuthor prop for why a guess
 * here is worse than no claim at all.
 */
export function terminalTurnAuthor(
  _turns: TranscriptTurn[],
  _ownAgentId: string | null,
): TerminalTurnAuthor | null {
  return null;
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

// ─── Session grouping (IND-565) ───────────────────────────────────────────

export interface NegotiationSessionGroup {
  sessionId: string | null;
  turns: TranscriptTurn[];
}

/**
 * Group turns into per-session (per-task) slices in chronological order.
 * Each slice corresponds to exactly one negotiation task over one opportunity;
 * sectioning them prevents action chips (OPENED/WITHDRAWN/…) from one task
 * bleeding visually into an unrelated adjacent task (IND-565).
 */
export function groupTurnsBySession(turns: TranscriptTurn[]): NegotiationSessionGroup[] {
  const groups: NegotiationSessionGroup[] = [];
  for (const turn of turns) {
    const last = groups[groups.length - 1];
    if (!last || last.sessionId !== turn.sessionId) {
      groups.push({ sessionId: turn.sessionId, turns: [turn] });
    } else {
      last.turns.push(turn);
    }
  }
  return groups;
}

// ─── Section label helpers (IND-570) ────────────────────────────────────────

export type OpportunityOutcomeStatus = 'accepted' | 'rejected' | 'stalled' | 'expired';

export interface OutcomeChipVariant {
  label: string;
  /** Tailwind text-color class */
  color: string;
  /** Tailwind bg-color class */
  bg: string;
}

/** Map opportunity status → compact chip display props, or null if no chip. */
export function outcomeChipVariant(status: string | null | undefined): OutcomeChipVariant | null {
  switch (status) {
    case 'accepted': return { label: 'Accepted', color: 'text-emerald-700', bg: 'bg-emerald-50' };
    case 'rejected': return { label: 'Rejected', color: 'text-red-700', bg: 'bg-red-50' };
    case 'stalled': return { label: 'Stalled', color: 'text-gray-600', bg: 'bg-gray-100' };
    case 'expired': return { label: 'Expired', color: 'text-amber-700', bg: 'bg-amber-50' };
    default: return null;
  }
}

/**
 * Format a date string as "Mon D" (e.g. "Jun 26") for section date hints.
 * Returns empty string on invalid input.
 */
export function formatSectionDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export interface SectionLabelOpts {
  /** true if this is the newest/latest session group */
  isLatest: boolean;
  /** ISO createdAt of the first turn in this group, for date context */
  firstTurnCreatedAt: string | null;
  /** Title of the opportunity this session was about (viewer-side intent title) */
  opportunityTitle: string | null;
  /** Current status of the opportunity, for the outcome chip */
  opportunityStatus: string | null;
  /** Fallback title used for the latest section */
  latestSectionTitle: string | null;
}

/**
 * Derives the text label for a negotiation section divider (IND-570).
 *
 * - Latest section: uses the intent title from the conversation's signal provenance.
 * - Older sections with attribution: "<title> · <status> · <Mon D>"
 * - Older sections without attribution: "Earlier negotiation · <Mon YYYY>" fallback.
 */
export function deriveSectionLabel(opts: SectionLabelOpts): string {
  if (opts.isLatest) {
    return opts.latestSectionTitle ?? 'Current negotiation';
  }

  if (opts.opportunityTitle) {
    const chip = outcomeChipVariant(opts.opportunityStatus);
    const date = opts.firstTurnCreatedAt ? formatSectionDate(opts.firstTurnCreatedAt) : '';
    const parts = [opts.opportunityTitle];
    if (chip) parts.push(chip.label);
    if (date) parts.push(date);
    return parts.join(' · ');
  }

  // Unattributed legacy fallback — keep existing format.
  const date = opts.firstTurnCreatedAt ? new Date(opts.firstTurnCreatedAt) : null;
  const monthYear = date && Number.isFinite(date.getTime())
    ? date.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : '';
  return `Earlier negotiation${monthYear ? ` · ${monthYear}` : ''}`;
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
