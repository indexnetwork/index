import { and, eq, isNull } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import * as schema from '../schemas/database.schema';
import { networkInvitationTemplate } from '../lib/email/templates/network-invitation.template';
import { executeSendEmail } from '../lib/email/transport.helper';

const WEB_APP_URL = (process.env.WEB_APP_URL || 'https://index.network').replace(/\/+$/, '');

const logger = log.service.from('NetworkInvitationService');

export interface InviteParams {
  networkId: string;
  email: string;
  /** Optional name applied only to the new user. Ignored if user already exists. */
  name?: string;
  /** The owner doing the inviting, named in the email. */
  invitedById?: string;
}

export interface NotifyAddedParams {
  networkId: string;
  userId: string;
  /** The owner who added them, named in the email. */
  addedById?: string;
}

export interface InviteResult {
  user: { id: string; email: string };
  /** True if the user was newly created. */
  created: boolean;
  /** True if the user was already a member of this network. */
  alreadyMember: boolean;
}

class NetworkInvitationService {
  /**
   * Idempotent invite: find or create the user, add them to the network as a
   * member, and tell them to sign in. No agent and no credential are issued —
   * the invitee authenticates through the normal login flow.
   *
   * @param params - networkId, email, optional name for a newly created user.
   * @returns The user, whether it was created, and whether it was already a member.
   * @throws Error when the email belongs to a filtered-out (soft-deleted) user.
   */
  async invite(params: InviteParams): Promise<InviteResult> {
    const email = params.email.toLowerCase().trim();

    const { user, created } = await this.findOrCreateUser(email, params.name);
    const { alreadyMember } = await this.joinNetwork(user.id, params.networkId);

    if (!alreadyMember) {
      await this.notifyAdded({ networkId: params.networkId, userId: user.id, addedById: params.invitedById });
      logger.info('Invited user to network', { userId: user.id, networkId: params.networkId });
    }

    return { user, created, alreadyMember };
  }

  /**
   * Email someone that an owner added them to a network, by email or by
   * picking them. Never sent for people who joined on their own. Fail-soft:
   * the membership is already written, so a send failure is only logged.
   */
  async notifyAdded(params: NotifyAddedParams): Promise<void> {
    try {
      const [recipient] = await db
        .select({ email: schema.users.email, name: schema.users.name })
        .from(schema.users)
        .where(and(eq(schema.users.id, params.userId), isNull(schema.users.deletedAt)))
        .limit(1);
      if (!recipient?.email) return;

      const [network] = await db
        .select({ title: schema.networks.title })
        .from(schema.networks)
        .where(eq(schema.networks.id, params.networkId))
        .limit(1);

      let inviterName: string | undefined;
      if (params.addedById && params.addedById !== params.userId) {
        const [inviter] = await db
          .select({ name: schema.users.name })
          .from(schema.users)
          .where(eq(schema.users.id, params.addedById))
          .limit(1);
        inviterName = inviter?.name ?? undefined;
      }

      await this.dispatchInvitationEmail({
        to: recipient.email,
        userId: params.userId,
        rendered: networkInvitationTemplate({
          networkName: network?.title ?? 'a network',
          networkUrl: `${WEB_APP_URL}/networks/${encodeURIComponent(params.networkId)}`,
          recipientName: recipient.name ?? undefined,
          inviterName,
        }),
      });
    } catch (err) {
      logger.error('Failed to prepare added-to-network email', { userId: params.userId, networkId: params.networkId, error: err });
    }
  }

  private async dispatchInvitationEmail(params: {
    to: string;
    userId: string;
    rendered: ReturnType<typeof networkInvitationTemplate>;
  }): Promise<void> {
    const { rendered } = params;

    try {
      const result = (await executeSendEmail({
        to: params.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        kind: 'network_invitation',
        userId: params.userId,
      })) as { skipped?: boolean; reason?: string };
      if (result.skipped) {
        logger.info('Email send skipped', {
          to: params.to,
          reason: result.reason,
        });
      }
    } catch (err) {
      logger.error('Failed to send invitation email', { to: params.to, error: err });
      // Fail-soft: membership is written; the organizer can re-issue the invitation.
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
        // Being added to a network by its owner proves the invitee owns the
        // mailbox; authorization still comes from a real login.
        emailVerified: true,
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

    // An owner adding someone settles any request they had waiting.
    await db
      .delete(schema.networkJoinRequests)
      .where(and(
        eq(schema.networkJoinRequests.networkId, networkId),
        eq(schema.networkJoinRequests.userId, userId),
      ));

    return { alreadyMember: inserted.length === 0 };
  }
}

export const networkInvitationService = new NetworkInvitationService();
