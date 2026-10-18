import type { AgentVerdict, HumanOutcome, OutcomeClass, Seat, SourceKind, TraceInput } from './schema.ts';

export interface Source {
  id: string;
  kind: SourceKind;
  seat: Seat;
  turnIndex?: number;
  text: string;
}

const SEATS: Seat[] = ['A', 'B'];

export function buildSources(trace: TraceInput): Source[] {
  const sources: Source[] = [];
  for (const seat of SEATS) {
    const principal = trace.principals[seat];
    sources.push({ id: `intent:${seat}`, kind: 'intent', seat, text: principal.intent });
    if (principal.intro) sources.push({ id: `profile:${seat}`, kind: 'profile', seat, text: principal.intro });
    for (const item of principal.conversation) sources.push({ id: item.id, kind: 'conversation', seat, text: item.text });
    for (const note of principal.agentNotes) sources.push({ id: note.id, kind: 'agent_note', seat, text: note.text });
  }
  for (const turn of trace.turns) {
    sources.push({ id: `turn:${turn.index}`, kind: 'turn', seat: turn.seat, turnIndex: turn.index, text: turn.message });
  }
  return sources;
}

export function normalizeForMatch(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function quoteInText(quote: string, text: string): boolean {
  const needle = normalizeForMatch(quote);
  if (needle.length < 4) return false;
  return normalizeForMatch(text).includes(needle);
}

export function scrubNames(text: string, names: { A: string[]; B: string[] }): string {
  let out = text;
  for (const seat of SEATS) {
    const tokens = new Set<string>();
    for (const name of names[seat]) {
      const trimmed = name.trim();
      if (trimmed.length >= 3) tokens.add(trimmed);
      for (const part of trimmed.split(/\s+/)) if (part.length >= 3) tokens.add(part);
    }
    const ordered = [...tokens].sort((a, b) => b.length - a.length);
    for (const token of ordered) {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu'), `[${seat}]`);
    }
  }
  return out;
}

export interface OutcomeFacts {
  agentVerdict: AgentVerdict;
  opportunityStatus: string;
  committedCount: number;
}

export function deriveHumanOutcome(facts: OutcomeFacts): HumanOutcome {
  const { agentVerdict, opportunityStatus, committedCount } = facts;
  if (agentVerdict === 'open') return 'not_reached';
  if (agentVerdict === 'declined' || agentVerdict === 'closed') return 'not_reached';
  if (committedCount >= 2) return 'both_committed';
  if (opportunityStatus === 'rejected') return 'declined';
  if (committedCount === 1) return 'one_committed';
  if (opportunityStatus === 'expired') return 'expired';
  return 'open';
}

export function deriveOutcomeClass(agentVerdict: AgentVerdict, humanOutcome: HumanOutcome, missedOpportunityEvidence: boolean): OutcomeClass {
  if (agentVerdict === 'agreed') {
    if (humanOutcome === 'both_committed') return 'confirmed_fit';
    if (humanOutcome === 'declined' || humanOutcome === 'expired') return 'assessment_failure';
    return 'unresolved';
  }
  if ((agentVerdict === 'declined' || agentVerdict === 'closed') && missedOpportunityEvidence) return 'missed_opportunity';
  return 'unresolved';
}

export function validateAgentVerdict(raw: string | null): AgentVerdict {
  if (raw === 'agreed' || raw === 'declined' || raw === 'closed') return raw;
  return 'open';
}
