import { createHash } from 'node:crypto';

/** Normalize intent text for stable material-change comparisons. */
export function normalizeIntentText(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/g, ' ');
}

/** Build the canonical full payload + summary text used by pool discovery. */
export function buildFullIntentText(payload: string, summary?: string | null): string {
  const normalizedPayload = normalizeIntentText(payload);
  const normalizedSummary = summary ? normalizeIntentText(summary) : '';
  return normalizedSummary ? `${normalizedPayload} (${normalizedSummary})` : normalizedPayload;
}

/**
 * Hash only normalized payload + summary, deliberately excluding lifecycle
 * status and timestamps so pause/resume does not invalidate pool answers.
 */
export function computeIntentFingerprint(payload: string, summary?: string | null): string {
  const normalizedPayload = normalizeIntentText(payload);
  const normalizedSummary = summary ? normalizeIntentText(summary) : '';
  return createHash('sha256')
    .update(JSON.stringify([normalizedPayload, normalizedSummary]))
    .digest('hex');
}

/** Build the bounded display-only snippet stored with pool questions. */
export function buildIntentSnippet(intentText: string): string {
  return normalizeIntentText(intentText).slice(0, 160);
}
