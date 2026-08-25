import { describe, expect, it } from 'bun:test';
import path from 'node:path';

const apiRoot = path.resolve(import.meta.dir, '..');

function validateLangSmithEnvironment(overrides: Record<string, string>) {
  return Bun.spawnSync(['bun', './src/startup.env.ts'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/index_test',
      ...overrides,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
}

describe('LangSmith startup environment', () => {
  it('accepts the documented tracing settings', () => {
    const result = validateLangSmithEnvironment({
      LANGSMITH_API_KEY: 'lsv2_pt_test',
      LANGSMITH_TRACING: 'true',
      LANGSMITH_PROJECT: 'index-api-development',
      LANGCHAIN_CALLBACKS_BACKGROUND: 'true',
      LANGSMITH_ENDPOINT: 'https://api.smith.langchain.com',
      LANGSMITH_WORKSPACE_ID: 'workspace-id',
    });

    expect(result.exitCode).toBe(0);
  });

  it('rejects an invalid LANGSMITH_TRACING value', () => {
    const result = validateLangSmithEnvironment({ LANGSMITH_TRACING: 'enabled' });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(output).toContain('LANGSMITH_TRACING');
  });
});
