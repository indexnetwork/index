import { describe, expect, it } from 'bun:test';
import path from 'node:path';

const apiRoot = path.resolve(import.meta.dir, '..');

async function validateStartup(overrides: Record<string, string>) {
  const env = { ...process.env };
  delete env.DISCOVERY_MIN_SIMILARITY;
  delete env.DISCOVERY_EVALUATOR_MIN_SCORE;
  Object.assign(env, { NODE_ENV: 'test' }, overrides);
  const child = Bun.spawn({
    cmd: [process.execPath, '-e', "await import('./src/startup.env.ts')"],
    cwd: apiRoot,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr };
}

describe('discovery threshold startup validation', () => {
  it.each([
    ['DISCOVERY_MIN_SIMILARITY', ''],
    ['DISCOVERY_MIN_SIMILARITY', '0.42'],
    ['DISCOVERY_EVALUATOR_MIN_SCORE', '63.5'],
  ])('accepts %s=%s', async (name, value) => {
    expect((await validateStartup({ [name]: value })).exitCode).toBe(0);
  });

  it.each([
    ['DISCOVERY_MIN_SIMILARITY', '1.01'],
    ['DISCOVERY_MIN_SIMILARITY', '0x1'],
    ['DISCOVERY_EVALUATOR_MIN_SCORE', '101'],
    ['DISCOVERY_EVALUATOR_MIN_SCORE', 'NaN'],
  ])('rejects %s=%s', async (name, value) => {
    const result = await validateStartup({ [name]: value });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(name);
  });
});
