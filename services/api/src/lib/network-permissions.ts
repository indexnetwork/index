import { eq } from 'drizzle-orm/sql';

import db from './drizzle/drizzle';
import * as schema from '../schemas/database.schema';

/**
 * Headless provisioning paths (CSV import, email invite, master-key signup)
 * create members who never pass a consenting UI. Force consent-safe network
 * permissions — `profileEnrichment: 'consent_required'` and
 * `allowGuestVibeCheck: false` — while spread-merging so `joinPolicy`,
 * `invitationLink`, and any other keys survive.
 *
 * This is not a lock: owners can still change permissions afterwards via the
 * normal update path.
 *
 * @throws Error('Network not found') when the network row is missing.
 */
export async function forceHeadlessProvisioningPermissions(networkId: string): Promise<void> {
  const [existing] = await db
    .select({ permissions: schema.networks.permissions })
    .from(schema.networks)
    .where(eq(schema.networks.id, networkId))
    .limit(1);
  if (!existing) throw new Error('Network not found');

  const permissions: schema.NetworkPermissionsState = {
    ...(existing.permissions as schema.NetworkPermissionsState),
    allowGuestVibeCheck: false,
    profileEnrichment: 'consent_required',
  };
  await db
    .update(schema.networks)
    .set({ permissions })
    .where(eq(schema.networks.id, networkId));
}
