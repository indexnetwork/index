import { join } from 'node:path';
import { loadFixtureDir } from '../src/fixtures.ts';

export const FIXTURE_DIR = join(import.meta.dir, '..', 'fixtures');

export function fixtures() {
  return loadFixtureDir(FIXTURE_DIR);
}
