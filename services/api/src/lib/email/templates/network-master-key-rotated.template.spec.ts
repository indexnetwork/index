import { describe, expect, test } from 'bun:test';

import { networkMasterKeyRotatedTemplate } from './network-master-key-rotated.template';

describe('networkMasterKeyRotatedTemplate', () => {
  const baseParams = {
    networkName: 'Edge Esmeralda 2026',
    actorDisplay: 'Yanki Yuksel',
    newKey: 'ix-master-key-plaintext-example',
    integrationsUrl: 'https://index.network/networks/abc-123/integrations',
  };

  test('subject includes the network name', () => {
    const out = networkMasterKeyRotatedTemplate(baseParams);
    expect(out.subject).toBe('Master key rotated for Edge Esmeralda 2026');
  });

  test('html body contains the new key and the actor', () => {
    const out = networkMasterKeyRotatedTemplate(baseParams);
    expect(out.html).toContain('ix-master-key-plaintext-example');
    expect(out.html).toContain('Yanki Yuksel');
    expect(out.html).toContain('Edge Esmeralda 2026');
    expect(out.html).toContain('https://index.network/networks/abc-123/integrations');
  });

  test('text body contains the new key and the actor', () => {
    const out = networkMasterKeyRotatedTemplate(baseParams);
    expect(out.text).toContain('ix-master-key-plaintext-example');
    expect(out.text).toContain('Yanki Yuksel');
    expect(out.text).toContain('Edge Esmeralda 2026');
  });

  test('escapes html in network name', () => {
    const out = networkMasterKeyRotatedTemplate({
      ...baseParams,
      networkName: '<script>alert(1)</script>',
    });
    expect(out.html).not.toContain('<script>alert(1)</script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  test('strips control chars from the subject network name', () => {
    const out = networkMasterKeyRotatedTemplate({
      ...baseParams,
      networkName: 'Evil\r\nBcc: attacker@example.com',
    });
    expect(out.subject).not.toMatch(/[\r\n\t\f\v\0]/);
  });

  test('escapes html in newKey', () => {
    const out = networkMasterKeyRotatedTemplate({
      ...baseParams,
      newKey: '<script>alert(1)</script>',
    });
    expect(out.html).not.toContain('<script>alert(1)</script>');
    expect(out.html).toContain('&lt;script&gt;');
  });
});
