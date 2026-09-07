import { and, eq, isNull } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import * as schema from '../schemas/database.schema';
import { networkInvitationTemplate } from '../lib/email/templates/network-invitation.template';
import { executeSendEmail } from '../lib/email/transport.helper';

const logger = log.service.from('NetworkInvitationService');

export interface InviteParams {
  networkId: string;
  email: string;
  /** Optional name applied only to the new user. Ignored if user already exists. */
  name?: string;
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
      const networkName = await this.lookupNetworkName(params.networkId);
      await this.dispatchInvitationEmail({ to: email, networkName });
      logger.info('Invited user to network', { userId: user.id, networkId: params.networkId });
    }

    return { user, created, alreadyMember };
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
  }): Promise<void> {
    const rendered = networkInvitationTemplate({ networkName: params.networkName });

    try {
      const result = (await executeSendEmail({
        to: params.to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
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
    return { alreadyMember: inserted.length === 0 };
  }
}

export const networkInvitationService = new NetworkInvitationService();
