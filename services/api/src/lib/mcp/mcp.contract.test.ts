import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import { MCP_INSTRUCTIONS } from './mcp.instructions';

const repo = join(import.meta.dir, '../../../../..');
const read = (path: string) => readFileSync(join(repo, path), 'utf8');

// Importing mcp.tools would load database-backed services, so registered names are read from its source.
const registered = new Set(
  [...read('services/api/src/lib/mcp/mcp.tools.ts').matchAll(/(?:registerTool\(\s*|registerOpportunityAction\()'([a-z_]+)'/g)]
    .map((match) => match[1]),
);

const docsCallout = read('apps/docs/src/pages/use/mcp.mdx').match(/:::prompt\n([\s\S]*?)\n:::/)?.[1] ?? '';

const surfaces = {
  instructions: MCP_INSTRUCTIONS,
  skill: read('packages/claude-plugin/skills/index-network/SKILL.md'),
  docs: docsCallout,
};

const TOOL_NAME = /\b(?:get|list|create|update|pause|resume|archive|enrich|accept|reject)_[a-z_]+\b/g;

describe('MCP guidance contract', () => {
  test('reads the registered tool surface', () => {
    expect(registered.has('create_intent')).toBe(true);
    expect(registered.has('accept_opportunity')).toBe(true);
    expect(registered.size).toBe(14);
  });

  for (const [surface, text] of Object.entries(surfaces)) {
    test(`${surface} names only registered tools`, () => {
      const named = [...new Set(text.match(TOOL_NAME) ?? [])];
      expect(named.length).toBeGreaterThan(0);
      expect(named.filter((name) => !registered.has(name))).toEqual([]);
    });

    test(`${surface} states the owner-approval and archive gates`, () => {
      expect(text).toContain('only after asking');
      expect(text).toContain('archive_intent');
      expect(text).toContain('confirm: true');
    });
  }
});
