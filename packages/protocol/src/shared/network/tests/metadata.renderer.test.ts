import { describe, it, expect } from 'bun:test';
import { renderNetworkContext } from '../metadata.renderer.js';

describe('renderNetworkContext', () => {
  describe('community type', () => {
    it('renders title and prompt', () => {
      const result = renderNetworkContext({
        type: 'community',
        title: 'AI Builders',
        prompt: 'A community for AI practitioners to share knowledge.',
        metadata: {},
      });
      expect(result).toContain('## AI Builders');
      expect(result).toContain('A community for AI practitioners');
      expect(result).not.toContain('**Dates:**');
    });

    it('renders title only when prompt is absent', () => {
      const result = renderNetworkContext({
        type: 'community',
        title: 'No Prompt Community',
        metadata: {},
      });
      expect(result).toContain('## No Prompt Community');
      expect(result).not.toContain('undefined');
      expect(result).not.toContain('null');
    });
  });

  describe('event type', () => {
    const baseEvent = {
      type: 'event' as const,
      title: 'Edge Esmeralda 2026',
      prompt: 'A month-long popup village.',
      metadata: {
        startDate: '2026-05-30T00:00:00Z',
        endDate: '2026-06-27T23:59:59Z',
        timezone: 'America/Los_Angeles',
        location: 'Healdsburg, California',
        themes: ['AI', 'Governance', 'Health & Longevity'],
        events: [],
      },
    };

    it('renders all metadata fields', () => {
      const result = renderNetworkContext(baseEvent);
      expect(result).toContain('## Edge Esmeralda 2026');
      expect(result).toContain('A month-long popup village.');
      expect(result).toContain('**Type:** Event');
      expect(result).toContain('May 30');
      expect(result).toContain('June 27');
      expect(result).toContain('Healdsburg, California');
      expect(result).toContain('America/Los_Angeles');
      expect(result).toContain('AI');
      expect(result).toContain('Governance');
    });

    it('omits missing optional fields gracefully', () => {
      const result = renderNetworkContext({
        type: 'event',
        title: 'Minimal Event',
        metadata: {
          startDate: '2026-06-01T00:00:00Z',
          endDate: '2026-06-15T23:59:59Z',
          events: [],
        },
      });
      expect(result).toContain('## Minimal Event');
      expect(result).not.toContain('**Location:**');
      expect(result).not.toContain('**Timezone:**');
      expect(result).not.toContain('**Themes:**');
      expect(result).not.toContain('undefined');
    });

    it('renders "No upcoming events" when events array is empty', () => {
      const result = renderNetworkContext(baseEvent);
      expect(result).toContain('No upcoming events');
    });

    it('renders upcoming events table for events within 7 days of now', () => {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const nextWeekPlus = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);

      const result = renderNetworkContext({
        ...baseEvent,
        metadata: {
          ...baseEvent.metadata,
          startDate: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
          endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          events: [
            {
              externalId: 'e1',
              title: 'Tomorrow Talk',
              startTime: tomorrow.toISOString(),
              endTime: new Date(tomorrow.getTime() + 60 * 60 * 1000).toISOString(),
              location: 'Main Hall',
            },
            {
              externalId: 'e2',
              title: 'Far Future Talk',
              startTime: nextWeekPlus.toISOString(),
              endTime: new Date(nextWeekPlus.getTime() + 60 * 60 * 1000).toISOString(),
            },
          ],
        },
      });
      expect(result).toContain('Tomorrow Talk');
      expect(result).toContain('Main Hall');
      expect(result).not.toContain('Far Future Talk');
    });
  });

  describe('unknown type fallback', () => {
    it('renders title and prompt for unknown types', () => {
      const result = renderNetworkContext({
        type: 'project' as string,
        title: 'Unknown Type',
        prompt: 'Some prompt.',
        metadata: {},
      });
      expect(result).toContain('## Unknown Type');
      expect(result).toContain('Some prompt.');
    });
  });
});
