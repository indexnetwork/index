import { and, eq, isNull, or, sql } from 'drizzle-orm/sql';

import type { DrizzleDB } from '../drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { HERMES_NEGOTIATOR_AUDIENCE, HERMES_NEGOTIATOR_CREDENTIAL_KIND, type NegotiationCredentialPrincipal } from './hermes-credential';

function metadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * Final mutation-time authority fence. The owner runtime advisory lock is held
 * from selection/generation revalidation through the caller's task mutation.
 */
export async function authorizeNegotiationMutationInTransaction(
  tx: DrizzleDB,
  ownerId: string,
  principal: NegotiationCredentialPrincipal,
): Promise<boolean> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${`agent-runtime:${ownerId}`}, 0)
    )
  `);

  const [agent] = await tx.select().from(schema.agents).where(and(
    eq(schema.agents.id, principal.agentId),
    eq(schema.agents.ownerId, ownerId),
    eq(schema.agents.type, 'external'),
    eq(schema.agents.status, 'active'),
    eq(schema.agents.handleNegotiations, true),
    isNull(schema.agents.deletedAt),
  )).limit(1).for('update');
  if (!agent) return false;

  const [permission] = await tx.select({ id: schema.agentPermissions.id })
    .from(schema.agentPermissions)
    .where(and(
      eq(schema.agentPermissions.agentId, agent.id),
      eq(schema.agentPermissions.userId, ownerId),
      eq(schema.agentPermissions.scope, 'global'),
      sql`'manage:negotiations' = ANY(${schema.agentPermissions.actions})`,
    )).limit(1);
  if (!permission) return false;

  const [credential] = await tx.select({
    id: schema.apikeys.id,
    expiresAt: schema.apikeys.expiresAt,
    metadata: schema.apikeys.metadata,
  }).from(schema.apikeys).where(and(
    eq(schema.apikeys.id, principal.credentialId),
    eq(schema.apikeys.enabled, true),
    or(isNull(schema.apikeys.expiresAt), sql`${schema.apikeys.expiresAt} > now()`),
  )).limit(1).for('update');
  const credentialMetadata = metadata(credential?.metadata ?? null);
  if (!credential || credentialMetadata?.agentId !== agent.id) return false;

  const explicitlyHermes = credentialMetadata.audience === HERMES_NEGOTIATOR_AUDIENCE;
  if (agent.runtimeKind === 'hermes' || explicitlyHermes) {
    return principal.audience === HERMES_NEGOTIATOR_AUDIENCE
      && credentialMetadata.audience === HERMES_NEGOTIATOR_AUDIENCE
      && credentialMetadata.kind === HERMES_NEGOTIATOR_CREDENTIAL_KIND
      && typeof principal.setupAttemptId === 'string'
      && principal.setupAttemptId === agent.runtimeSetupAttemptId
      && principal.setupAttemptId === credentialMetadata.setupAttemptId
      && credential.expiresAt !== null
      && credentialMetadata.expiresAt === credential.expiresAt.toISOString();
  }

  // Backward compatibility for existing agent-bound keys is deliberate, but
  // an explicitly Hermes-audience row can never fall through this legacy path.
  return principal.audience === null;
}
