import { and, eq, isNull, sql } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import { experimentImportCredentialsTemplate } from '../lib/email/templates/experiment-import-credentials.template';
import { executeSendEmail } from '../lib/email/transport.helper';
import { buildMcpServerConfig } from '../lib/mcp/mcp-config';
import * as schema from '../schemas/database.schema';

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

const logger = log.service.from('ExperimentService');

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

export class ExperimentService {

  async signup(networkId: string, payload: SignupPayload): Promise<ExperimentSignupResult> {
    const normalizedEmail = payload.email.toLowerCase().trim();
    logger.verbose('Signup attempt', { networkId, email: normalizedEmail });

    const result = await networkInvitationService.ensureMembership({
      networkId,
      email: normalizedEmail,
      mintKey: true,
    });

    // New users get their first key; existing users get an additional key.
    // We deliberately do not revoke prior keys here: signup may be retried by
    // portals/installers, and invalidating a just-installed key creates
    // a setup race. Explicit rotation paths remain responsible for revocation.
    const apiKey = result.apiKey!;

    await this.applyProfileData(result.user.id, {
      name: payload.name,
      bio: payload.bio,
      location: payload.location,
      socials: payload.socials ?? [],
    });

    await this.stageProfileSeed(result.user.id, networkId, {
      email: normalizedEmail,
      name: payload.name,
      bio: payload.bio,
      location: payload.location,
      socials: payload.socials ?? [],
    }, 'experiment_signup');

    logger.info('Signup complete', {
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
    for (const row of rows) {
      try {
        const email = row.email.toLowerCase().trim();
        const result = await networkInvitationService.ensureMembership({
          networkId,
          email,
          rotateKey: true,
        });
        await this.applyProfileData(result.user.id, row);
        await this.stageProfileSeed(result.user.id, networkId, row, 'experiment_csv_import');
        credentials.push({
          email: result.user.email,
          name: row.name,
          apiKey: result.apiKey!,
        });
        imported++;
      } catch (err) {
        logger.warn('Import row failed', { email: row.email, error: err });
        skipped++;
      }
    }

    const ownersNotified = credentials.length > 0
      ? await this.dispatchOwnerCredentialsEmail(networkId, credentials)
      : 0;

    logger.info('Import complete', { networkId, imported, skipped, ownersNotified });
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
      logger.warn('Owner email skipped: network not found', { networkId });
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
      logger.warn('Owner email skipped: no owners with email', { networkId });
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
      logger.error('Owner credentials email failed', {
        networkId,
        recipients: recipients.length,
        error: err,
      });
      return 0;
    }
  }

  /**
   * Writes profile fields and socials directly to the `users` and `user_socials`
   * tables so that the enrichment pipeline and opportunity delivery can read them
   * immediately. Called for both headless signup and CSV import.
   *
   * Existing user fields are overwritten only when the payload supplies a value;
   * existing socials with the same label are updated in-place.
   */
  private async applyProfileData(
    userId: string,
    row: { name?: string; bio?: string; location?: string; socials: { label: string; value: string }[] },
  ): Promise<void> {
    const updates: Record<string, string> = {};
    if (row.name?.trim()) updates.name = row.name.trim();
    if (row.bio?.trim()) updates.intro = row.bio.trim();
    if (row.location?.trim()) updates.location = row.location.trim();

    if (Object.keys(updates).length > 0) {
      await db.update(schema.users).set(updates).where(eq(schema.users.id, userId));
    }

    const socials = row.socials.filter(s => s.label.trim() && s.value.trim());
    if (socials.length > 0) {
      const rows = socials.map(s => ({ userId, label: s.label.trim(), value: s.value.trim() }));
      await db.transaction(async (tx) => {
        for (const social of rows) {
          await tx.delete(schema.userSocials).where(
            and(eq(schema.userSocials.userId, userId), eq(schema.userSocials.label, social.label)),
          );
        }
        await tx.insert(schema.userSocials).values(rows);
      });
    }
  }

  /**
   * Retains optional profile/social data from headless experiment signup or CSV
   * import as an onboarding provenance seed after applying it immediately to the
   * user/profile tables. Profile tools use the seed to explain and refine the
   * active profile during onboarding review.
   *
   * @param userId - User receiving the provenance seed.
   * @param networkId - Experiment network that supplied the seed.
   * @param row - Import/signup row carrying optional profile fields.
   * @param source - Source flow for provenance.
   */
  private async stageProfileSeed(
    userId: string,
    networkId: string,
    row: ImportRow,
    source: schema.OnboardingProfileSeed['source'],
  ): Promise<void> {
    const socials = row.socials.filter((social) => social.label.trim() && social.value.trim());
    const seed: schema.OnboardingProfileSeed = {
      source,
      networkId,
      capturedAt: new Date().toISOString(),
      ...(row.name?.trim() ? { name: row.name.trim() } : {}),
      ...(row.bio?.trim() ? { bio: row.bio.trim() } : {}),
      ...(row.location?.trim() ? { location: row.location.trim() } : {}),
      ...(socials.length > 0 ? { socials } : {}),
    };

    if (!seed.name && !seed.bio && !seed.location && !seed.socials?.length) return;

    const [user] = await db
      .select({ onboarding: schema.users.onboarding })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    const onboarding = user?.onboarding ?? {};
    const profileSeeds = (onboarding.profileSeeds ?? [])
      .filter((existing) => !(existing.networkId === networkId && existing.source === source));

    await db
      .update(schema.users)
      .set({
        onboarding: {
          ...onboarding,
          profileSeeds: [...profileSeeds, seed],
        },
      })
      .where(eq(schema.users.id, userId));
  }

}

export const experimentService = new ExperimentService();
