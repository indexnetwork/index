import { createHash, randomBytes } from "node:crypto";
import { link, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

import { ViewerSafeError, type ViewerSourceSummary } from "./viewer.types.js";

/** Exact input metadata and parsed JSON used by viewer adapters. */
export interface ViewerJsonArtifact {
  value: unknown;
  source: ViewerSourceSummary;
}

/** Controls atomic viewer publication. */
export interface PublishViewerHtmlOptions {
  /** Replace an existing destination with an atomic rename. */
  force?: boolean;
}

/** Sanitized read failure that may retain only exact-byte digest provenance. */
export class ViewerArtifactReadError extends ViewerSafeError {
  readonly source?: ViewerSourceSummary;

  /**
   * Creates a sanitized artifact read failure.
   *
   * @param message - Fixed public-safe guidance.
   * @param source - Optional digest-only provenance when bytes were read.
   */
  constructor(message: string, source?: ViewerSourceSummary) {
    super("malformed-input", message);
    this.name = "ViewerArtifactReadError";
    if (source) this.source = source;
  }
}

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const MAX_TEMP_ATTEMPTS = 10;

async function canonicalPath(filePath: string): Promise<string> {
  const resolved = path.resolve(filePath);
  try {
    return await realpath(resolved);
  } catch {
    const missingSegments: string[] = [path.basename(resolved)];
    let ancestor = path.dirname(resolved);
    while (true) {
      try {
        return path.join(await realpath(ancestor), ...missingSegments);
      } catch {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) return resolved;
        missingSegments.unshift(path.basename(ancestor));
        ancestor = parent;
      }
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

/**
 * Rejects input/output aliases after resolving symlinks and existing ancestors.
 * This closes the gap left by lexical `path.resolve` checks when a force output
 * reaches an input through a symlinked directory.
 *
 * @param inputPaths - Every artifact path the viewer may read.
 * @param outputPath - HTML destination the viewer may publish.
 * @returns The canonical destination path retained for publication.
 */
export async function assertViewerPathSeparation(
  inputPaths: readonly string[],
  outputPath: string,
): Promise<string> {
  const output = await canonicalPath(outputPath);
  for (const inputPath of inputPaths) {
    if (await canonicalPath(inputPath) === output) {
      throw new Error(`Output path would overwrite an input artifact: ${path.resolve(outputPath)}; refusing to run`);
    }
  }
  return output;
}

/**
 * Reads one JSON artifact without normalizing or rewriting its source bytes.
 *
 * The digest and byte length describe the exact bytes read from disk. Text is
 * decoded with fatal UTF-8 semantics before JSON parsing.
 *
 * @param filePath - Artifact path to read.
 * @returns Parsed JSON plus privacy-safe exact-byte provenance.
 * @throws ViewerSafeError when the file is unreadable, invalid UTF-8, or invalid JSON.
 */
export async function readViewerJsonArtifact(filePath: string): Promise<ViewerJsonArtifact> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path.resolve(filePath));
  } catch {
    throw new ViewerArtifactReadError(
      "The artifact could not be read as a local JSON file.",
    );
  }

  const source: ViewerSourceSummary = {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.byteLength,
  };

  let text: string;
  try {
    text = UTF8_DECODER.decode(bytes);
  } catch {
    throw new ViewerArtifactReadError(
      "The artifact is not valid UTF-8 JSON.",
      source,
    );
  }

  try {
    return { value: JSON.parse(text) as unknown, source };
  } catch {
    throw new ViewerArtifactReadError(
      "The artifact is not valid JSON.",
      source,
    );
  }
}

async function createExclusiveTempFile(destination: string, html: string): Promise<string> {
  const directory = path.dirname(destination);
  const basename = path.basename(destination);

  for (let attempt = 0; attempt < MAX_TEMP_ATTEMPTS; attempt += 1) {
    const temporaryPath = path.join(
      directory,
      `.${basename}.${process.pid}.${randomBytes(12).toString("hex")}.tmp`,
    );
    try {
      await writeFile(temporaryPath, html, { encoding: "utf8", flag: "wx" });
      return temporaryPath;
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") continue;
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  throw new Error("Unable to reserve a temporary viewer output file");
}

/**
 * Publishes self-contained viewer HTML through a same-directory temporary file.
 *
 * Without `force`, a hard link creates the destination atomically and refuses
 * to clobber a destination created after preflight. With `force`, rename
 * atomically replaces the destination. The temporary path is cleaned after
 * every successful or failed publication attempt.
 *
 * @param filePath - Destination HTML path.
 * @param html - Complete self-contained HTML document.
 * @param options - Overwrite policy.
 */
export async function publishViewerHtml(
  filePath: string,
  html: string,
  options: PublishViewerHtmlOptions = {},
): Promise<void> {
  const destination = path.resolve(filePath);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporaryPath = await createExclusiveTempFile(destination, html);

  try {
    if (options.force) {
      await rename(temporaryPath, destination);
    } else {
      await link(temporaryPath, destination);
    }
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}
