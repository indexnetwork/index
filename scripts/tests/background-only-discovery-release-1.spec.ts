import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../..');
const publicRuntimeFiles = [
  'packages/protocol/src/opportunity/application/opportunity.tools.ts',
  'packages/protocol/src/runtime/foreground/composition/tool.factory.ts',
  'packages/protocol/src/mcp/mcp.authorization-policy.ts',
  'services/api/src/controllers/mcp.controller.ts',
  'services/api/src/controllers/opportunity.controller.ts',
  'services/api/src/main.ts',
];

describe('Release 1 background-only opportunity inventory', () => {
  test('keeps direct discovery out of public runtime composition while retaining the Release 1 schema', () => {
    const publicRuntimeSources = publicRuntimeFiles.map((file) => readFileSync(resolve(root, file), 'utf8')).join('\n');
    const schemaSources = readFileSync(resolve(root, 'services/api/src/schemas/database.schema.ts'), 'utf8');

    expect(publicRuntimeSources).not.toMatch(/discover_opportunities|discoveryRunQueue/);
    expect(schemaSources).toContain('opportunityDiscoveryRuns');
  });
});
