import { and, eq, isNull } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import * as schema from '../schemas/database.schema';
import { agentDatabaseAdapter } from '../adapters/agent.database.adapter';
import { agentTokenAdapter } from '../adapters/agent-token.adapter';
import { ensurePersonalNetwork } from '../adapters/database.adapter';
import { networkInvitationTemplate } from '../lib/email/templates/network-invitation.template';
import { executeSendEmail } from '../lib/email/transport.helper';
import { buildConnectCommand } from '../lib/openclaw/connect-command';

const logger = log.service.from('network-invitation');

export interface InviteParams {
  networkId: string;
  email: string;
  /** Optional name applied only to the new user. Ignored if user already exists. */
  name?: string;
}

export interface InviteResult {
  user: { id: string; email: string };
  /** Raw API key; only present when a scoped agent was provisioned in this call. */
  apiKey: string | null;
  /** True if the user was newly created. */
  created: boolean;
  /** True if the user was already a member of this network. */
  alreadyMember: boolean;
  /** True if the agent + permissions + key were created in this call. */
  agentProvisioned: boolean;
}

export interface ResendInviteParams {
  networkId: string;
  memberId: string;
}

export interface ResendInviteResult {
  rotated: boolean;
  email: string;
}

export interface EnsureMembershipResult {
  user: { id: string; email: string };
  /** Raw API key. Null when rotateKey=false and the user already had a scoped agent. */
  apiKey: string | null;
  created: boolean;
  alreadyMember: boolean;
}

export const SCOPED_INVITED_AGENT_ACTIONS = [
  'manage:profile',
  'manage:intents',
  'manage:networks',
  'manage:contacts',
  'manage:opportunities',
] as const;

class NetworkInvitationService {
  /**
   * Idempotent membership-and-agent provisioning without any email side-effects.
   * Used by the headless signup path. invite() wraps this and adds email delivery.
   *
   * @param params.rotateKey - When true and a scoped agent already exists, revokes
   *   its tokens and mints a fresh one (returns new key). When false, returns
   *   apiKey=null for users who already have a scoped agent.
   */
  async ensureMembership(params: {
    networkId: string;
    email: string;
    name?: string;
    rotateKey?: boolean;
  }): Promise<EnsureMembershipResult> {
    const email = params.email.toLowerCase().trim();
    const rotateKey = params.rotateKey ?? false;

    const { user, created } = await this.findOrCreateUser(email, params.name);
    await ensurePersonalNetwork(user.id);
    const { alreadyMember } = await this.joinNetwork(user.id, params.networkId);

    const agentId = await this.findScopedAgentId(user.id, params.networkId);
    if (agentId) {
      if (rotateKey) {
        await agentTokenAdapter.revokeAllForAgent(agentId);
        const token = await agentTokenAdapter.create(user.id, {
          name: 'Personal Agent API Key',
          agentId,
        });
        return { user, apiKey: token.key, created, alreadyMember };
      }
      logger.info('[NetworkInvitation] Skipping provisioning; scoped agent already exists', {
        userId: user.id,
        networkId: params.networkId,
      });
      return { user, apiKey: null, created, alreadyMember };
    }

    const { apiKey } = await this.provisionScopedAgent(user.id, params.networkId);
    return { user, apiKey, created, alreadyMember };
  }

  /**
   * Idempotent invite. Ensures user, personal network, and network membership
   * always exist; provisions a network-scoped personal agent and API key
   * (and emails the connect command) whenever the user does not already have
   * a scoped agent for this network. Reusing a user who was created via
   * another path (e.g. ghost contact) still yields a key + email.
   *
   * @param params - networkId, email, optional name
   * @returns InviteResult — see field docs
   */
  async invite(params: InviteParams): Promise<InviteResult> {
    const email = params.email.toLowerCase().trim();

    const result = await this.ensureMembership({
      networkId: params.networkId,
      email,
      name: params.name,
      rotateKey: false,
    });

    if (result.apiKey) {
      const networkName = await this.lookupNetworkName(params.networkId);
      const connectCommand = buildConnectCommand(result.apiKey);
      await this.dispatchInvitationEmail({
        to: email,
        networkName,
        apiKey: result.apiKey,
        connectCommand,
      });
      logger.info('[NetworkInvitation] Provisioned scoped agent + invited', {
        userId: result.user.id,
        networkId: params.networkId,
      });
    }

    return {
      user: result.user,
      apiKey: result.apiKey,
      created: result.created,
      alreadyMember: result.alreadyMember,
      agentProvisioned: result.apiKey !== null,
    };
  }

  async findScopedAgentId(userId: string, networkId: string): Promise<string | null> {
    const [row] = await db
      .select({ agentId: schema.agentPermissions.agentId })
      .from(schema.agentPermissions)
      .innerJoin(schema.agents, eq(schema.agents.id, schema.agentPermissions.agentId))
      .where(and(
        eq(schema.agentPermissions.userId, userId),
        eq(schema.agentPermissions.scope, 'network'),
        eq(schema.agentPermissions.scopeId, networkId),
        isNull(schema.agents.deletedAt),
      ))
      .limit(1);
    return row?.agentId ?? null;
  }

  private async lookupNetworkName(networkId: string): Promise<string> {
    const [row] = await db
      .select({ title: schema.networks.title })
      .from(schema.networks)
      .where(eq(schema.networks.id, networkId))
      .limit(1);
    return row?.title ?? 'your network';
  }

