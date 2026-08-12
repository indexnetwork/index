import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const scriptsRoot = new URL('./', import.meta.url).pathname;
const macRoot = new URL('../', import.meta.url).pathname;

test('assembled IndexApi facade initializes with every declared export', () => {
  const result = Bun.spawnSync(['python3', `${scriptsRoot}assemble.py`], { cwd: macRoot });
  expect(result.exitCode).toBe(0);

  const html = readFileSync(`${macRoot}Resources/index.html`, 'utf8');
  const match = html.match(/<script>\s*(\(function\(\)\{[\s\S]*?window\.IndexApi = \{[\s\S]*?\}\;\s*\}\)\(\);)\s*<\/script>/);
  expect(match).not.toBeNull();

  const window = {};
  expect(() => Function('window', match[1])(window)).not.toThrow();
  expect(window.IndexApi.createNativeAPIRequestBridge).toBeFunction();
  expect(window.IndexApi.createIndexApiClient).toBeFunction();
});
