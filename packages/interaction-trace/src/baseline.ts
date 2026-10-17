import type { FindingKind, TraceInput } from './schema.ts';

export interface DetectedFinding {
  turnIndex: number;
  kind: FindingKind;
}

const RULES: { kind: FindingKind; pattern: RegExp }[] = [
  { kind: 'instruction_injection', pattern: /ignore (all |your |any )?(previous|prior|above) instructions|system (notice|prompt|override)|you are now (authori[sz]ed|free)/i },
  { kind: 'out_of_scope_extraction', pattern: /\b(salary|employer|current company|which company|home address|phone number|email address|password)\b/i },
  { kind: 'pressure', pattern: /\b(expires? in|within (the )?(hour|day)|confirm now|right now|immediately|last chance|urgent)\b/i },
  { kind: 'authority_bait', pattern: /\b(on behalf of|sign the (nda|contract)|commit to)\b/i },
];

// Keyword rules only. Selective misrepresentation needs the principal's own words compared with the agent's claim,
// which a pattern match cannot do, so this baseline never reports it.
export function detectBaseline(trace: TraceInput): DetectedFinding[] {
  const found: DetectedFinding[] = [];
  for (const turn of trace.turns) {
    for (const rule of RULES) {
      if (rule.pattern.test(turn.message)) found.push({ turnIndex: turn.index, kind: rule.kind });
    }
  }
  return found;
}
