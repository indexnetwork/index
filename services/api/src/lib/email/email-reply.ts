import { getRedisClient } from '../../adapters/cache.adapter';
import { userDatabaseAdapter } from '../../adapters/database.adapter';
import { ConversationService } from '../../services/conversation.service';
import { escapeHtml } from '../escapeHtml';
import { log } from '../log';
import { MAX_TURN_TEXT, takePersonalTurn } from '../personal-agent/turn';

import { bareAddress, fetchReceivedEmail, isAutomatedReply, replyText, senderAuthenticated, type ReceivedEmail, type ReceivedEmailEvent } from './inbound-email';
import { readReplyAddress, replyAddress } from './reply-address';
import { agentReplyTemplate } from './templates';
import { executeSendEmail } from './transport.helper';

const logger = log.lib.from('email/email-reply');

const WEB_APP_URL = (process.env.WEB_APP_URL ?? 'https://index.network').replace(/\/+$/, '');
const TEAM_INBOX = 'hello@index.network';
const AGENT_FROM = 'Your agent <updates@agent.index.network>';
/** A received email is handled once, however often Resend delivers the event. */
const SEEN_TTL_SEC = 7 * 24 * 60 * 60;
/** Replies one owner can send their agent in an hour; past this they wait, so a mail loop can't run up model calls. */
const MAX_PER_HOUR = 20;

export type ReplyOutcome =
  | 'not_ours'
  | 'duplicate'
  | 'to_team'
  | 'automated'
  | 'empty'
  | 'rate_limited'
  | 'accepted';

/**
 * Replies to the personal agent's email. An owner who replies to their
 * morning email is talking to their agent: the reply goes into the personal
 * agent chat as their message, the agent acts on it with the same tools as
 * on Home, and its answer comes back by email in the same thread.
 *
 * A reply is taken only when its address is signed for the owner and not
 * expired, it comes from the owner's account email, and the receiving server
 * authenticated that sender. Anything else goes to the team inbox, as every
 * reply did before.
 */
export class EmailReplyService {
  constructor(private readonly conversations = new ConversationService()) {}

  /**
   * Check a received email and, when it's an owner's reply, start their agent's turn.
   * The checks run before this returns; the turn and the answer run after.
   *
   * @param event - The `email.received` webhook's metadata.
   * @returns What was done with it.
   * @throws When the email can't be read from Resend, so the webhook is retried.
   */
  async receive(event: ReceivedEmailEvent): Promise<ReplyOutcome> {
    const addressed = [...event.to, ...event.cc].map((address) => readReplyAddress(address));
    const mine = addressed.find((read) => read.ok) ?? addressed.find((read) => !read.ok && read.reason !== 'not_ours');
    if (!mine) return 'not_ours';

    const redis = getRedisClient();
    const seenKey = `email-reply:seen:${event.emailId}`;
    if ((await redis.set(seenKey, '1', 'EX', SEEN_TTL_SEC, 'NX')) !== 'OK') return 'duplicate';

    let email: ReceivedEmail;
    try {
      email = await fetchReceivedEmail(event.emailId);
    } catch (error) {
      await redis.del(seenKey);
      throw error;
    }

    if (!mine.ok) return this.toTeam(email, mine.reason === 'expired' ? 'reply address expired' : 'reply address not signed');

    const user = await userDatabaseAdapter.findById(mine.userId);
    if (!user || user.deletedAt) return this.toTeam(email, 'no such account');
    if (bareAddress(email.from || event.from) !== user.email.trim().toLowerCase()) return this.toTeam(email, 'sent from an address other than the account email');
    if (!senderAuthenticated(email)) return this.toTeam(email, 'sender not authenticated');
    if (isAutomatedReply({ headers: email.headers, subject: email.subject || event.subject })) return 'automated';

    const text = replyText(email).slice(0, MAX_TURN_TEXT).trim();
    if (!text) return 'empty';

    const hourKey = `email-reply:count:${user.id}:${Math.floor(Date.now() / 3_600_000)}`;
    const count = await redis.incr(hourKey);
    if (count === 1) await redis.expire(hourKey, 3600);
    if (count > MAX_PER_HOUR) {
      logger.warn('Email replies over the hourly limit', { userId: user.id, count });
      return 'rate_limited';
    }

    void this.answer({ id: user.id, name: user.name, email: user.email }, email, text).catch((error: unknown) => {
      logger.error('Email reply turn failed', { userId: user.id, emailId: email.id, error: error instanceof Error ? error.message : String(error) });
    });
    return 'accepted';
  }

  /** Run the owner's turn and email the agent's answer back in the same thread. */
  private async answer(owner: { id: string; name: string; email: string }, email: ReceivedEmail, text: string): Promise<void> {
    const turn = await takePersonalTurn(this.conversations, { userId: owner.id, userName: owner.name, text, source: 'email' });
    if (!turn.ok) logger.error('Personal agent turn from email failed', { userId: owner.id, error: turn.error });
    const said = turn.ok ? turn.text : "I couldn't finish that just now. Try again in a moment, or open our chat on Index.";

    const reply = agentReplyTemplate({ text: said, subject: email.subject, chatUrl: WEB_APP_URL });
    const references = [email.headers.references, email.messageId].filter(Boolean).join(' ').trim();
    await executeSendEmail({
      to: owner.email,
      from: AGENT_FROM,
      replyTo: replyAddress(owner.id) ?? undefined,
      kind: 'agent_reply',
      userId: owner.id,
      ...reply,
      headers: {
        ...(email.messageId ? { 'In-Reply-To': email.messageId } : {}),
        ...(references ? { References: references } : {}),
      },
    });
  }

  /** Pass a reply the agent won't take to the team inbox, where every reply went before. */
  private async toTeam(email: ReceivedEmail, reason: string): Promise<ReplyOutcome> {
    logger.info('Email reply passed to the team inbox', { emailId: email.id, reason });
    const body = email.text?.trim() || '(no text part)';
    // The email is already marked handled, so a failed forward is logged, not retried; Resend keeps the original.
    await executeSendEmail({
      to: TEAM_INBOX,
      subject: `Fwd: ${email.subject || '(no subject)'}`.replace(/[\r\n]+/g, ' '),
      text: [`Not handled by the agent: ${reason}.`, `From: ${email.from}`, `To: ${email.to.join(', ')}`, '', body].join('\n'),
      html: `<p>Not handled by the agent: ${escapeHtml(reason)}.<br />From: ${escapeHtml(email.from)}<br />To: ${escapeHtml(email.to.join(', '))}</p><pre style="white-space: pre-wrap;">${escapeHtml(body)}</pre>`,
      ...(email.from ? { replyTo: bareAddress(email.from) } : {}),
    }).catch((error: unknown) => {
      logger.error('Forwarding a reply to the team inbox failed', { emailId: email.id, error: error instanceof Error ? error.message : String(error) });
    });
    return 'to_team';
  }
}

export const emailReplyService = new EmailReplyService();
