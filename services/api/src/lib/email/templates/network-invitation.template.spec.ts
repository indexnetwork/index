import { describe, expect, test } from 'bun:test';
import { networkInvitationTemplate } from './network-invitation.template';

describe('networkInvitationTemplate', () => {
  test('subject names the network', () => {
    const out = networkInvitationTemplate({
      networkName: 'Edge City',
      apiKey: 'sk_test_RAW_KEY',
      connectCommand: 'openclaw index connect --api-key sk_test_RAW_KEY',
    });
    expect(out.subject).toMatch(/Edge City/);
  });

  test('html and text bodies include the raw key and connect command', () => {
    const out = networkInvitationTemplate({
      networkName: 'Edge City',
      apiKey: 'sk_test_RAW_KEY',
      connectCommand: 'openclaw index connect --api-key sk_test_RAW_KEY',
    });
    expect(out.html).toContain('sk_test_RAW_KEY');
    expect(out.html).toContain('openclaw index connect');
    expect(out.text).toContain('sk_test_RAW_KEY');
    expect(out.text).toContain('openclaw index connect');
  });

  test('html-escapes the network name to prevent injection', () => {
    const out = networkInvitationTemplate({
      networkName: '<script>x</script>',
      apiKey: 'k',
      connectCommand: 'cmd',
    });
    expect(out.html).not.toContain('<script>x</script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  test('html-escapes the api key (defense in depth)', () => {
    const out = networkInvitationTemplate({
      networkName: 'N',
      apiKey: '<script>x</script>',
      connectCommand: 'cmd',
    });
    expect(out.html).not.toContain('<script>x</script>');
  });

  test('strips CR/LF from the subject to prevent header injection', () => {
    const out = networkInvitationTemplate({
      networkName: 'Evil\r\nBcc: leak@example.com\r\nSubject: pwned',
      apiKey: 'k',
      connectCommand: 'cmd',
    });
    expect(out.subject).not.toMatch(/[\r\n]/);
  });

  test('renders the original invitation when isResend is omitted', () => {
    const out = networkInvitationTemplate({
      networkName: 'Experiment X',
      apiKey: 'a-very-secret-key',
      connectCommand: 'openclaw connect --key=a-very-secret-key',
    });
    expect(out.subject).toBe('Your invitation to Experiment X');
    expect(out.text).toContain("You've been added to Experiment X");
    expect(out.text).not.toContain('previous key has been revoked');
    expect(out.html).not.toContain('previous key has been revoked');
  });

  test('renders the original invitation when isResend is false', () => {
    const out = networkInvitationTemplate({
      networkName: 'Experiment X',
      apiKey: 'a-very-secret-key',
      connectCommand: 'openclaw connect --key=a-very-secret-key',
      isResend: false,
    });
    expect(out.subject).toBe('Your invitation to Experiment X');
    expect(out.text).not.toContain('previous key has been revoked');
  });

  test('renders the refreshed variant when isResend is true', () => {
    const out = networkInvitationTemplate({
      networkName: 'Experiment X',
      apiKey: 'a-very-secret-key',
      connectCommand: 'openclaw connect --key=a-very-secret-key',
      isResend: true,
    });
    expect(out.subject).toBe('Your access key for Experiment X (refreshed)');
    expect(out.text.startsWith('Your previous key has been revoked. Use the key below going forward.')).toBe(true);
    expect(out.html).toContain('Your previous key has been revoked. Use the key below going forward.');
    expect(out.text).toContain('a-very-secret-key');
    expect(out.text).toContain('openclaw connect --key=a-very-secret-key');
  });

  test('strips control chars from refreshed subject just like the original', () => {
    const out = networkInvitationTemplate({
      networkName: 'Bad\r\nNetwork',
      apiKey: 'a-very-secret-key',
      connectCommand: 'openclaw connect --key=a-very-secret-key',
      isResend: true,
    });
    expect(out.subject).toBe('Your access key for Bad Network (refreshed)');
  });
});