  private async dispatchInvitationEmail(params: {
    to: string;
    networkName: string;
    apiKey: string;
    connectCommand: string;
    isResend?: boolean;
  }): Promise<void> {
    const rendered = networkInvitationTemplate({
      networkName: params.networkName,
      apiKey: params.apiKey,
      connectCommand: params.connectCommand,
      isResend: params.isResend,
    });

    try {
      const result = (await executeSendEmail({
        to: params.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      })) as { skipped?: boolean; reason?: string };
      if (result.skipped) {
        logger.info('[NetworkInvitation] Email send skipped', {
          to: params.to,
          reason: result.reason,
        });
      }
    } catch (err) {
      logger.error('[NetworkInvitation] Failed to send invitation email', { to: params.to, error: err });
      // Fail-soft: provisioning succeeded; organizer can re-issue the invitation.
    }
  }

  private async findOrCreateUser(
    email: string,
    name?: string,
  ): Promise<{ user: { id: string; email: string }; created: boolean }> {
    const [existing] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(
        and(
          eq(schema.users.email, email),
          isNull(schema.users.deletedAt),
        ),
      )
      .limit(1);

    if (existing) return { user: existing, created: false };

    const [newUser] = await db
      .insert(schema.users)
      .values({
        email,
        name: name ?? email.split('@')[0],
        emailVerified: true,
        isGhost: false,
      })
      .onConflictDoNothing()
      .returning({ id: schema.users.id, email: schema.users.email });

    if (!newUser) {
      const [raced] = await db
        .select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.email, email),
            isNull(schema.users.deletedAt),
          ),
        )
        .limit(1);
      if (!raced) {
        throw new Error(
          `Cannot invite user: email exists but is filtered out (likely soft-deleted): ${email}`,
        );
      }
      return { user: raced, created: false };
    }
    return { user: newUser, created: true };
  }

  private async joinNetwork(userId: string, networkId: string): Promise<{ alreadyMember: boolean }> {
    const inserted = await db
      .insert(schema.networkMembers)
      .values({ networkId, userId, permissions: ['member'], autoAssign: true })
      .onConflictDoNothing()
      .returning({ userId: schema.networkMembers.userId });
    return { alreadyMember: inserted.length === 0 };
  }

  /**
   * Resend the invitation email for an existing member of a network. Rotates
   * the member's network-scoped api key — the previous key is hard-deleted
   * and a fresh one is minted, then emailed.
   *
   * If the member has no scoped agent yet (e.g., they joined via another path),
   * a fresh agent + key is provisioned instead and `rotated` is `false`.
   *
   * @param params - networkId and memberId
   * @returns rotated flag and the recipient email
   * @throws Error('Member not found') when the user is not a member of this
   *         network or the user record is missing/soft-deleted.
   */
  async resendInvite(params: ResendInviteParams): Promise<ResendInviteResult> {
    const { networkId, memberId } = params;

    const [member] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(and(eq(schema.users.id, memberId), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!member) throw new Error('Member not found');

    const [membership] = await db
      .select({ userId: schema.networkMembers.userId })
      .from(schema.networkMembers)
      .where(and(
        eq(schema.networkMembers.networkId, networkId),
        eq(schema.networkMembers.userId, memberId),
      ))
      .limit(1);
    if (!membership) throw new Error('Member not found');

    const agentId = await this.findScopedAgentId(memberId, networkId);
    let apiKey: string;
    let rotated: boolean;
    if (agentId) {
      await agentTokenAdapter.revokeAllForAgent(agentId);
      const token = await agentTokenAdapter.create(memberId, {
        name: 'Personal Agent API Key',
        agentId,
      });
      apiKey = token.key;
      rotated = true;
    } else {
      const provision = await this.provisionScopedAgent(memberId, networkId);
      apiKey = provision.apiKey;
      rotated = false;
    }

    const networkName = await this.lookupNetworkName(networkId);
    const connectCommand = buildConnectCommand(apiKey);

    await this.dispatchInvitationEmail({
      to: member.email,
      networkName,
      apiKey,
      connectCommand,
      isResend: true,
    });

    logger.info('[NetworkInvitation] Resent invite', {
      userId: memberId,
      networkId,
      rotated,
    });

    return { rotated, email: member.email };
  }

  /**
   * Mints a network-scoped personal agent + API key for a user. Used for new
   * invites and (via experimentService) for existing users re-signing through
   * the master-key headless endpoint.
   */
  async provisionScopedAgent(userId: string, networkId: string): Promise<{ apiKey: string; agentId: string }> {
    const agent = await agentDatabaseAdapter.createAgent({
      ownerId: userId,
      name: 'Personal Agent',
      type: 'personal',
    });
    await agentDatabaseAdapter.grantPermission({
      agentId: agent.id,
      userId,
      scope: 'network',
      scopeId: networkId,
      actions: [...SCOPED_INVITED_AGENT_ACTIONS],
    });
    const token = await agentTokenAdapter.create(userId, {
      name: 'Personal Agent API Key',
      agentId: agent.id,
    });
    return { apiKey: token.key, agentId: agent.id };
  }
}

export const networkInvitationService = new NetworkInvitationService();
