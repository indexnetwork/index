import { and, eq, isNull, sql, inArray } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { executeSendEmail } from '../lib/email/transport.helper';
import { networkRequestApprovedTemplate, networkRequestNeedsChangesTemplate } from '../lib/email/templates';
import { staffNotificationEmails } from '../lib/staff';
import * as schema from '../schemas/database.schema';
import type { NetworkRequestDetails } from '../schemas/database.schema';

const logger = log.service.from('NetworkRequestService');

export interface NetworkRequestInput {
  name: string;
  purpose?: string;
  audience?: string;
  expectedSize?: string;
  notes?: string;
}

export interface NetworkRequestDTO {
  id: string;
  title: string;
  status: schema.NetworkRequestStatus;
  purpose?: string;
  audience?: string;
  expectedSize?: string;
  notes?: string;
  reviewNote?: string;
  submittedAt: string;
  requestedBy?: { id: string; name: string; email: string | null };
}

type NetworkRow = typeof schema.networks.$inferSelect;

function webBaseUrl(): string {
  return (process.env.WEB_APP_URL || 'https://index.network').replace(/\/+$/, '');
}

function readRequest(row: NetworkRow): NetworkRequestDetails | null {
  const req = (row.metadata as { request?: NetworkRequestDetails } | null)?.request;
  return req ?? null;
}

/**
 * NetworkRequestService
 *
 * Early-access "create a network" flow. A request is a `networks` row carrying a
 * non-null `requestStatus` and NO membership; it is inert (hidden from discovery,
 * unusable) until a staff reviewer approves it — at which point `requestStatus`
 * is cleared and the requester is added as owner, turning it into a real network.
 */
export class NetworkRequestService {
  constructor(private adapter = new ChatDatabaseAdapter()) {}

  private toDTO(row: NetworkRow, requestedBy?: NetworkRequestDTO['requestedBy']): NetworkRequestDTO {
    const req = readRequest(row);
    return {
      id: row.id,
      title: row.title,
      status: (row.requestStatus ?? 'pending') as schema.NetworkRequestStatus,
      purpose: req?.purpose,
      audience: req?.audience,
      expectedSize: req?.expectedSize,
      notes: req?.notes,
      reviewNote: req?.reviewNote,
      submittedAt: req?.submittedAt ?? row.createdAt.toISOString(),
      ...(requestedBy ? { requestedBy } : {}),
    };
  }

