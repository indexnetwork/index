import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { NotificationSender } from '../notification.sender';

const recipient = {
  id: 'test-user-id',
  onboarding: { completedAt: new Date() },
  settings: {
    preferences: { connectionUpdates: true },
    unsubscribeToken: 'token',
  },
};

function makeDatabase() {
  return {
    select: mock(() => ({
      from: mock(() => ({
        leftJoin: mock(() => ({
          where: mock(() => ({
            limit: mock(async () => [recipient]),
          })),
        })),
      })),
    })),
    insert: mock(() => ({
      values: mock(() => ({
        returning: mock(async () => [{ unsubscribeToken: 'token' }]),
      })),
    })),
  };
}

const sendEmail = mock(async () => undefined);
const requestTemplate = mock(() => ({
  subject: 'Request Subject',
  html: '<p>Request HTML</p>',
  text: 'Request Text',
}));
const acceptedTemplate = mock(() => ({
  subject: 'Accepted Subject',
  html: '<p>Accepted HTML</p>',
  text: 'Accepted Text',
}));

function makeSender() {
  return new NotificationSender({
    database: makeDatabase() as never,
    sendEmail,
    requestTemplate,
    acceptedTemplate,
  });
}

describe('Email Handlers', () => {
  beforeEach(() => {
    sendEmail.mockClear();
    requestTemplate.mockClear();
    acceptedTemplate.mockClear();
  });

  it('sends a connection-request email with the rendered template', async () => {
    const sender = makeSender();
    const to = 'test@example.com';
    const initiatorName = 'Alice';
    const receiverName = 'Bob';
    const synthesisHtml = '<p>Synthesis</p>';
    const subject = 'Connection Request';

    await sender.sendConnectionRequestEmail(to, initiatorName, receiverName, synthesisHtml, subject);

    const unsubscribeUrl = `${process.env.API_URL || 'https://protocol.index.network'}/api/notifications/unsubscribe?token=token&type=connectionUpdates`;
    expect(requestTemplate).toHaveBeenCalledWith(
      initiatorName,
      receiverName,
      synthesisHtml,
      subject,
      unsubscribeUrl,
    );
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to,
      subject: 'Request Subject',
      html: '<p>Request HTML</p>',
      text: 'Request Text',
    }));
  });

  it('sends one connection-accepted email per recipient', async () => {
    const sender = makeSender();
    const to = ['alice@example.com', 'bob@example.com'];
    const initiatorName = 'Alice';
    const accepterName = 'Bob';
    const synthesisHtml = '<p>Intro</p>';

    await sender.sendConnectionAcceptedEmail(to, initiatorName, accepterName, synthesisHtml);

    const unsubscribeUrl = `${process.env.API_URL || 'https://protocol.index.network'}/api/notifications/unsubscribe?token=token&type=connectionUpdates`;
    expect(acceptedTemplate).toHaveBeenCalledWith(
      initiatorName,
      accepterName,
      synthesisHtml,
      unsubscribeUrl,
    );
    expect(sendEmail).toHaveBeenCalledTimes(2);
    for (const email of to) {
      expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
        to: email,
        subject: 'Accepted Subject',
        html: '<p>Accepted HTML</p>',
        text: 'Accepted Text',
      }));
    }
  });
});
