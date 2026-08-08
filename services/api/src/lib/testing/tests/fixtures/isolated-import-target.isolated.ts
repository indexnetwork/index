import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';

test('registered isolated import target executes in the harness process', () => {
  const marker = process.env.API_TEST_ISOLATED_MARKER;
  if (marker) writeFileSync(marker, `executed:${process.pid}`);
  expect(process.env.API_TEST_ISOLATED_CHILD).toBe('1');
});
