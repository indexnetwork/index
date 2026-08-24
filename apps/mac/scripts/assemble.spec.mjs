import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const scriptsRoot = new URL('./', import.meta.url).pathname;
const macRoot = new URL('../', import.meta.url).pathname;

test('assembled IndexApi facade initializes with every declared export', () => {
  const result = Bun.spawnSync(['python3', `${scriptsRoot}assemble.py`], { cwd: macRoot });
  expect(result.exitCode).toBe(0);

  const html = readFileSync(`${macRoot}Resources/index.html`, 'utf8');
  const match = html.match(/<script>\s*(\(function\(\)\{[\s\S]*?window\.IndexApi = \{[\s\S]*?};\s*}\)\(\);)\s*<\/script>/);
  expect(match).not.toBeNull();

  const window = {};
  expect(() => Function('window', match[1])(window)).not.toThrow();
  expect(window.IndexApi.createNativeAPIRequestBridge).toBeFunction();
  expect(window.IndexApi.createIndexApiClient).toBeFunction();
});

// streamChat is the single chokepoint every chat turn goes through, and its
// scope handling used to fail open: `if (scopeType && scopeId)` dropped BOTH
// fields when only one arrived, silently downgrading the turn to unscoped.
// This app has no unscoped chat surface (the API answers such an api-key
// turn with 403), so a half-supplied scope must fail at the caller instead.
test('streamChat rejects a half-supplied scope instead of silently dropping it', async () => {
  const result = Bun.spawnSync(['python3', `${scriptsRoot}assemble.py`], { cwd: macRoot });
  expect(result.exitCode).toBe(0);

  const html = readFileSync(`${macRoot}Resources/index.html`, 'utf8');
  const facade = html.match(/<script>\s*(\(function\(\)\{[\s\S]*?window\.IndexApi = \{[\s\S]*?};\s*}\)\(\);)\s*<\/script>/);
  const app = html.match(/window\.IndexApp = \(function \(\) \{[\s\S]*?\n\}\)\(\);/);
  expect(facade).not.toBeNull();
  expect(app).not.toBeNull();

  const window = { crypto: globalThis.crypto, INDEX_NATIVE: {}, addEventListener() {}, location: { href: '' } };
  Function('window', facade[1])(window);
  Function('window', app[0])(window);
  expect(window.IndexApp.streamChat).toBeFunction();

  for (const partial of [{ scopeType: 'intent' }, { scopeId: 'intent-1' }]) {
    await expect(window.IndexApp.streamChat({ message: 'hi', ...partial }))
      .rejects.toThrow(/scopeType and scopeId together/);
  }

  // A complete scope and no scope at all are both coherent: neither trips the
  // guard, so both get past it and fail later for want of a native bridge.
  for (const coherent of [{}, { scopeType: 'intent', scopeId: 'intent-1' }]) {
    await expect(window.IndexApp.streamChat({ message: 'hi', ...coherent }))
      .rejects.toThrow(/no native Index API bridge/);
  }
});
