import { log } from './log';

const logger = log.lib.from('loops');

const LOOPS_API_URL = 'https://app.loops.so/api/v1';

/** The sync is enabled only where LOOPS_API_KEY is set (e.g. production). */
function loopsApiKey(): string | undefined {
  return process.env.LOOPS_API_KEY?.trim() || undefined;
}

export interface LoopsMember {
  email: string;
  name?: string | null;
  createdAt?: Date | null;
}

/**
 * Marks a contact in the Loops audience as an Index member (`indexMember`,
 * `indexMemberSince`), creating the contact when it doesn't exist yet.
 *
 * No-op without LOOPS_API_KEY, and never throws — a Loops outage must not
 * break sign-up. Returns whether the update was accepted.
 */
export async function syncMemberToLoops(member: LoopsMember): Promise<boolean> {
  const key = loopsApiKey();
  if (!key) return false;

  const [firstName, ...rest] = (member.name ?? '').trim().split(/\s+/).filter(Boolean);

  try {
    const res = await fetch(`${LOOPS_API_URL}/contacts/update`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        email: member.email,
        ...(firstName ? { firstName } : {}),
        ...(rest.length ? { lastName: rest.join(' ') } : {}),
        indexMember: true,
        ...(member.createdAt ? { indexMemberSince: member.createdAt.toISOString() } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 300);
      logger.error('Loops contact update failed', { status: res.status, body });
      return false;
    }
    return true;
  } catch (error) {
    logger.error('Loops contact update failed', { error: String(error) });
    return false;
  }
}

/**
 * Creates the custom contact properties the member sync writes. Loops ignores
 * unknown properties on contact updates, so these must exist first. Safe to
 * call repeatedly — an existing property comes back as a 409 conflict.
 */
export async function ensureLoopsMemberProperties(): Promise<void> {
  const key = loopsApiKey();
  if (!key) return;

  const properties = [
    { name: 'indexMember', type: 'boolean' },
    { name: 'indexMemberSince', type: 'date' },
  ];

  for (const property of properties) {
    const res = await fetch(`${LOOPS_API_URL}/contacts/properties`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(property),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok && res.status !== 409) {
      const body = (await res.text().catch(() => '')).slice(0, 300);
      logger.error('Loops property creation failed', { property: property.name, status: res.status, body });
    }
  }
}
