import { and, eq, isNull, or, sql } from 'drizzle-orm/sql';

import type { DrizzleDB } from '../drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { HERMES_AGENT_AUDIENCE } from './hermes-authorization';
import { HERMES_CANONICAL_ACTIONS } from './hermes-capabilities';
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

  if (principal.audience === HERMES_AGENT_AUDIENCE) {
    if (
      !principal.installationId
      || !principal.setupAttemptId
      || !principal.actions
      || principal.actions.length !== HERMES_CANONICAL_ACTIONS.length
      || !HERMES_CANONICAL_ACTIONS.every((action, index) => principal.actions?.[index] === action)
      || !principal.actions.includes('manage:negotiations')
    ) return false;

    const [credential] = await tx.select({
      id: schema.hermesAgentCredentials.id,
      ownerId: schema.hermesAgentCredentials.ownerId,
      agentId: schema.hermesAgentCredentials.agentId,
      audience: schema.hermesAgentCredentials.audience,
      installationId: schema.hermesAgentCredentials.installationId,
      setupAttemptId: schema.hermesAgentCredentials.setupAttemptId,
      actions: schema.hermesAgentCredentials.actions,
      activationState: schema.hermesAgentCredentials.activationState,
      expiresAt: schema.hermesAgentCredentials.expiresAt,
    }).from(schema.hermesAgentCredentials).where(and(
      eq(schema.hermesAgentCredentials.id, principal.credentialId),
      eq(schema.hermesAgentCredentials.ownerId, ownerId),
      eq(schema.hermesAgentCredentials.activationState, 'active'),
      sql`${schema.hermesAgentCredentials.expiresAt} > now()`,
    )).limit(1).for('update');

    return Boolean(
      credential
      && credential.ownerId === ownerId
      && credential.agentId === agent.id
      && credential.audience === HERMES_AGENT_AUDIENCE
      && credential.installationId === principal.installationId
      && credential.installationId === agent.installationId
      && credential.setupAttemptId === principal.setupAttemptId
      && credential.setupAttemptId === agent.runtimeSetupAttemptId
      && credential.actions.length === HERMES_CANONICAL_ACTIONS.length
      && HERMES_CANONICAL_ACTIONS.every((action, index) => credential.actions[index] === action)
      && credential.actions.includes('manage:negotiations')
      && credential.activationState === 'active'
      && credential.expiresAt.getTime() > Date.now()
    );
  }

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
