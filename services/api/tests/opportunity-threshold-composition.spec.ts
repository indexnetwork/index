import { describe, expect, it } from 'bun:test';
import path from 'node:path';

const root = path.resolve(import.meta.dir, '../../..');
const productionCompositions = [
  'services/api/src/queues/opportunity/discovery.shared.ts',
  'services/api/src/controllers/mcp.controller.ts',
  'services/api/src/services/tool.service.ts',
  'packages/protocol/src/internal/shared/agent/tool.factory.ts',
] as const;

describe('production opportunity threshold composition', () => {
  for (const relativePath of productionCompositions) {
    it(`${relativePath} does not inject eval/test thresholds`, async () => {
      const source = await Bun.file(path.join(root, relativePath)).text();
      expect(source).not.toContain('retrievalMinSimilarity:');
      expect(source).not.toContain('evaluatorMinScore:');
    });
  }
});
