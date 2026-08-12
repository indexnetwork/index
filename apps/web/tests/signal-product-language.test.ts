import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { toSignalProductLanguage } from '@/lib/product-language';

const webRoot = process.cwd();

const copyChecks: Array<{
  file: string;
  expected: string[];
  legacy: string[];
}> = [
  {
    file: 'src/components/IntentList.tsx',
    expected: ['No signals yet'],
    legacy: ['No intents yet'],
  },
  {
    file: 'src/components/ChatContent.tsx',
    expected: ['Failed to archive signal', 'Selected signal', 'Clear signal scope'],
    legacy: ['Failed to archive intent', 'Selected intent', 'Clear intent scope'],
  },
  {
    file: 'src/components/SynthesisMarkdown.tsx',
    expected: ['Failed to load signal', 'Signal archived', 'Focus on this signal', 'Archive this signal'],
    legacy: ['Failed to load intent', 'Intent archived', 'Focus on this intent', 'Archive this intent'],
  },
  {
    file: 'src/app/i/[intentId]/page.tsx',
    expected: [
      'Archive this signal? It will stop matching.',
      'Failed to pause signal',
      'Failed to resume signal',
      'Failed to refine signal',
      'this signal has been fulfilled',
      'this signal has expired',
      'scoped to this signal',
      'Opportunities the network surfaced for this signal.',
    ],
    legacy: [
      'Archive this intent? It will stop matching.',
      'Failed to pause intent',
      'Failed to resume intent',
      'Failed to refine intent',
      'this intent has been fulfilled',
      'this intent has expired',
      'scoped to this intent',
      'People the network surfaced for this intent.',
    ],
  },
  {
    file: 'src/components/settings/SettingsTab.tsx',
    expected: ['keep every signal', 'your signals auto-assign', 'signals people can share'],
    legacy: ['keep every intent', 'your intents auto-assign', 'intents people can share'],
  },
  {
    file: 'src/components/NetworkOverviewPanel.tsx',
    expected: ['Failed to open signal chat', 'Your Signals', "haven't shared any signals"],
    legacy: ['Failed to open intent chat', 'My Intents', 'Your Intents', "haven't shared any intents"],
  },
  {
    file: 'src/components/chat/ToolCallsDisplay.tsx',
    expected: ['Signal graph', 'Verifying signals', 'Reconciling signals', 'Indexing signals'],
    legacy: ['Intent graph', 'Verifying intents', 'Reconciling intents', 'Indexing intents'],
  },
  {
    file: 'src/components/chat/IntentProposalCard.tsx',
    expected: ['Failed: Create signal', 'Proposed Signal'],
    legacy: ['Failed: Create intent', 'Proposed Intent'],
  },
  {
    file: 'src/components/IntentNegotiatorChat.tsx',
    expected: ['about this signal'],
    legacy: ['about this intent'],
  },
  {
    file: 'src/components/DiscoveryCard.tsx',
    expected: ['mutual signal'],
    legacy: ['mutual intent'],
  },
  {
    file: 'src/app/agents/page.tsx',
    expected: ["return 'Signals'"],
    legacy: ["return 'Intents'"],
  },
  {
    file: 'src/app/agents/[id]/page.tsx',
    expected: ['"manage:intents": "Signals"'],
    legacy: ['"manage:intents": "Intents"'],
  },
];

describe('interactive web product language', () => {
  test.each(copyChecks)('$file uses signal terminology in known presentation copy', ({ file, expected, legacy }) => {
    const source = readFileSync(`${webRoot}/${file}`, 'utf8');

    for (const copy of expected) expect(source).toContain(copy);
    for (const copy of legacy) expect(source).not.toContain(copy);
  });

  test('normalizes internal terminology only in trusted server-authored presentation fields', () => {
    expect(toSignalProductLanguage('3 mutual intents')).toBe('3 mutual signals');
    expect(toSignalProductLanguage('Intent matched; INTENTS indexed')).toBe('Signal matched; SIGNALS indexed');
    expect(toSignalProductLanguage('Browser AbortSignal')).toBe('Browser AbortSignal');
  });
});
