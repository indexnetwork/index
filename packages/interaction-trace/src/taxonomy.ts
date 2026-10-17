import type { FindingKind } from './schema.ts';

export interface TaxonomyRef {
  owasp: string;
  atlas: string | null;
  approximate: boolean;
  note: string;
}

// OWASP Top 10 for LLM Applications 2025 ids and MITRE ATLAS technique ids were checked
// against genai.owasp.org and the ATLAS distribution (ATLAS.yaml) when this was written.
// "approximate" marks mappings where the standard names the closest class rather than the exact behavior.
export const TAXONOMY: Record<FindingKind, TaxonomyRef> = {
  instruction_injection: {
    owasp: 'LLM01:2025 Prompt Injection',
    atlas: 'AML.T0051.001',
    approximate: false,
    note: 'Counterparty text arrives through a data channel and tries to set the agent instructions (indirect prompt injection).',
  },
  out_of_scope_extraction: {
    owasp: 'LLM02:2025 Sensitive Information Disclosure',
    atlas: 'AML.T0057',
    approximate: false,
    note: 'The counterparty asks for information the principal never authorised sharing.',
  },
  authority_bait: {
    owasp: 'LLM06:2025 Excessive Agency',
    atlas: 'AML.T0053',
    approximate: true,
    note: 'Pushes the agent to commit or act beyond its delegated scope; ATLAS has no exact technique for delegation overreach.',
  },
  pressure: {
    owasp: 'LLM01:2025 Prompt Injection',
    atlas: 'AML.T0051.001',
    approximate: true,
    note: 'Urgency or social pressure toward out-of-mandate terms; neither standard names negotiation pressure directly.',
  },
  selective_misrepresentation: {
    owasp: 'LLM09:2025 Misinformation',
    atlas: null,
    approximate: true,
    note: 'The agent represents its principal inaccurately by omission or distortion; ATLAS has no matching technique.',
  },
};

export function taxonomyFor(kind: FindingKind): TaxonomyRef {
  return TAXONOMY[kind];
}
