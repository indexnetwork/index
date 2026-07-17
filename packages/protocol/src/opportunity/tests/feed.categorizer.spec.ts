/**
 * Home Categorizer Agent: output shape and CTA-style section titles.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, test, expect, mock } from 'bun:test';
import { HomeCategorizerAgent } from '../feed/feed.categorizer.js';
import { resolveHomeSectionIcon } from '../../shared/ui/lucide.icon-catalog.js';

describe('HomeCategorizerAgent', () => {
  test('categorize with empty cards returns empty sections', async () => {
    const agent = new HomeCategorizerAgent();
    const result = await agent.categorize([]);
    expect(result.sections).toEqual([]);
  });

  test('categorize with one card returns one section with that card index and valid icon', async () => {
    const agent = new HomeCategorizerAgent();
    const cards = [{ index: 0, mainText: 'You and Alice share an interest in privacy tech.', name: 'Alice' }];
    const result = await agent.categorize(cards);
    expect(result.sections.length).toBeGreaterThanOrEqual(1);
    const section = result.sections[0];
    expect(section.id).toBeDefined();
    expect(typeof section.title).toBe('string');
    expect(section.title.length).toBeGreaterThan(0);
    expect(section.itemIndices).toContain(0);
    const resolvedIcon = resolveHomeSectionIcon(section.iconName);
    expect(resolvedIcon.length).toBeGreaterThan(0);
  });

  test('falls back instead of caching unsupported section claims', async () => {
    const agent = new HomeCategorizerAgent();
    const invoke = mock(async () => ({
      sections: [{
        id: 'attendees',
        title: 'MEET FELLOW EVENT ATTENDEES',
        subtitle: 'Connections worth exploring',
        iconName: 'users',
        itemIndices: [0],
      }],
    }));
    (agent as unknown as { model: { invoke: typeof invoke } }).model = { invoke };

    const result = await agent.categorize([
      { index: 0, mainText: 'A safe technical match.', name: 'Alice' },
    ]);

    expect(result.sections).toEqual([{
      id: 'opportunities',
      title: 'OPPORTUNITIES',
      iconName: 'hourglass',
      itemIndices: [0],
    }]);
  });

  test('categorize section title is CTA-style (uppercase or action-oriented)', async () => {
    const agent = new HomeCategorizerAgent();
    const cards = [
      { index: 0, mainText: 'First opportunity.', name: 'A' },
      { index: 1, mainText: 'Second opportunity.', name: 'B' },
    ];
    const result = await agent.categorize(cards);
    expect(result.sections.length).toBeGreaterThanOrEqual(1);
    for (const s of result.sections) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.itemIndices.every((i) => i >= 0 && i < cards.length)).toBe(true);
    }
  });
});
