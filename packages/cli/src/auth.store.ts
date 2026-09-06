import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";

/** Shape of persisted CLI credentials. */
export interface Credentials {
  token: string;
  apiUrl: string;
  /** A device session from the device authorization grant, not an API key. */
  authKind: "session";
}

const CREDENTIALS_FILE = "credentials.json";

/**
 * Manages CLI authentication credentials on disk.
 *
 * Credentials are stored as JSON in a configurable directory
 * (defaults to `~/.index`).
 */
export class CredentialStore {
  private readonly dir: string;
  private readonly filePath: string;

  /**
   * @param dir - Directory to store credentials in. Defaults to `~/.index`.
   */
  constructor(dir?: string) {
    this.dir = dir ?? join(homedir(), ".index");
    this.filePath = join(this.dir, CREDENTIALS_FILE);
  }

  /**
   * Load stored credentials. Files holding an API key from before the device
   * grant are treated as signed out, so `index login` mints a session.
   *
   * @returns The stored credentials, or null if none exist.
   */
  async load(): Promise<Credentials | null> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<Credentials>;
      if (parsed.token && parsed.apiUrl && parsed.authKind === "session") {
        return parsed as Credentials;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Save credentials to disk, creating the directory if needed.
   *
   * @param credentials - The credentials to persist.
   */
  async save(credentials: Credentials): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(credentials, null, 2), {
      mode: 0o600,
    });
  }

  /**
   * Remove stored credentials.
   */
  async clear(): Promise<void> {
    try {
      await unlink(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}
