import { log } from "@/lib/logger";

const logger = log.lib.from("lazy-route-recovery");
const STORAGE_PREFIX = "index:lazy-route-recovery:v1";

export type ChunkLoadCategory =
  | "dynamic-import"
  | "chunk-load"
  | "module-script"
  | "asset-preload";

export interface ChunkLoadFailure {
  category: ChunkLoadCategory;
  failedChunkPath?: string;
}

export type ChunkRecoveryResult =
  | "reload_started"
  | "reload_already_attempted"
  | "reload_blocked_pending"
  | "storage_unavailable"
  | "reload_failed";

interface RecoveryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface RecoveryLogMeta extends Record<string, unknown> {
  buildIdentity: string;
  route: string;
  category: ChunkLoadCategory;
  recoveryResult: ChunkRecoveryResult | "route_loaded";
  failedChunkPath?: string;
}

export interface ChunkRecoveryRuntime {
  href: string;
  buildIdentity: string;
  storage: RecoveryStorage | null;
  reload: () => void;
  report?: (level: "info" | "error", message: string, meta: RecoveryLogMeta) => void;
}

interface PendingRecovery {
  buildIdentity: string;
  category: ChunkLoadCategory;
  failedChunkPath?: string;
  route: string;
}

function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

function extractAssetPath(message: string): string | undefined {
  const match = message.match(/(?:https?:\/\/[^\s"'<>]+)?\/assets\/[^\s"'<>)}\]]+/i);
  if (!match) return undefined;

  try {
    const pathname = new URL(match[0], "https://index.network").pathname;
    return pathname.startsWith("/assets/") ? pathname : undefined;
  } catch {
    return undefined;
  }
}

/** Classifies browser and bundler errors known to represent lazy asset failures. */
export function classifyChunkLoadError(error: unknown): ChunkLoadFailure | null {
  const name = getErrorName(error).toLowerCase();
  const message = getErrorMessage(error);
  const normalized = message.toLowerCase();
  let category: ChunkLoadCategory | null = null;

  if (name === "chunkloaderror" || /loading (?:css )?chunk [^\s]+ failed/.test(normalized)) {
    category = "chunk-load";
  } else if (normalized.includes("failed to fetch dynamically imported module")) {
    category = "dynamic-import";
  } else if (
    normalized.includes("error loading dynamically imported module") ||
    normalized.includes("importing a module script failed")
  ) {
    category = "module-script";
  } else if (normalized.includes("unable to preload css for ")) {
    category = "asset-preload";
  }

  return category
    ? { category, failedChunkPath: extractAssetPath(message) }
    : null;
}

/** Returns the hashed Vite entry filename used as this page's build identity. */
export function getBuildIdentity(doc: Document = document): string {
  const entry = Array.from(doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]'))
    .map((script) => script.src)
    .find((src) => {
      try {
        return new URL(src, doc.baseURI).pathname.startsWith("/assets/");
      } catch {
        return false;
      }
    });

  if (!entry) return "unknown";

  try {
    return new URL(entry, doc.baseURI).pathname.split("/").pop() || "unknown";
  } catch {
    return "unknown";
  }
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function attemptKey(runtime: ChunkRecoveryRuntime): string {
  return `${STORAGE_PREFIX}:attempt:${stableHash(`${runtime.buildIdentity}\u0000${runtime.href}`)}`;
}

function pendingKey(runtime: ChunkRecoveryRuntime): string {
  return `${STORAGE_PREFIX}:pending:${stableHash(runtime.href)}`;
}

function report(
  runtime: ChunkRecoveryRuntime,
  level: "info" | "error",
  message: string,
  meta: RecoveryLogMeta,
): void {
  if (runtime.report) {
    runtime.report(level, message, meta);
    return;
  }

  logger[level](message, meta);
}

function createBrowserRuntime(): ChunkRecoveryRuntime {
  const storage = (() => {
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  })();

  return {
    href: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    buildIdentity: getBuildIdentity(),
    storage,
    reload: () => window.location.reload(),
  };
}

/**
 * Attempts one automatic reload for a chunk failure without changing the URL.
 * A URL-level pending marker also prevents reload loops across build identities
 * until a route module loads successfully.
 */
export function recoverChunkLoadError(
  error: unknown,
  route: string,
  runtime: ChunkRecoveryRuntime = createBrowserRuntime(),
): ChunkRecoveryResult | null {
  const failure = classifyChunkLoadError(error);
  if (!failure) return null;

  let recoveryResult: ChunkRecoveryResult;
  const marker: PendingRecovery = {
    buildIdentity: runtime.buildIdentity,
    category: failure.category,
    failedChunkPath: failure.failedChunkPath,
    route,
  };

  if (!runtime.storage) {
    recoveryResult = "storage_unavailable";
  } else {
    try {
      if (runtime.storage.getItem(pendingKey(runtime))) {
        recoveryResult = "reload_blocked_pending";
      } else if (runtime.storage.getItem(attemptKey(runtime))) {
        recoveryResult = "reload_already_attempted";
      } else {
        runtime.storage.setItem(attemptKey(runtime), "1");
        runtime.storage.setItem(pendingKey(runtime), JSON.stringify(marker));
        recoveryResult = "reload_started";
      }
    } catch {
      recoveryResult = "storage_unavailable";
    }
  }

  const meta: RecoveryLogMeta = {
    buildIdentity: runtime.buildIdentity,
    route,
    category: failure.category,
    recoveryResult,
    failedChunkPath: failure.failedChunkPath,
  };
  report(runtime, "error", "Lazy route asset failed to load", meta);

  if (recoveryResult === "reload_started") {
    try {
      runtime.reload();
    } catch {
      recoveryResult = "reload_failed";
      report(runtime, "error", "Lazy route reload failed", {
        ...meta,
        recoveryResult,
      });
    }
  }

  return recoveryResult;
}

function reportSuccessfulRecovery(route: string, runtime: ChunkRecoveryRuntime): void {
  if (!runtime.storage) return;

  try {
    const key = pendingKey(runtime);
    const value = runtime.storage.getItem(key);
    if (!value) return;

    const marker = JSON.parse(value) as PendingRecovery;
    runtime.storage.removeItem(key);
    report(runtime, "info", "Lazy route asset recovered after reload", {
      buildIdentity: runtime.buildIdentity,
      route,
      category: marker.category,
      recoveryResult: "route_loaded",
      failedChunkPath: marker.failedChunkPath,
    });
  } catch {
    // Storage and malformed-marker failures must not prevent route rendering.
  }
}

/** Wraps a React Router lazy module import with bounded stale-chunk recovery. */
export function lazyRoute<T>(
  route: string,
  loader: () => Promise<T>,
  runtimeFactory: () => ChunkRecoveryRuntime = createBrowserRuntime,
): () => Promise<T> {
  return async () => {
    const runtime = runtimeFactory();
    try {
      const routeModule = await loader();
      reportSuccessfulRecovery(route, runtime);
      return routeModule;
    } catch (error) {
      recoverChunkLoadError(error, route, runtime);
      throw error;
    }
  };
}
