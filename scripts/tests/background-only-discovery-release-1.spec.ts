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
  'services/api/src/controllers/debug.controller.ts',
  'packages/protocol/src/shared/agent/canonical-guidance.ts',
  'packages/protocol/src/chat/chat.prompt.ts',
  'packages/protocol/src/README.md',
  'docs/specs/api-reference.md',
  'packages/cli/cli-output-reference.html',
  'packages/protocol/src/opportunity/application/opportunity.graph.ts',
  'docs/design/protocol-package-audit.html',
];

const runtimeAndCurrentDocFiles = [
  'packages/protocol/src/opportunity/application/opportunity.graph.ts',
  'packages/protocol/src/chat/chat.prompt.ts',
  'docs/design/protocol-deep-dive.md',
  'docs/design/opportunity-status-lifecycle.md',
  'docs/domain/opportunities.md',
  'docs/domain/negotiation.md',
];

describe('Release 1 background-only opportunity inventory', () => {
  test('keeps direct discovery out of public runtime composition while retaining the Release 1 schema', () => {
    const publicRuntimeSources = publicRuntimeFiles.map((file) => readFileSync(resolve(root, file), 'utf8')).join('\n');
    const runtimeAndCurrentDocs = runtimeAndCurrentDocFiles.map((file) => readFileSync(resolve(root, file), 'utf8')).join('\n');
    const chatPrompt = readFileSync(resolve(root, 'packages/protocol/src/chat/chat.prompt.ts'), 'utf8');
    const schemaSources = readFileSync(resolve(root, 'services/api/src/schemas/database.schema.ts'), 'utf8');

    expect(publicRuntimeSources).not.toMatch(/discover_opportunities|get_discovery_run|cancel_discovery_run|discoveryRunQueue/);
    expect(runtimeAndCurrentDocs).not.toMatch(/opportunity_draft_ready|OpportunityTrigger|trigger:\s*['"]orchestrator['"]/);
    expect(chatPrompt).not.toMatch(/only discover and surface matches during the active conversation/);
    expect(chatPrompt).not.toMatch(/I can(?: now)? (?:look for|help you find) relevant people(?: when you ask)?/);
    expect(schemaSources).toContain('opportunityDiscoveryRuns');
  });
});
