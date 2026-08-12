import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

export const PROTOCOL_ATLAS_FILES = Object.freeze([
  "index.html",
  "atlas.css",
  "atlas-content.js",
  "atlas-core.js",
  "atlas.js",
  "protocol.generated.js",
]);

type CopyFile = (source: string, destination: string) => void;

export interface PublishProtocolAtlasOptions {
  sourceDir: string;
  distDir: string;
  copyFile?: CopyFile;
}

export function publishProtocolAtlas({
  sourceDir,
  distDir,
  copyFile = copyFileSync,
}: PublishProtocolAtlasOptions): readonly string[] {
  for (const file of PROTOCOL_ATLAS_FILES) {
    const source = join(sourceDir, file);
    if (!existsSync(source)) throw new Error(`Missing Protocol Atlas file: ${file}`);
    if (!statSync(source).isFile()) {
      throw new Error(`Protocol Atlas source is not a file: ${file}`);
    }
  }

  mkdirSync(distDir, { recursive: true });
  const destination = join(distDir, "protocol-atlas");
  const staging = join(distDir, ".protocol-atlas-staging");
  const backup = join(distDir, ".protocol-atlas-backup");
  rmSync(staging, { recursive: true, force: true });
  rmSync(backup, { recursive: true, force: true });
  mkdirSync(staging);

  try {
    for (const file of PROTOCOL_ATLAS_FILES) {
      copyFile(join(sourceDir, file), join(staging, file));
    }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  const hadDestination = existsSync(destination);
  try {
    if (hadDestination) renameSync(destination, backup);
    renameSync(staging, destination);
    rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    if (hadDestination && existsSync(backup)) renameSync(backup, destination);
    rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  return PROTOCOL_ATLAS_FILES;
}

if (import.meta.main) {
  const files = publishProtocolAtlas({
    sourceDir: resolve(import.meta.dir, "../../docs/protocol-atlas"),
    distDir: resolve(import.meta.dir, "dist"),
  });
  console.log(`Published Protocol Atlas (${files.length} files).`);
}
