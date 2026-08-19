/**
 * Synthetic principals — seed-persona accounts with nobody behind them.
 *
 * The seed CLIs (`src/cli/db-seed.ts`, `db-seed-sandbox.ts`, `test-data.ts`,
 * `sandbox-personas.ts`) create every persona on a `.test` email domain, which
 * RFC 2606 reserves for exactly this: `.test` is permanently unresolvable in
 * the public DNS, so no address under it can ever belong to a deliverable
 * mailbox and no real user can hold one. That makes the TLD a safe durable
 * marker by construction — no `users.is_synthetic` column, and no feature flag.
 *
 * The operational fact this establishes is *unreachability*: a principal whose
 * agent asks them something will never receive an answer. Consumers therefore
 * speak of an "unreachable principal" rather than a synthetic one — the same
 * truth, stated in terms that would still hold if the reason changed (a
 * suspended or deleted account, say), and stated without leaking test framing
 * into anything a counterparty's user might read.
 *
 * This is the single definition. Every consumer goes through it.
 */
import { log } from '../log';

const logger = log.lib.from('users/synthetic');

/**
 * Whether this address belongs to a seed persona: true iff the domain's final
 * label is exactly `test`, case-insensitively, with an optional FQDN trailing
 * dot tolerated.
 *
 * The final label is the whole test. `test@test.example.com` is a real address
 * at a real domain whose `test` label is not final, and must stay reachable.
 */
export function isSyntheticUserEmail(email: string | null | undefined): boolean {
  if (typeof email !== 'string') return false;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  const domain = email.slice(at + 1).trim().toLowerCase().replace(/\.$/, '');
  if (domain.length === 0) return false;
  return domain.split('.').at(-1) === 'test';
}

/** The narrow read {@link resolvePrincipalUnreachable} needs. */
export interface SyntheticPrincipalReader {
  getUser(userId: string): Promise<{ email: string | null } | null>;
}

/**
 * Whether this principal can be consulted at all during a negotiation.
 *
 * Fails OPEN — an unresolvable user, a missing email, or a failed read all
 * report *reachable*. Real users are the default, and the cost of the two
 * errors is not symmetric: wrongly calling a real principal unreachable would
 * silently stop their own agent from ever asking them anything, while wrongly
 * calling a seed persona reachable only restores today's behaviour.
 */
export async function resolvePrincipalUnreachable(
  userId: string,
  reader?: SyntheticPrincipalReader,
): Promise<boolean> {
  try {
    const resolved = reader
      ?? (await import('../../adapters/database.adapter')).conversationDatabaseAdapter;
    const user = await resolved.getUser(userId);
    return isSyntheticUserEmail(user?.email);
  } catch (err) {
    logger.warn('Principal reachability read failed; treating principal as reachable', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
