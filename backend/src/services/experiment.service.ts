import { and, eq, isNull, sql } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import { experimentImportCredentialsTemplate } from '../lib/email/templates/experiment-import-credentials.template';
import { executeSendEmail } from '../lib/email/transport.helper';
import { buildMcpServerConfig } from '../lib/mcp/mcp-config';
import * as schema from '../schemas/database.schema';
import { enrichmentQueue } from '../queues/enrichment.queue';

/**
 * Experiment is a thin facade over the network-invitation flow: signup uses
 * the master-key headless path and importMembers iterates rows. Both delegate
 * user/agent provisioning to {@link networkInvitationService}. This is a
 * deliberate, narrowly-scoped service-to-service import — the layering rule
 * normally forbids it, but introducing events/queues here would be over-
 * engineering. Tracked for follow-up: experiment.service is expected to be
 * folded into network-invitation.service entirely.
 */
// eslint-disable-next-line boundaries/dependencies
import { networkInvitationService } from './network-invitation.service';

const logger = log.service.from('experiment');

/**
 * Thrown by {@link ExperimentService.lookupSignup} when the (network, email)
 * pair is not in a fully-provisioned state. The controller maps it to HTTP 409.
 */
export class SignupNotCompleteError extends Error {
  constructor() {
    super('User has not completed signup for this network');
    this.name = 'SignupNotCompleteError';
  }
}

export interface ImportRow {
  email: string;
  name?: string;
  bio?: string;
  location?: string;
  socials: { label: string; value: string }[];
}

export interface ImportCredential {
  email: string;
  name?: string;
  apiKey: string;
}

export interface SignupPayload {
  email: string;
  name?: string;
  bio?: string;
  location?: string;
  socials?: { label: string; value: string }[];
}

export interface ExperimentSignupResult {
  user: { id: string; email: string };
  apiKey: string;
  mcpServer: {
    name: string;
    url: string;
    headers: Record<string, string>;
  };
  created: boolean;
}

class ExperimentService {
  async signup(networkId: string, payload: SignupPayload): Promise<ExperimentSignupResult> {
    const normalizedEmail = payload.email.toLowerCase().trim();
    logger.verbose('[ExperimentService] Signup attempt', { networkId, email: normalizedEmail });

    const result = await networkInvitationService.ensureMembership({
      networkId,
      email: normalizedEmail,
      name: payload.name,
      rotateKey: true,
    });

    // rotateKey=true guarantees apiKey is non-null
    const apiKey = result.apiKey!;

    if (payload.name || payload.bio || payload.location || (payload.socials && payload.socials.length > 0)) {
      await this.applyProfilePatch(result.user.id, {
        email: normalizedEmail,
        name: payload.name,
        bio: payload.bio,
        location: payload.location,
        socials: payload.socials ?? [],
      });
    }

    // Enqueue profile enrichment so the user gets a profile + HyDE.
    try {
      await enrichmentQueue.addEnrichUserJob({ userId: result.user.id });
    } catch (err) {
      logger.warn('[ExperimentService] Failed to enqueue profile enrichment (non-fatal)', { error: err });
    }

    logger.info('[ExperimentService] Signup complete', {
      userId: result.user.id,
      networkId,
      created: result.created,
    });

    return {
      user: result.user,
      apiKey,
      mcpServer: buildMcpServerConfig(apiKey),
      created: result.created,
    };
  }

  /**
   * Read-only check that `(networkId, email)` is fully provisioned. Does NOT
   * create, update, or rotate anything. Used by the headless signup-lookup
   * endpoint so integrators can verify state without invalidating a deployed key.
   *
   * @throws SignupNotCompleteError when the user is missing/soft-deleted, has
   *         no live membership in the network, or has no live scoped agent for it.
   */
  async lookupSignup(
    networkId: string,
    email: string,
  ): Promise<{ user: { id: string; email: string } }> {
    const normalizedEmail = email.toLowerCase().trim();

    const [user] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(and(sql`lower(${schema.users.email}) = ${normalizedEmail}`, isNull(schema.users.deletedAt)))
      .limit(1);
    if (!user) throw new SignupNotCompleteError();

    const [membership] = await db
      .select({ userId: schema.networkMembers.userId })
      .from(schema.networkMembers)
      .where(and(
        eq(schema.networkMembers.networkId, networkId),
        eq(schema.networkMembers.userId, user.id),
        isNull(schema.networkMembers.deletedAt),
      ))
      .limit(1);
    if (!membership) throw new SignupNotCompleteError();

    const agentId = await networkInvitationService.findScopedAgentId(user.id, networkId);
    if (!agentId) throw new SignupNotCompleteError();

    return { user };
  }

