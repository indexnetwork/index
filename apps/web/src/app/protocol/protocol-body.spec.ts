import { describe, expect, it } from 'vitest';

import { protocolBodyHtml } from './protocol-body';

describe('protocolBodyHtml', () => {
  it('keeps protocol content and omits overview-only sections', () => {
    expect(protocolBodyHtml).toContain('Protocol overview');
    expect(protocolBodyHtml).toContain(
      'href="https://www.npmjs.com/package/@indexnetwork/cli"',
    );
    expect(protocolBodyHtml).toContain(
      'to work with intents, negotiations, and opportunities from a terminal.',
    );
    expect(protocolBodyHtml).not.toContain('<u>intents</u>');
    expect(protocolBodyHtml).toContain(
      'index intent create "Build a secure identity layer for autonomous agents"',
    );
    expect(protocolBodyHtml).not.toContain('federated learning collaboration');
    expect(protocolBodyHtml).not.toContain('index opportunity discover');
    expect(protocolBodyHtml).toContain('# agents negotiate relevant intents in the background');
    expect(protocolBodyHtml).toContain('# 4. review outcomes (opportunities) and decide');
    expect(protocolBodyHtml).toContain('index intent show &lt;intent-id&gt;');
    expect(protocolBodyHtml).toContain('index negotiation show &lt;negotiation-id&gt;');
    expect(protocolBodyHtml).toContain('index opportunity show &lt;opportunity-id&gt;');
    expect(protocolBodyHtml).toContain('Signal Details');
    expect(protocolBodyHtml).toContain('Network Assignments');
    expect(protocolBodyHtml).not.toContain('Index Assignments');
    expect(protocolBodyHtml).toContain('Negotiation Details');
    expect(protocolBodyHtml).toContain('Turn-by-Turn');
    expect(protocolBodyHtml).toContain('Presentation:');
    expect(protocolBodyHtml).not.toContain('Complex social flows');
    expect(protocolBodyHtml).not.toContain('index opportunity create');
    expect(protocolBodyHtml).toContain('mailto:founders@index.network');
    expect(protocolBodyHtml).not.toContain('mailto:seref@index.network');
    expect(protocolBodyHtml).toContain('where intents are indexed according to membership and access rules');
    expect(protocolBodyHtml).not.toContain('where negotiations run within and across networks');
    expect(protocolBodyHtml).not.toContain(
      'We left categories undefined; the intents sorted themselves.',
    );

    for (const heading of [
      'The problem',
      'Why now',
      'Index replaces the social discovery stack, from intent to opportunity',
      'Field results: The Edge City Agent Village',
      'Eight learnings from the village',
      "What's next",
      'Team',
      'Backers',
    ]) {
      expect(protocolBodyHtml).not.toContain(heading);
    }
  });
});
