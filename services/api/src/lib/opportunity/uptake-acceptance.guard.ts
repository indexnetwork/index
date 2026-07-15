import { and, eq, or, sql } from 'drizzle-orm/sql';

import db from '../drizzle/drizzle';
import { log } from '../log';
import { questions } from '../../schemas/database.schema';

const logger = log.service.from('UptakeAcceptanceGuard');

/** Public question projection returned by the REST acceptance preflight. */
export interface PublicUptakeQuestion {
  id: string;
  title: string;
  prompt: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}

/** Structured soft-interlock advisory returned without mutating opportunity state. */
export interface UptakeAcceptanceAdvisoryResult {
  error: string;
  status: 409;
  advisory: {
    code: 'unresolved_uptake_questions';
    advisoryOnly: true;
    opportunityId: string;
    questions: PublicUptakeQuestion[];
    acknowledgedUptakeQuestionIds: string[];
  };
}

export interface UptakeAcceptanceCheck {
  opportunityId: string;
  userId: string;
  networkId?: string;
  acknowledgedUptakeQuestionIds?: string[];
}

export interface UptakeAcceptanceGuardLike {
  check(input: UptakeAcceptanceCheck): Promise<UptakeAcceptanceAdvisoryResult | null>;
}

interface PendingUptakeQuestionRow {
  id: string;
  detection: { mode?: string; purpose?: string; sourceType?: string; sourceId?: string };
  actors: Array<{ userId?: string; networkId?: string }>;
  payload: {
    title?: string;
    prompt?: string;
    options?: Array<{ label?: string; description?: string }>;
    multiSelect?: boolean;
  };
}

/**
 * Advisory preflight for opportunity acceptance REST paths.
 *
 * The database query is deliberately exact (recipient + opportunity + mode +
 * purpose + actor network) and is repeated on every retry. Lookup failures fail
 * open so a question-store outage cannot block acceptance.
 */
export class UptakeAcceptanceGuard implements UptakeAcceptanceGuardLike {
  /** Check whether every currently pending uptake question was acknowledged. */
  async check(input: UptakeAcceptanceCheck): Promise<UptakeAcceptanceAdvisoryResult | null> {
    if (!isEnabled()) return null;

    try {
      const actor = input.networkId
        ? [{ userId: input.userId, networkId: input.networkId }]
        : [{ userId: input.userId }];
      const conditions = [
        eq(questions.status, 'pending'),
        sql`${questions.actors}::jsonb @> ${JSON.stringify(actor)}::jsonb`,
        sql`${questions.detection}->>'mode' = 'negotiation'`,
        sql`${questions.detection}->>'purpose' = 'uptake'`,
        sql`${questions.detection}->>'sourceType' = 'opportunity'`,
        sql`${questions.detection}->>'sourceId' = ${input.opportunityId}`,
        or(sql`${questions.expiresAt} IS NULL`, sql`${questions.expiresAt} > NOW()`),
      ];
      const rows = await db
        .select({
          id: questions.id,
          detection: questions.detection,
          actors: questions.actors,
          payload: questions.payload,
        })
        .from(questions)
        .where(and(...conditions))
        .orderBy(questions.createdAt) as PendingUptakeQuestionRow[];

      const exactRows = rows.filter((row) => isExactMatch(row, input));
      const acknowledged = new Set(input.acknowledgedUptakeQuestionIds ?? []);
      if (exactRows.every((row) => acknowledged.has(row.id))) return null;

      return {
        error: 'Resolve the pending uptake questions or explicitly continue anyway.',
        status: 409,
        advisory: {
          code: 'unresolved_uptake_questions',
          advisoryOnly: true,
          opportunityId: input.opportunityId,
          questions: exactRows.map(toPublicQuestion),
          acknowledgedUptakeQuestionIds: exactRows.map((row) => row.id),
        },
      };
    } catch (error) {
      logger.warn('Uptake question lookup failed open', {
        opportunityId: input.opportunityId,
        userId: input.userId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

function isEnabled(): boolean {
  return process.env.QUESTIONER_ENABLED === 'true'
    && process.env.QUESTIONER_UPTAKE_ENABLED === 'true';
}

function isExactMatch(row: PendingUptakeQuestionRow, input: UptakeAcceptanceCheck): boolean {
  const detection = row.detection ?? {};
  if (
    detection.mode !== 'negotiation'
    || detection.purpose !== 'uptake'
    || detection.sourceType !== 'opportunity'
    || detection.sourceId !== input.opportunityId
  ) return false;

  return row.actors.some((actor) =>
    actor.userId === input.userId
    && (!input.networkId || actor.networkId === input.networkId));
}

function toPublicQuestion(row: PendingUptakeQuestionRow): PublicUptakeQuestion {
  const payload = row.payload ?? {};
  return {
    id: row.id,
    title: typeof payload.title === 'string' ? payload.title : 'Question',
    prompt: typeof payload.prompt === 'string' ? payload.prompt : '',
    options: Array.isArray(payload.options)
      ? payload.options.flatMap((option) => typeof option?.label === 'string'
        ? [{ label: option.label, description: typeof option.description === 'string' ? option.description : '' }]
        : [])
      : [],
    multiSelect: payload.multiSelect === true,
  };
}

export const uptakeAcceptanceGuard = new UptakeAcceptanceGuard();
