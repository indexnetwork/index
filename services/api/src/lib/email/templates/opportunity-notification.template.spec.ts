import { describe, expect, it } from 'bun:test';
import { opportunityNotificationTemplate } from './opportunity-notification.template';

describe('opportunityNotificationTemplate', () => {
  it('escapes recipientName and summary in html to prevent XSS', () => {
    const name = '<script>alert(1)</script>';
    const summary = 'Say "hello" & <world>';
    const { html } = opportunityNotificationTemplate(
      name,
      summary,
      'https://example.com/opp/1'
    );
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;hello&quot; &amp; &lt;world&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('"hello"');
  });

  it('leaves recipientName and summary unescaped in text', () => {
    const name = 'Alice';
    const summary = 'A great match for your intent.';
    const { text } = opportunityNotificationTemplate(
      name,
      summary,
      'https://example.com/opp/1'
    );
    expect(text).toContain('Hey Alice,');
    expect(text).toContain('Summary: A great match for your intent.');
  });

  it('replaces disallowed URL schemes with # in html and text', () => {
    const { html, text } = opportunityNotificationTemplate(
      'Bob',
      'Summary',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>'
    );
    expect(html).toContain('href="#"');
    expect(text).toContain('View opportunity: #');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text/html');
  });

  it('allows https, http, and mailto URLs', () => {
    const httpsUrl = 'https://index.network/opportunities/abc';
    const unsubUrl = 'https://api.example.com/unsubscribe?token=xyz';
    const { html, text } = opportunityNotificationTemplate(
      'User',
      'Summary',
      httpsUrl,
      unsubUrl
    );
    expect(html).toContain(httpsUrl);
    expect(html).toContain(unsubUrl);
    expect(text).toContain(`View opportunity: ${httpsUrl}`);
  });

  it('replaces invalid URL string with #', () => {
    const { html, text } = opportunityNotificationTemplate(
      'User',
      'Summary',
      'not a url',
      undefined
    );
    expect(html).toContain('href="#"');
    expect(text).toContain('View opportunity: #');
  });

  it('omits unsubscribe block when unsubscribeUrl is undefined', () => {
    const { html } = opportunityNotificationTemplate(
      'User',
      'Summary',
      'https://example.com/opp',
      undefined
    );
    expect(html).not.toContain('Unsubscribe from opportunity emails');
  });

  it('includes unsubscribe link when unsubscribeUrl is provided and valid', () => {
    const unsub = 'https://api.example.com/unsubscribe?token=t';
    const { html } = opportunityNotificationTemplate(
      'User',
      'Summary',
      'https://example.com/opp',
      unsub
    );
    expect(html).toContain('Unsubscribe from opportunity emails');
    expect(html).toContain(unsub.replace(/&/g, '&amp;'));
  });
});
