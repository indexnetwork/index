import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

test('describes reach as networks in scope', () => {
  const html = readFileSync(join(process.cwd(), 'public/trace-pitch.html'), 'utf8');

  expect(html).toContain('128 networks in scope');
  expect(html).not.toContain('128 indexes in scope');
});
