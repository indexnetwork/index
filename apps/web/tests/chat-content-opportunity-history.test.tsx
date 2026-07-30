import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const contextSource = readFileSync(resolve(root, 'src/contexts/AIChatContext.tsx'), 'utf8');
const contentSource = readFileSync(resolve(root, 'src/components/ChatContent.tsx'), 'utf8');

describe('historical opportunity-card compatibility', () => {
  test('keeps stored opportunity-card deserialization and rendering without a new discovery producer', () => {
    // Old assistant messages retain both legacy discoveries and persisted draft-card metadata.
    expect(contextSource).toContain('discoveries?: DiscoveryOpportunity[]');
    expect(contextSource).toContain('streamingDrafts?: StreamingDraft[]');
    expect(contentSource).toContain('msg.discoveries');
    expect(contentSource).toContain('<InlineDiscoveryCard');
    expect(contentSource).toContain('msg.streamingDrafts');
    expect(contentSource).toContain('<OpportunityCard');

    // New client turns no longer consume the retired direct-draft event or persist it.
    expect(contextSource).not.toContain('case "opportunity_draft_ready"');
    expect(contextSource).not.toContain('streamingDraftsBuffer');
    expect(contextSource).not.toContain('discover_opportunities');
  });
});
