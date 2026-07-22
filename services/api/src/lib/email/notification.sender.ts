import { eq } from 'drizzle-orm/sql';

import db, { type DrizzleDB } from '../drizzle/drizzle';
import { userNotificationSettings, users } from '../../schemas/database.schema';
import { log } from '../log';

import { connectionRequestTemplate } from './templates/connection-request.template';
import { connectionAcceptedTemplate } from './templates/connection-accepted.template';

const logger = log.lib.from('notification.sender');

const API_URL = process.env.API_URL || 'https://protocol.index.network';

type NotificationSenderDatabase = Pick<DrizzleDB, 'select' | 'insert'>;
type SendEmail = typeof import('./transport.producer')['sendEmail'];
type ConnectionRequestTemplate = typeof connectionRequestTemplate;
type ConnectionAcceptedTemplate = typeof connectionAcceptedTemplate;

export interface NotificationSenderDeps {
  database?: NotificationSenderDatabase;
  sendEmail?: SendEmail;
  requestTemplate?: ConnectionRequestTemplate;
  acceptedTemplate?: ConnectionAcceptedTemplate;
}

const defaultSendEmail: SendEmail = async (options) => {
  const transport = await import('./transport.producer');
  return transport.sendEmail(options);
};

function unsubscribeUrlForToken(token: string, type: 'weeklyNewsletter' | 'connectionUpdates') {
  return `${API_URL}/api/notifications/unsubscribe?token=${token}&type=${type}`;
}

/** Sends preference-aware notification emails with injectable infrastructure. */
export class NotificationSender {
  private readonly database: NotificationSenderDatabase;
  private readonly sendEmail: SendEmail;
  private readonly requestTemplate: ConnectionRequestTemplate;
  private readonly acceptedTemplate: ConnectionAcceptedTemplate;

  constructor(deps: NotificationSenderDeps = {}) {
    this.database = deps.database ?? db;
    this.sendEmail = deps.sendEmail ?? defaultSendEmail;
    this.requestTemplate = deps.requestTemplate ?? connectionRequestTemplate;
    this.acceptedTemplate = deps.acceptedTemplate ?? connectionAcceptedTemplate;
  }

  /**
   * Sends a connection-request email when the recipient is eligible.
   */
  async sendConnectionRequestEmail(
    to: string,
    initiatorName: string,
    receiverName: string,
    synthesisHtml: string,
    subject: string,
  ): Promise<void> {
    const userResult = await this.database.select({
      id: users.id,
      onboarding: users.onboarding,
      settings: userNotificationSettings,
    })
      .from(users)
      .leftJoin(userNotificationSettings, eq(users.id, userNotificationSettings.userId))
      .where(eq(users.email, to))
      .limit(1);

    if (userResult.length === 0) return;

    const recipient = userResult[0];
    if (!recipient.onboarding?.completedAt) {
      logger.info('Skipping connection email', { userId: recipient.id, reason: 'Onboarding not completed' });
      return;
    }
    if (recipient.settings?.preferences?.connectionUpdates === false) {
      logger.info('Skipping connection email', { userId: recipient.id, reason: 'User opted out' });
      return;
    }

    const unsubscribeUrl: string | undefined = recipient.settings?.unsubscribeToken
      ? unsubscribeUrlForToken(recipient.settings.unsubscribeToken, 'connectionUpdates')
      : await this.getUnsubscribeUrl(recipient.id, 'connectionUpdates');
    const template = this.requestTemplate(
      initiatorName,
      receiverName,
      synthesisHtml,
      subject,
      unsubscribeUrl,
    );

    await this.sendEmail({
      to,
      subject: template.subject,
      html: template.html,
      text: template.text,
      headers: unsubscribeUrl ? {
        'List-Unsubscribe': `<mailto:hello@index.network?subject=Unsubscribe>, <${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      } : undefined,
    });
  }

  /**
   * Sends a connection-accepted email to each eligible recipient.
   */
  async sendConnectionAcceptedEmail(
    to: string | string[],
    initiatorName: string,
    accepterName: string,
    synthesisHtml: string,
  ): Promise<void> {
    const recipients = Array.isArray(to) ? to : [to];

    for (const recipientEmail of recipients) {
      const userResult = await this.database.select({
        id: users.id,
        onboarding: users.onboarding,
        settings: userNotificationSettings,
      })
        .from(users)
        .leftJoin(userNotificationSettings, eq(users.id, userNotificationSettings.userId))
        .where(eq(users.email, recipientEmail))
        .limit(1);

      if (userResult.length === 0) continue;

      const recipient = userResult[0];
      if (!recipient.onboarding?.completedAt) {
        logger.info('Skipping connection accepted email', {
          userId: recipient.id,
          reason: 'Onboarding not completed',
        });
        continue;
      }
      if (recipient.settings?.preferences?.connectionUpdates === false) {
        logger.info('Skipping connection accepted email', { userId: recipient.id, reason: 'User opted out' });
        continue;
      }

      const unsubscribeUrl: string | undefined = recipient.settings?.unsubscribeToken
        ? unsubscribeUrlForToken(recipient.settings.unsubscribeToken, 'connectionUpdates')
        : await this.getUnsubscribeUrl(recipient.id, 'connectionUpdates');
      const template = this.acceptedTemplate(initiatorName, accepterName, synthesisHtml, unsubscribeUrl);

      await this.sendEmail({
        to: recipientEmail,
        subject: template.subject,
        html: template.html,
        text: template.text,
        headers: unsubscribeUrl ? {
          'List-Unsubscribe': `<mailto:hello@index.network?subject=Unsubscribe>, <${unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        } : undefined,
      });
    }
  }

  private async getUnsubscribeUrl(
    userId: string,
    type: 'weeklyNewsletter' | 'connectionUpdates',
  ): Promise<string> {
    let settings = await this.database.select()
      .from(userNotificationSettings)
      .where(eq(userNotificationSettings.userId, userId))
      .limit(1);

    if (settings.length === 0) {
      const [newSettings] = await this.database.insert(userNotificationSettings)
        .values({ userId })
        .returning();
      settings = [newSettings];
    }

    return unsubscribeUrlForToken(settings[0].unsubscribeToken, type);
  }
}

const notificationSender = new NotificationSender();

export function sendConnectionRequestEmail(
  to: string,
  initiatorName: string,
  receiverName: string,
  synthesisHtml: string,
  subject: string,
): Promise<void> {
  return notificationSender.sendConnectionRequestEmail(
    to,
    initiatorName,
    receiverName,
    synthesisHtml,
    subject,
  );
}

export function sendConnectionAcceptedEmail(
  to: string | string[],
  initiatorName: string,
  accepterName: string,
  synthesisHtml: string,
): Promise<void> {
  return notificationSender.sendConnectionAcceptedEmail(to, initiatorName, accepterName, synthesisHtml);
}
