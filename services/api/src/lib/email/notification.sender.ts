import { eq } from 'drizzle-orm/sql';

import db from '../drizzle/drizzle';
import { userNotificationSettings, users } from '../../schemas/database.schema';
import { log } from '../log';

import { sendEmail } from './transport.producer';
import { connectionRequestTemplate } from './templates/connection-request.template';
import { connectionAcceptedTemplate } from './templates/connection-accepted.template';

const logger = log.lib.from('notification.sender');

const BASE_URL = process.env.BASE_URL || 'https://protocol.index.network';

function unsubscribeUrlForToken(token: string, type: 'weeklyNewsletter' | 'connectionUpdates') {
  return `${BASE_URL}/api/notifications/unsubscribe?token=${token}&type=${type}`;
}

async function getUnsubscribeUrl(userId: string, type: 'weeklyNewsletter' | 'connectionUpdates') {
  // Find or create settings (create should technically happen on user creation, but good to be safe)
  let settings = await db.select()
    .from(userNotificationSettings)
    .where(eq(userNotificationSettings.userId, userId))
    .limit(1);

  if (settings.length === 0) {
    // If no settings exist, strictly speaking we should create them, but for now let's assume existence or return null
    // Ideally we should insert if not exists to ensure token availability.
    const [newSettings] = await db.insert(userNotificationSettings)
      .values({ userId })
      .returning();
    settings = [newSettings];
  }

  return unsubscribeUrlForToken(settings[0].unsubscribeToken, type);
}

export async function sendConnectionRequestEmail(
  to: string,
  initiatorName: string,
  receiverName: string,
  synthesisHtml: string,
  subject: string
): Promise<void> {
  const userResult = await db.select({
    id: users.id,
    onboarding: users.onboarding,
    settings: userNotificationSettings
  })
    .from(users)
    .leftJoin(userNotificationSettings, eq(users.id, userNotificationSettings.userId))
    .where(eq(users.email, to))
    .limit(1);

  if (userResult.length === 0) return;

  const recipient = userResult[0];

  // 1. Check Onboarding
  if (!recipient.onboarding?.completedAt) {
    logger.info('Skipping connection email', { userId: recipient.id, reason: 'Onboarding not completed' });
    return;
  }

  // 2. Check Preferences
  // If settings exist and explicit false, skip. If no settings, default is true.
  if (recipient.settings?.preferences?.connectionUpdates === false) {
    logger.info('Skipping connection email', { userId: recipient.id, reason: 'User opted out' });
    return;
  }

  // If settings exist, use token. If not (but onboarded), lazy create via getUnsubscribeUrl logic
  const unsubscribeUrl: string | undefined = recipient.settings?.unsubscribeToken
    ? unsubscribeUrlForToken(recipient.settings.unsubscribeToken, 'connectionUpdates')
    : await getUnsubscribeUrl(recipient.id, 'connectionUpdates');

  const template = connectionRequestTemplate(initiatorName, receiverName, synthesisHtml, subject, unsubscribeUrl);

  await sendEmail({
    to,
    subject: template.subject,
    html: template.html,
    text: template.text,
    headers: unsubscribeUrl ? {
      'List-Unsubscribe': `<mailto:hello@index.network?subject=Unsubscribe>, <${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    } : undefined
  });
}

export async function sendConnectionAcceptedEmail(
  to: string | string[],
  initiatorName: string,
  accepterName: string,
  synthesisHtml: string
): Promise<void> {
  const recipients = Array.isArray(to) ? to : [to];

  for (const recipientEmail of recipients) {
    const userResult = await db.select({
      id: users.id,
      onboarding: users.onboarding,
      settings: userNotificationSettings
    })
      .from(users)
      .leftJoin(userNotificationSettings, eq(users.id, userNotificationSettings.userId))
      .where(eq(users.email, recipientEmail))
      .limit(1);

    if (userResult.length === 0) continue;

    const recipient = userResult[0];

    // 1. Check Onboarding
    if (!recipient.onboarding?.completedAt) {
      logger.info('Skipping connection accepted email', { userId: recipient.id, reason: 'Onboarding not completed' });
      continue;
    }

    // 2. Check Preferences
    if (recipient.settings?.preferences?.connectionUpdates === false) {
      logger.info('Skipping connection accepted email', { userId: recipient.id, reason: 'User opted out' });
      continue;
    }

    const unsubscribeUrl: string | undefined = recipient.settings?.unsubscribeToken
      ? unsubscribeUrlForToken(recipient.settings.unsubscribeToken, 'connectionUpdates')
      : await getUnsubscribeUrl(recipient.id, 'connectionUpdates');

    const template = connectionAcceptedTemplate(initiatorName, accepterName, synthesisHtml, unsubscribeUrl);
    await sendEmail({
      to: recipientEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
      headers: unsubscribeUrl ? {
        'List-Unsubscribe': `<mailto:hello@index.network?subject=Unsubscribe>, <${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      } : undefined
    });
  }
}

