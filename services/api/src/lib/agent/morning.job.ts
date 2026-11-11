import { randomUUID } from 'node:crypto';

import cron from 'node-cron';

import type { Intent } from '@indexnetwork/agent';

import { createRedisClient } from '../../adapters/cache.adapter';
import { chatDatabaseAdapter, conversationDatabaseAdapter } from '../../adapters/database.adapter';
import { QuestionGroupsDatabaseAdapter } from '../../adapters/question-groups.database.adapter';
import { ConversationService } from '../../services/conversation.service';
import { opportunityService } from '../../services/opportunity.service';
import { appLink } from '../app-link';
import { MAX_WAITING, morningBriefTemplate } from '../email/templates';
import { executeSendEmail } from '../email/transport.helper';
import { log } from '../log';
import { clipOpening, fallbackOpening, morningChatText, writeOpening, type Morning, type MorningGroup } from '../personal-agent/morning';
import { personalModel } from '../personal-agent/personal-agent';
import { PERSONAL_SCOPE } from '../personal-agent/personal-agent.instructions';
import { isOpen, shownCards } from '../personal-agent/question-groups';

import { describeFailure } from './failure-line';
import { HostedIndex } from './hosted.index';
import { createMorningBrief } from './morning';
import { claimMorningBrief, claimMorningEmails, listHostedOwners, networkedIntentIds, owedForEmail } from './morning.store';

const WEB_APP_URL = process.env.WEB_APP_URL ?? 'https://index.network';
/** Question groups in one morning; the rest wait for Home or the next morning. */
const MORNING_GROUPS = 3;
let emailing = false;
const conversations = new ConversationService();

/**
 * The question groups this morning carries: shown, still open, never emailed,
 * oldest shown first, each linked to Home.
 */
async function morningGroups(userId: string): Promise<MorningGroup[]> {
  const open = await QuestionGroupsDatabaseAdapter.listOpenQuestions(userId);
  const groups = (await QuestionGroupsDatabaseAdapter.listGroups(userId, open))
    .filter((group) => group.state === 'shown' && isOpen(group) && !group.emailedAt);
  return shownCards(groups, open).slice(0, MORNING_GROUPS)
    .map((card) => ({ id: card.groupId, question: card.question, url: appLink('q', card.id) }));
}

/**
 * Build an owner's morning: the personal agent's opening from what the intent
 * agents reported, then the people waiting and the question groups, which code
 * lists. The people shown carry the line their radar card shows, falling back
 * to their intent when the card cannot be presented.
 *
 * @returns The email and the morning it says, or null when there is nothing to send.
 */
export async function composeMorningEmail(userId: string, name: string, since: Date) {
  const owed = await owedForEmail(userId, since);
  const peerIds = owed.waiting.map((person) => person.userId);
  const [priors, chats, groups] = await Promise.all([
    chatDatabaseAdapter.findPriorOpportunities(userId, peerIds, owed.waiting.map((person) => person.opportunityId)),
    chatDatabaseAdapter.findPeerChats(userId, peerIds),
    morningGroups(userId),
  ]);
  const isConnected = (person: { userId: string }) => priors.get(person.userId)?.status === 'accepted';
  const connected = owed.waiting.filter(isConnected).map((person) => {
    const last = chats.get(person.userId)?.lastMessage;
    return { userId: person.userId, name: person.name, context: person.context, hasChat: chats.has(person.userId), noReply: !!last && last.fromUserId !== userId };
  });
  const waiting = await Promise.all(owed.waiting.filter((person) => !isConnected(person)).map(async (person, index) => {
    if (index >= MAX_WAITING) return person;
    const opportunity = await opportunityService.getStoredOpportunity(person.opportunityId);
    const card = opportunity && await opportunityService.presentOpportunityForViewer(opportunity, userId);
    return card?.headline ? { ...person, context: card.cta } : person;
  }));
  // Nothing new: no email, so no reason to ask the model for an opening.
  if (!groups.length && !waiting.some((person) => person.fresh)) return null;

  const labels = new Map((await new HostedIndex(userId).listIntents()).map((intent) => [intent.id, intent.statement]));
  const written = await writeOpening({
    name,
    reports: owed.notes.map((note) => ({ intent: labels.get(note.intentId) ?? 'an intent', text: note.text })),
    talked: owed.talked,
    waitingNames: waiting.map((person) => person.name),
    groupCount: groups.length,
  }, personalModel()).catch((error: unknown) => {
    log.agent.from('MorningBrief').warn('Morning opening failed; using the plain one', { userId, error: error instanceof Error ? error.message : String(error) });
    return null;
  });
  const opening = clipOpening(written) ?? fallbackOpening(owed.talked);
  const email = morningBriefTemplate({
    viewerId: userId, name, talked: owed.talked, opening, waiting, connected,
    questions: groups.map((group) => ({ text: group.question, url: group.url })), appUrl: WEB_APP_URL,
  });
  if (!email) return null;
  const morning: Morning = { name, opening, waiting: waiting.slice(0, MAX_WAITING), groups };
  return { email, morning };
}