  async importMembers(
    networkId: string,
    rows: ImportRow[],
  ): Promise<{ imported: number; skipped: number; ownersNotified: number }> {
    let imported = 0;
    let skipped = 0;
    const credentials: ImportCredential[] = [];

    // Headless path: ensureMembership rotates the api key and emits no per-user
    // email. After the loop, a single summary email is sent to the network's
    // owner(s) with all minted keys as an inline CSV — the experimental-network
    // policy bypasses per-user invitation emails entirely.
    const importedUserIdSet = new Set<string>();
    for (const row of rows) {
      try {
        const email = row.email.toLowerCase().trim();
        const result = await networkInvitationService.ensureMembership({
          networkId,
          email,
          name: row.name,
          rotateKey: true,
        });
        await this.applyProfilePatch(result.user.id, row);
        importedUserIdSet.add(result.user.id);
        credentials.push({
          email: result.user.email,
          name: row.name,
          apiKey: result.apiKey!,
        });
        imported++;
      } catch (err) {
        logger.warn('[ExperimentService] Import row failed', { email: row.email, error: err });
        skipped++;
      }
    }

    const importedUserIds = [...importedUserIdSet];

    // Enqueue profile enrichment: the profile graph reads name, intro, location,
    // and socials from the users/user_socials tables (written by applyProfilePatch
    // above), then generates a full profile with premises and HyDE documents.
    if (importedUserIds.length > 0) {
      try {
        await enrichmentQueue.addEnrichUserJobBulk(importedUserIds.map(id => ({ userId: id })));
        logger.info('[ExperimentService] Enqueued profile enrichment', { count: importedUserIds.length });
      } catch (err) {
        logger.warn('[ExperimentService] Failed to enqueue profile enrichment (non-fatal)', { error: err });
      }
    }

    const ownersNotified = credentials.length > 0
      ? await this.dispatchOwnerCredentialsEmail(networkId, credentials)
      : 0;

    logger.info('[ExperimentService] Import complete', { networkId, imported, skipped, ownersNotified });
    return { imported, skipped, ownersNotified };
  }

  /**
   * Looks up every owner of the network and sends them a single email
   * containing every minted credential as an inline CSV. Returns the number
   * of owners that received the message. Failures are logged and swallowed
   * — provisioning has already succeeded and the import call must not roll
   * back because the notification failed.
   */
  private async dispatchOwnerCredentialsEmail(
    networkId: string,
    credentials: ImportCredential[],
  ): Promise<number> {
    const [network] = await db
      .select({ title: schema.networks.title })
      .from(schema.networks)
      .where(eq(schema.networks.id, networkId))
      .limit(1);
    if (!network) {
      logger.warn('[ExperimentService] Owner email skipped: network not found', { networkId });
      return 0;
    }

    const owners = await db
      .select({ email: schema.users.email })
      .from(schema.networkMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.networkMembers.userId))
      .where(and(
        eq(schema.networkMembers.networkId, networkId),
        sql`'owner' = ANY(${schema.networkMembers.permissions})`,
        isNull(schema.users.deletedAt),
      ));

    const recipients = owners.map(o => o.email).filter(Boolean);
    if (recipients.length === 0) {
      logger.warn('[ExperimentService] Owner email skipped: no owners with email', { networkId });
      return 0;
    }

    const rendered = experimentImportCredentialsTemplate({
      networkName: network.title,
      credentials,
    });

    try {
      await executeSendEmail({
        to: recipients,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });
      return recipients.length;
    } catch (err) {
      logger.error('[ExperimentService] Owner credentials email failed', {
        networkId,
        recipients: recipients.length,
        error: err,
      });
      return 0;
    }
  }

  /**
   * Applies the optional profile/socials patch for an imported member onto an
   * existing user row. Idempotent — safe to call repeatedly.
   *
   * @param userId - User to patch.
   * @param row - Import row carrying optional name/bio/location/socials.
   */
  private async applyProfilePatch(userId: string, row: ImportRow): Promise<void> {
    const userPatch: { name?: string; intro?: string; location?: string } = {};
    if (row.name) userPatch.name = row.name;
    if (row.bio) userPatch.intro = row.bio;
    if (row.location) userPatch.location = row.location;
    if (Object.keys(userPatch).length > 0) {
      await db.update(schema.users).set(userPatch).where(eq(schema.users.id, userId));
    }

    if (row.bio || row.location) {
      const [existing] = await db
        .select({ id: schema.userProfiles.id, identity: schema.userProfiles.identity })
        .from(schema.userProfiles)
        .where(eq(schema.userProfiles.userId, userId))
        .limit(1);

      const patch: { bio?: string; location?: string } = {};
      if (row.bio) patch.bio = row.bio;
      if (row.location) patch.location = row.location;

      if (existing) {
        const identity = (existing.identity as { name?: string; bio?: string; location?: string } | null) ?? {};
        await db
          .update(schema.userProfiles)
          .set({ identity: { name: identity.name ?? '', bio: identity.bio ?? '', location: identity.location ?? '', ...patch }, updatedAt: new Date() })
          .where(eq(schema.userProfiles.id, existing.id));
      } else {
        await db
          .insert(schema.userProfiles)
          .values({
            userId,
            identity: {
              name: row.name || '',
              bio: row.bio || '',
              location: row.location || '',
            },
          });
      }
    }

    for (const social of row.socials) {
      const [existing] = await db
        .select({ id: schema.userSocials.id })
        .from(schema.userSocials)
        .where(and(
          eq(schema.userSocials.userId, userId),
          eq(schema.userSocials.label, social.label),
        ))
        .limit(1);

      if (existing) {
        await db
          .update(schema.userSocials)
          .set({ value: social.value })
          .where(eq(schema.userSocials.id, existing.id));
      } else {
        await db
          .insert(schema.userSocials)
          .values({ userId, label: social.label, value: social.value });
      }
    }
  }

}

export const experimentService = new ExperimentService();
