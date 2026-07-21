import { existsSync, readFileSync, readdirSync, type Dirent } from 'node:fs';
import path from 'node:path';

export interface IsolatedTestInventory {
  files: string[];
  manifestPath: string;
}

/**
 * Reads and validates the isolated-test manifest against the filesystem.
 *
 * @param apiRoot - Absolute path to the services/api package.
 * @returns The validated, sorted isolated test inventory.
 * @throws When entries are malformed, duplicated, missing, or unregistered.
 */
export function loadIsolatedTestInventory(apiRoot: string): IsolatedTestInventory {
  const manifestPath = path.join(apiRoot, '.test-isolated');
  const entries = readFileSync(manifestPath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  const malformed = entries.filter((entry) => !isValidManifestEntry(entry));
  const duplicates = entries.filter((entry, index) => entries.indexOf(entry) !== index);
  // The manifest is also the deliberate serial execution order. Keep it stable
  // while comparing exact sets against the sorted filesystem inventory.
  const manifestFiles = [...new Set(entries)];
  const filesystemFiles = discoverFiles(apiRoot, (file) => file.endsWith('.isolated.ts'));
  const missing = manifestFiles.filter((file) => !filesystemFiles.includes(file));
  const unregistered = filesystemFiles.filter((file) => !manifestFiles.includes(file));

  const problems: string[] = [];
  if (malformed.length > 0) problems.push(`Malformed entries: ${formatList(malformed)}`);
  if (duplicates.length > 0) problems.push(`Duplicate entries: ${formatList(duplicates)}`);
  if (missing.length > 0) problems.push(`Missing files: ${formatList(missing)}`);
  if (unregistered.length > 0) problems.push(`Unregistered files: ${formatList(unregistered)}`);

  if (problems.length > 0) {
    throw new Error(`[isolated-tests] Manifest validation failed. ${problems.join(' ')}`);
  }

  return { files: manifestFiles, manifestPath };
}

/**
 * Rejects process-global module mocks in Bun-discoverable test files.
 *
 * Isolated files are intentionally excluded because they execute in fresh Bun
 * subprocesses. This guard runs from the preload before discoverable specs load.
 *
 * @param apiRoot - Absolute path to the services/api package.
 * @throws When a discoverable spec invokes Bun's process-global module mock.
 */
export function assertNoDiscoverableModuleMocks(apiRoot: string): void {
  const discoverable = listDiscoverableTestFiles(apiRoot);
  const moduleMockPattern = new RegExp(`\\bmock\\s*\\.\\s*${'module'}\\s*\\(`);
  const contaminated: string[] = [];

  for (const file of discoverable) {
    const content = readFileSync(path.join(apiRoot, file), 'utf8');
    const match = moduleMockPattern.exec(content);
    if (!match) continue;
    const line = content.slice(0, match.index).split(/\r?\n/).length;
    contaminated.push(`${file}:${line}`);
  }

  if (contaminated.length > 0) {
    throw new Error(
      `[isolated-tests] Discoverable tests contain process-global module mocks: ${formatList(contaminated)}. Rename each file to *.isolated.ts and register it in .test-isolated.`,
    );
  }
}

/**
 * Lists every Bun-discoverable test path under the API package.
 *
 * @param apiRoot - Absolute path to services/api.
 * @returns Sorted package-relative spec and test paths.
 */
export function listDiscoverableTestFiles(apiRoot: string): string[] {
  return discoverFiles(
    apiRoot,
    (file) => file.endsWith('.spec.ts') || file.endsWith('.test.ts'),
  );
}

function discoverFiles(apiRoot: string, include: (file: string) => boolean): string[] {
  return ['src', 'tests']
    .flatMap((directory) => walk(apiRoot, directory, include))
    .sort();
}

function walk(
  apiRoot: string,
  relativeDirectory: string,
  include: (file: string) => boolean,
): string[] {
  const absoluteDirectory = path.join(apiRoot, relativeDirectory);
  if (!existsSync(absoluteDirectory)) return [];

  return readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry: Dirent) => {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return walk(apiRoot, relativePath, include);
    return entry.isFile() && include(relativePath) ? [relativePath] : [];
  });
}

function isValidManifestEntry(entry: string): boolean {
  if (path.isAbsolute(entry) || entry.includes('\\')) return false;
  if (!entry.endsWith('.isolated.ts')) return false;
  const normalized = path.posix.normalize(entry);
  if (normalized !== entry || normalized.startsWith('../')) return false;
  return entry.startsWith('src/') || entry.startsWith('tests/');
}

function formatList(values: readonly string[]): string {
  return values.join(', ');
}