  /** Submit a new network request. Creates an inert, memberless request row. */
  async createRequest(
    requester: { id: string; name: string; email: string | null },
    input: NetworkRequestInput,
  ): Promise<NetworkRequestDTO> {
    const request: NetworkRequestDetails = {
      requestedByUserId: requester.id,
      ...(input.purpose ? { purpose: input.purpose } : {}),
      ...(input.audience ? { audience: input.audience } : {}),
      ...(input.expectedSize ? { expectedSize: input.expectedSize } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
      submittedAt: new Date().toISOString(),
    };

    const [row] = await db
      .insert(schema.networks)
      .values({
        title: input.name,
        prompt: input.purpose ?? null,
        requestStatus: 'pending',
        metadata: { request },
      })
      .returning();

    logger.verbose('Network request created', { networkId: row.id, userId: requester.id });
    this.notifyStaff(row, requester).catch((err) =>
      logger.error('Staff notification failed', { networkId: row.id, error: err }),
    );
    return this.toDTO(row);
  }

  /** List the caller's own requests (pending / needs_changes). */
  async listMyRequests(userId: string): Promise<NetworkRequestDTO[]> {
    const rows = await db
      .select()
      .from(schema.networks)
      .where(
        and(
          sql`${schema.networks.requestStatus} IS NOT NULL`,
          isNull(schema.networks.deletedAt),
          sql`${schema.networks.metadata}->'request'->>'requestedByUserId' = ${userId}`,
        ),
      )
      .orderBy(sql`${schema.networks.createdAt} DESC`);
    return rows.map((r) => this.toDTO(r));
  }

  /** List every open request, for staff review. */
  async listPendingRequests(): Promise<NetworkRequestDTO[]> {
    const rows = await db
      .select()
      .from(schema.networks)
      .where(
        and(
          sql`${schema.networks.requestStatus} IS NOT NULL`,
          isNull(schema.networks.deletedAt),
        ),
      )
      .orderBy(sql`${schema.networks.createdAt} DESC`);

    const requesterIds = [
      ...new Set(rows.map((r) => readRequest(r)?.requestedByUserId).filter((id): id is string => !!id)),
    ];
    const requesters = requesterIds.length
      ? await db
          .select({ id: schema.users.id, name: schema.users.name, email: schema.users.email })
          .from(schema.users)
          .where(inArray(schema.users.id, requesterIds))
      : [];
    const byId = new Map(requesters.map((u) => [u.id, u]));

    return rows.map((r) => {
      const id = readRequest(r)?.requestedByUserId;
      const u = id ? byId.get(id) : undefined;
      return this.toDTO(r, u ? { id: u.id, name: u.name, email: u.email } : undefined);
    });
  }

  /** Update the caller's own request and resubmit it for review. */
  async updateRequest(networkId: string, userId: string, input: NetworkRequestInput): Promise<NetworkRequestDTO> {
    const row = await this.getOwnedRequest(networkId, userId);
    const prev = readRequest(row);
    const request: NetworkRequestDetails = {
      requestedByUserId: userId,
      ...(input.purpose ? { purpose: input.purpose } : {}),
      ...(input.audience ? { audience: input.audience } : {}),
      ...(input.expectedSize ? { expectedSize: input.expectedSize } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
      submittedAt: prev?.submittedAt ?? new Date().toISOString(),
    };
    const [updated] = await db
      .update(schema.networks)
      .set({ title: input.name, prompt: input.purpose ?? null, requestStatus: 'pending', metadata: { request } })
      .where(eq(schema.networks.id, networkId))
      .returning();
    return this.toDTO(updated);
  }

  /** Dismiss (soft-delete) the caller's own request. */
  async dismissRequest(networkId: string, userId: string): Promise<void> {
    await this.getOwnedRequest(networkId, userId);
    await db
      .update(schema.networks)
      .set({ deletedAt: new Date() })
      .where(eq(schema.networks.id, networkId));
  }

  /** Staff decision on a request: approve (create it) or ask for changes. */
  async reviewRequest(
    networkId: string,
    decision: 'approve' | 'needs_changes',
    reviewNote?: string,
  ): Promise<NetworkRequestDTO> {
    const [row] = await db
      .select()
      .from(schema.networks)
      .where(and(eq(schema.networks.id, networkId), isNull(schema.networks.deletedAt)))
      .limit(1);
    if (!row || !row.requestStatus) {
      throw new Error('Network request not found');
    }
    const req = readRequest(row);
    if (!req?.requestedByUserId) {
      throw new Error('Network request has no requester');
    }

    if (decision === 'approve') {
      const nextMeta = { request: { ...req, reviewedAt: new Date().toISOString(), reviewNote: undefined } };
      const [updated] = await db
        .update(schema.networks)
        .set({ requestStatus: null, metadata: nextMeta })
        .where(eq(schema.networks.id, networkId))
        .returning();
      await this.adapter.addMemberToNetwork(networkId, req.requestedByUserId, 'owner');
      this.emailRequester('approve', updated, req.requestedByUserId).catch((err) =>
        logger.error('Approval email failed', { networkId, error: err }),
      );
      return this.toDTO(updated);
    }

    const note = (reviewNote ?? '').trim();
    if (!note) {
      throw new Error('reviewNote is required for needs_changes');
    }
    const nextMeta = { request: { ...req, reviewNote: note, reviewedAt: new Date().toISOString() } };
    const [updated] = await db
      .update(schema.networks)
      .set({ requestStatus: 'needs_changes', metadata: nextMeta })
      .where(eq(schema.networks.id, networkId))
      .returning();
    this.emailRequester('needs_changes', updated, req.requestedByUserId).catch((err) =>
      logger.error('Needs-changes email failed', { networkId, error: err }),
    );
    return this.toDTO(updated);
  }

  private async getOwnedRequest(networkId: string, userId: string): Promise<NetworkRow> {
    const [row] = await db
      .select()
      .from(schema.networks)
      .where(and(eq(schema.networks.id, networkId), isNull(schema.networks.deletedAt)))
      .limit(1);
    if (!row || !row.requestStatus) {
      throw new Error('Network request not found');
    }
    if (readRequest(row)?.requestedByUserId !== userId) {
      throw new Error('Access denied: not your network request');
    }
    return row;
  }

  private async notifyStaff(row: NetworkRow, requester: { name: string; email: string | null }): Promise<void> {
    const req = readRequest(row);
    const lines = [
      `New network request: ${row.title}`,
      `From: ${requester.name}${requester.email ? ` <${requester.email}>` : ''}`,
      req?.purpose ? `Purpose: ${req.purpose}` : null,
      req?.audience ? `Audience: ${req.audience}` : null,
      req?.expectedSize ? `Expected size: ${req.expectedSize}` : null,
      req?.notes ? `Notes: ${req.notes}` : null,
      `Review at ${webBaseUrl()}/networks`,
    ].filter(Boolean) as string[];
    const text = lines.join('\n');
    const html = `<div style="font-family: Arial, sans-serif;">${lines
      .map((l) => `<p>${l.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]!))}</p>`)
      .join('')}</div>`;
    await executeSendEmail({
      to: staffNotificationEmails(),
      subject: `Network request: ${row.title.replace(/[\r\n\t]+/g, ' ').slice(0, 200)}`,
      html,
      text,
    });
  }

  private async emailRequester(
    decision: 'approve' | 'needs_changes',
    row: NetworkRow,
    requestedByUserId: string,
  ): Promise<void> {
    const [user] = await db
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, requestedByUserId))
      .limit(1);
    if (!user?.email) return;

    if (decision === 'approve') {
      const rendered = networkRequestApprovedTemplate({
        networkName: row.title,
        networkUrl: `${webBaseUrl()}/networks/${row.id}`,
      });
      await executeSendEmail({ to: user.email, subject: rendered.subject, html: rendered.html, text: rendered.text });
      return;
    }

    const rendered = networkRequestNeedsChangesTemplate({
      networkName: row.title,
      reviewNote: readRequest(row)?.reviewNote ?? '',
      networksUrl: `${webBaseUrl()}/networks`,
    });
    await executeSendEmail({ to: user.email, subject: rendered.subject, html: rendered.html, text: rendered.text });
  }
}

export const networkRequestService = new NetworkRequestService();
