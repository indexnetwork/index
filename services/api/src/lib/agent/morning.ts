import { createHash } from 'node:crypto';

const MORNING_START = 8 * 60;
const DEFAULT_CAP = 4;

export interface MorningOwner {
  id: string;
  timezone: string | null;
  lastMorningBriefAt: Date | null;
}

export interface MorningClaim {
  previous: Date | null;
}

/** @param userId - The owner. @returns A stable minute in the hour after local 08:00. */
export function morningOffsetMinutes(userId: string): number {
  return createHash('sha256').update(userId).digest().readUInt32BE(0) % 60;
}

/** @param timeZone - The stored zone, which may be missing or not an IANA name. @returns A zone Intl accepts. */
export function morningZone(timeZone: string | null): string {
  if (!timeZone) return 'UTC';
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function localParts(date: Date, timeZone: string): { year: number; month: number; day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: pick('year'), month: pick('month'), day: pick('day'), minutes: pick('hour') * 60 + pick('minute') };
}

/** @returns Whether `at` falls on the same local calendar day as `now`. */
export function briefedOnLocalDate(at: Date | null, now: Date, timeZone: string): boolean {
  if (!at) return false;
  const then = localParts(at, timeZone);
  const today = localParts(now, timeZone);
  return then.year === today.year && then.month === today.month && then.day === today.day;
}

/** @returns Whether this owner's minute has arrived and today has not run. */
export function morningDue(owner: MorningOwner, now: Date): boolean {
  const zone = morningZone(owner.timezone);
  if (briefedOnLocalDate(owner.lastMorningBriefAt, now, zone)) return false;
  return localParts(now, zone).minutes >= MORNING_START + morningOffsetMinutes(owner.id);
}

interface MorningBriefDeps {
  listHostedOwners: () => Promise<MorningOwner[]>;
  claim: (userId: string, now: Date, timeZone: string) => Promise<MorningClaim | null>;
  work: (owner: MorningOwner) => Promise<void>;
  onError?: (error: unknown) => void;
  cap?: number;
}

/**
 * Once a minute, start the hosted owners whose local morning minute has
 * arrived. A claim is the only thing that lets a pass run.
 */
export function createMorningBrief(deps: MorningBriefDeps): { tick: (now?: Date) => Promise<void> } {
  const cap = deps.cap ?? DEFAULT_CAP;
  let inFlight = 0;
  const running = new Set<string>();

  return {
    async tick(now = new Date()) {
      if (inFlight >= cap) return;
      const due = (await deps.listHostedOwners())
        .filter((owner) => !running.has(owner.id) && morningDue(owner, now))
        .sort((left, right) => morningOffsetMinutes(left.id) - morningOffsetMinutes(right.id));

      for (const owner of due) {
        if (inFlight >= cap) break;
        inFlight += 1;
        running.add(owner.id);
        const claim = await deps.claim(owner.id, now, morningZone(owner.timezone)).catch((error: unknown) => {
          deps.onError?.(error);
          return null;
        });
        if (!claim) {
          inFlight -= 1;
          running.delete(owner.id);
          continue;
        }
        void deps.work(owner).catch((error: unknown) => {
          deps.onError?.(error);
        }).finally(() => {
          inFlight -= 1;
          running.delete(owner.id);
        });
      }
    },
  };
}
