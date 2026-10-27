/**
 * MoralMod integration configuration. Everything is off until
 * MORALMOD_ASSESSMENT_URL is set: without it the hosted agent runs untouched.
 */

export interface MoralmodConfig {
  /** Base URL of the assessment service (moralmod-consult-0). */
  assessmentUrl: string | null;
  assessmentToken: string;
  /** The one network whose members get the consult. */
  networkKey: string;
  /** Village Data research relay; exposure events POST here when set. */
  relayUrl: string | null;
  relayToken: string;
  maxConcurrentConsults: number;
  consultDeadlineMs: number;
  templateId: string;
}

export function moralmodConfig(env: Record<string, string | undefined> = process.env): MoralmodConfig {
  return {
    assessmentUrl: env.MORALMOD_ASSESSMENT_URL || null,
    assessmentToken: env.MORALMOD_ASSESSMENT_TOKEN || '',
    networkKey: env.MORALMOD_NETWORK_KEY || 'edgecity-goa',
    relayUrl: env.MORALMOD_RELAY_URL || null,
    relayToken: env.MORALMOD_RELAY_TOKEN || '',
    // Clamped: a mistyped value must degrade, never crash the hosted agents.
    maxConcurrentConsults: Math.max(1, Math.floor(Number(env.MORALMOD_MAX_CONCURRENT_CONSULTS) || 8)),
    consultDeadlineMs: Math.max(1_000, Math.floor(Number(env.MORALMOD_CONSULT_DEADLINE_MS) || 150_000)),
    templateId: env.MORALMOD_TEMPLATE_ID || 'aggregate-value-mean-hold-v1',
  };
}