/**
 * After the email went out: its groups are never emailed again, and the same
 * morning is kept in the personal agent's chat.
 */
async function recordMorning(userId: string, morning: Morning): Promise<void> {
  await QuestionGroupsDatabaseAdapter.markEmailed(morning.groups.map((group) => group.id), new Date());
  const dm = await conversationDatabaseAdapter.getOrCreateAgentDm(userId);
  await conversations.sendAgentMessage(dm.id, [{ kind: 'text', text: morningChatText(morning, WEB_APP_URL) }], {
    metadata: { scope: PERSONAL_SCOPE, morning: true },
  });
}

/**
 * Email each owner whose morning is due one, when their agent needs them.
 * Claiming stamps the morning, so an owner with nothing owed is not looked at
 * again until their next morning.
 */
async function sendMorningEmails(logger: ReturnType<typeof log.agent.from>): Promise<void> {
  if (process.env.EMAIL_PRODUCTION_MODE !== 'true') return;
  if (emailing) return;
  emailing = true;
  try {
    for (const claim of await claimMorningEmails(new Date())) {
      if (claim.off) continue;
      try {
        const composed = await composeMorningEmail(claim.id, claim.name, claim.since);
        if (!composed) continue;
        await executeSendEmail({ to: claim.email, from: 'Your agent <updates@agent.index.network>', kind: 'morning_brief', userId: claim.id, ...composed.email });
        await recordMorning(claim.id, composed.morning);
      } catch (error) {
        logger.error(describeFailure('Morning email failed', error), {
          userId: claim.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    emailing = false;
  }
}

const LOCK_KEY = 'hosted:morning:tick';
/** Long enough that a refresh can slip, short enough that a dead process gives the pass back. */
const LOCK_TTL_SEC = 120;
const RELEASE_LOCK = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
const REFRESH_LOCK = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("expire", KEYS[1], ARGV[2]) else return 0 end';

/**
 * One replica claims the minute. The gate stays held until that pass's work
 * finishes, so the others cannot each start their own cap.
 *
 * @returns A release, or null when another replica holds the pass.
 */
async function acquireMorningLock(): Promise<(() => Promise<void>) | null> {
  const redis = createRedisClient();
  const token = randomUUID();
  try {
    const acquired = await redis.set(LOCK_KEY, token, 'EX', LOCK_TTL_SEC, 'NX');
    if (acquired !== 'OK') {
      redis.disconnect();
      return null;
    }
  } catch (error) {
    redis.disconnect();
    throw error;
  }

  const refresh = setInterval(() => {
    void redis.eval(REFRESH_LOCK, 1, LOCK_KEY, token, String(LOCK_TTL_SEC)).catch(() => undefined);
  }, (LOCK_TTL_SEC * 1000) / 3);
  refresh.unref();

  return async () => {
    clearInterval(refresh);
    try {
      await redis.eval(RELEASE_LOCK, 1, LOCK_KEY, token);
    } finally {
      redis.disconnect();
    }
  };
}

/**
 * Start the minute tick that wakes hosted owners in the hour after their
 * local 08:00. Each owner keeps one stable minute. A morning that has already
 * passed waits until the next day, and only one process claims the day.
 *
 * @param options - Where one intent's morning runs, given the owner's previous morning.
 * @returns A stop handle for shutdown.
 */
export function startMorningBrief(options: {
  wake: (userId: string, intent: Intent, since: Date | null) => Promise<void>;
}): { stop: () => void } {
  const logger = log.agent.from('MorningBrief');
  const brief = createMorningBrief({
    listHostedOwners,
    claim: claimMorningBrief,
    lock: acquireMorningLock,
    onError: (error) => {
      logger.error(describeFailure('Morning pass failed', error), {
        error: error instanceof Error ? error.message : String(error),
      });
    },
    work: async (owner, claim) => {
      const networks = await networkedIntentIds(owner.id);
      const intents = (await new HostedIndex(owner.id).listIntents())
        .filter((item) => item.status === 'active' && networks.has(item.id));
      for (const item of intents) {
        try {
          await options.wake(owner.id, { id: item.id, statement: item.statement }, claim.previous);
        } catch (error) {
          logger.error(describeFailure('Morning intent failed', error), {
            userId: owner.id,
            intentId: item.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    },
  });
  const task = cron.schedule('* * * * *', () => {
    void brief.tick().catch((error: unknown) => {
      logger.error(describeFailure('Morning tick failed', error), {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    void sendMorningEmails(logger).catch((error: unknown) => {
      logger.error(describeFailure('Morning email pass failed', error), {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
  logger.info('Morning brief scheduled (every minute, 08:00–09:00 local)');
  return {
    stop() {
      task.stop();
    },
  };
}
