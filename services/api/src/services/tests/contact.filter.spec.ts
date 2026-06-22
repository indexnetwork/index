import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it } from 'bun:test';
import { isHumanContact } from '../contact.service';

describe('isHumanContact', () => {
  describe('returns true for human contacts', () => {
    it('regular person email', () => {
      expect(isHumanContact('jane.doe@company.com', 'Jane Doe')).toBe(true);
    });

    it('person with no name', () => {
      expect(isHumanContact('jane.doe@company.com', '')).toBe(true);
    });

    it('person at personal domain', () => {
      expect(isHumanContact('me@janedoe.com', 'Jane Doe')).toBe(true);
    });
  });

  describe('filters non-human email prefixes', () => {
    it('noreply', () => {
      expect(isHumanContact('noreply@company.com', '')).toBe(false);
    });

    it('no-reply', () => {
      expect(isHumanContact('no-reply@company.com', '')).toBe(false);
    });

    it('support', () => {
      expect(isHumanContact('support@company.com', '')).toBe(false);
    });

    it('notifications', () => {
      expect(isHumanContact('notifications@company.com', '')).toBe(false);
    });

    it('billing', () => {
      expect(isHumanContact('billing@company.com', '')).toBe(false);
    });

    it('mailer-daemon', () => {
      expect(isHumanContact('mailer-daemon@company.com', '')).toBe(false);
    });

    it('newsletter', () => {
      expect(isHumanContact('newsletter@company.com', '')).toBe(false);
    });
  });

  describe('filters non-human domain patterns', () => {
    it('calendar-notification.google.com', () => {
      expect(isHumanContact('user@calendar-notification.google.com', 'Calendar')).toBe(false);
    });

    it('accounts.google.com', () => {
      expect(isHumanContact('user@accounts.google.com', '')).toBe(false);
    });

    it('notifications subdomain', () => {
      expect(isHumanContact('user@notifications.github.com', '')).toBe(false);
    });
  });

  describe('filters non-human name patterns', () => {
    it('name ending with "team"', () => {
      expect(isHumanContact('hello@slack.com', 'The Slack Team')).toBe(false);
    });

    it('name ending with "support"', () => {
      expect(isHumanContact('hello@zendesk.com', 'Zendesk Support')).toBe(false);
    });

    it('name ending with "notifications"', () => {
      expect(isHumanContact('hello@github.com', 'GitHub Notifications')).toBe(false);
    });
  });
});
