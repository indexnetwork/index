import { QuestionerAdapter, type AdapterPersistedQuestion } from '../../adapters/questioner.adapter';
import db from '../drizzle/drizzle';
import { log } from '../log';

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


/**
 * Advisory preflight for opportunity acceptance REST paths.
 *
 * Uses the QuestionerAdapter's canonical pending read, which rejects malformed,
 * legacy, and lifecycle-drifted negotiation provenance before an advisory can
 * block acceptance. Lookup failures fail open so a question-store outage cannot
 * block acceptance.
 */
export class UptakeAcceptanceGuard implements UptakeAcceptanceGuardLike {
  /** Check whether every currently pending uptake question was acknowledged. */
  async check(input: UptakeAcceptanceCheck): Promise<UptakeAcceptanceAdvisoryResult | null> {
    if (!isEnabled()) return null;

    try {
      const rows = await new QuestionerAdapter(db).findPending(input.userId, {
        mode: 'negotiation',
        purpose: 'uptake',
        sourceType: 'opportunity',
        sourceId: input.opportunityId,
        ...(input.networkId ? { networkId: input.networkId } : {}),
      });
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

function isExactMatch(row: AdapterPersistedQuestion, input: UptakeAcceptanceCheck): boolean {
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

function toPublicQuestion(row: AdapterPersistedQuestion): PublicUptakeQuestion {
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
