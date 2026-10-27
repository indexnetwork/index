/**
 * MoralMod integration configuration. Everything is off until the relevant
 * env is set: no assessment URL means no hook, no cp token means no
 * integration endpoints.
 */

export interface MoralmodConfig {
  /** Base URL of the assessment service (the lab's decision service hosted by us). */
  assessmentUrl: string | null;
  assessmentToken: string;
  /** Bearer the lab control plane presents on /integrations/moralmod/*. */
  cpToken: string | null;
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
    cpToken: env.MORALMOD_CP_TOKEN || null,
    relayUrl: env.MORALMOD_RELAY_URL || null,
    relayToken: env.MORALMOD_RELAY_TOKEN || '',
    // Clamped: a mistyped value must degrade, never crash the hosted agents.
    maxConcurrentConsults: Math.max(1, Math.floor(Number(env.MORALMOD_MAX_CONCURRENT_CONSULTS) || 8)),
    consultDeadlineMs: Math.max(1_000, Math.floor(Number(env.MORALMOD_CONSULT_DEADLINE_MS) || 150_000)),
    templateId: env.MORALMOD_TEMPLATE_ID || 'aggregate-value-mean-hold-v1',
  };
}
