import { getRedisClient } from '../../adapters/cache.adapter';
import { appLink } from '../app-link';
import { readUserEventPage, userEventStream } from '../user-events';

/** A frame as read back from the owner's stream, fields optional on the wire. */
interface WatchedFrame {
  eventId?: string;
  type?: string;
  title?: string;
  body?: string;
  data?: {
    intentId?: string | null;
    opportunityId?: string | null;
    questionId?: string;
  };
}

export interface IntentWatchOutcome {
  /** How long the watch actually ran. */
  seconds: number;
  /** Distinct opportunities whose negotiation moved during the watch. */
  negotiating: number;
  /** Opportunities that became actionable for the owner during the watch. */
  opportunities: { opportunityId: string; headline: string; url: string }[];
  /** The agent stopped on a question only the owner can answer. */
  pendingQuestion: { questionId: string; question: string } | null;
}

const POLL_MS = 1000;
/** Near-simultaneous matches land together; after the first, wait one beat for its siblings. */
const SETTLE_MS = 3000;

/** Stream id of the owner's newest frame, so a watch reads only what follows it. */
export async function userEventTail(userId: string): Promise<string> {
  const last = await getRedisClient().xrevrange(userEventStream(userId), '+', '-', 'COUNT', 1);
  return last[0]?.[0] ?? '0-0';
}

/**
 * Follow one intent's discovery on the owner's event stream for a bounded
 * window, narrating each development through `step` in the trace UI's voice.
 * Returns early once the agent needs the owner: the first actionable
 * opportunity (plus a short settle window for siblings) or a pending question.
 * Polls rather than blocking, so the shared Redis connection stays usable.
 */
export async function watchIntentDiscovery(options: {
  userId: string;
  intentId: string;
  /** Tail of the stream from before the intent existed; only later frames are read. */
  sinceId: string;
  seconds: number;
  signal?: AbortSignal;
  step: (message: string) => Promise<void>;
}): Promise<IntentWatchOutcome> {
  const started = Date.now();
  let deadline = started + options.seconds * 1000;
  let cursor = options.sinceId;
  const negotiating = new Set<string>();
  const opportunities: IntentWatchOutcome['opportunities'] = [];
  let pendingQuestion: IntentWatchOutcome['pendingQuestion'] = null;

  while (Date.now() < deadline && !options.signal?.aborted && !pendingQuestion) {
    const page = await readUserEventPage(options.userId, cursor);
    for (const raw of page.events) {
      const frame = raw as WatchedFrame;
      if (typeof frame.eventId === 'string') cursor = frame.eventId;
      if (frame.data?.intentId !== options.intentId) continue;

      if (frame.type === 'negotiation.turn' || frame.type === 'negotiation.changed') {
        const { opportunityId } = frame.data;
        if (typeof opportunityId === 'string' && !negotiating.has(opportunityId)) {
          negotiating.add(opportunityId);
          await options.step(negotiating.size === 1
            ? 'Negotiating with a counterparty agent...'
            : `Negotiating with ${negotiating.size} counterparty agents...`);
        }
      } else if (frame.type === 'opportunity.new') {
        const { opportunityId } = frame.data;
        if (typeof opportunityId !== 'string' || opportunities.some((o) => o.opportunityId === opportunityId)) continue;
        const headline = frame.title?.trim() || 'New match';
        opportunities.push({ opportunityId, headline, url: appLink('o', opportunityId) });
        await options.step(`Opportunity ready: ${headline.split(' · ')[0]}`);
        deadline = Math.min(deadline, Date.now() + SETTLE_MS);
      } else if (frame.type === 'question.pending' && typeof frame.data.questionId === 'string') {
        pendingQuestion = { questionId: frame.data.questionId, question: frame.body ?? '' };
        await options.step('Your agent has a question for you...');
        break;
      }
    }
    if (pendingQuestion) break;
    if (page.next) continue;
    const wait = Math.min(POLL_MS, deadline - Date.now());
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }

  return {
    seconds: Math.round((Date.now() - started) / 1000),
    negotiating: negotiating.size,
    opportunities,
    pendingQuestion,
  };
}
