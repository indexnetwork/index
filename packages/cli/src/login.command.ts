import { randomBytes } from "node:crypto";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";

import { storeReplacementCredentials, type CredentialReplacementOptions } from "./auth.lifecycle";
import type { CredentialStore } from "./auth.store";

/** Result of the login callback flow. */
export interface LoginResult {
  success: boolean;
  error?: string;
  warning?: string;
}

/** Options for the login handler. */
export interface LoginOptions {
  /** AbortSignal to cancel the callback server. */
  signal?: AbortSignal;
  /** Timeout in milliseconds for the callback server. Defaults to 120_000 (2 min). */
  timeoutMs?: number;
  /** Override the callback server factory for tests. */
  serverFactory?: (handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) => CallbackServer;
  /** Host to bind the callback server to. Defaults to 127.0.0.1. */
  callbackHost?: string;
  /** Override the replacement-cleanup API client for tests. */
  credentialClientFactory?: CredentialReplacementOptions["clientFactory"];
}

interface CallbackServer {
  listen(port: number, host: string, callback: () => void): void;
  address(): ReturnType<Server["address"]>;
  close(callback: (err?: Error | null) => void): void;
  closeAllConnections(): void;
  on(event: "error", listener: (error: Error) => void): this;
  off(event: "error", listener: (error: Error) => void): this;
}

/** Return value from handleLogin — gives the caller the auth URL and a promise. */
export interface LoginHandle {
  /** The full OAuth URL to open in the browser. */
  authUrl: string;
  /** The port the callback server is listening on. */
  port: number;
  /** Resolves when the callback is received or the timeout fires. */
  callbackPromise: Promise<LoginResult>;
}

/**
 * Close an HTTP server, resolving once all connections are terminated.
 *
 * @param server - The HTTP server to close.
 */
function closeServer(server: CallbackServer): Promise<void> {
  return new Promise<void>((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    try {
      server.close(finish);
    } catch {
      finish();
    }
    try {
      // Force-close any lingering keep-alive connections.
      server.closeAllConnections();
    } catch {
      finish();
    }
  });
}

/**
 * Start the OAuth login flow.
 *
 * 1. Starts a local HTTP server on an ephemeral port.
 * 2. Constructs the OAuth URL pointing the callback to the local server.
 * 3. Returns the URL so the caller can open it in a browser.
 * 4. Waits for the callback (or timeout).
 * 5. Saves the received API key (or a legacy session token) to the credential store.
 *
 * @param apiUrl - The protocol server base URL.
 * @param appUrl - The frontend app URL (serves the /cli-auth page).
 * @param store - The credential store instance.
 * @param options - Optional signal and timeout configuration.
 * @returns A handle with the auth URL and a promise for the result.
 */
export async function handleLogin(
  apiUrl: string,
  appUrl: string,
  store: CredentialStore,
  options: LoginOptions = {},
): Promise<LoginHandle> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const baseUrl = apiUrl.replace(/\/$/, "");
  const baseAppUrl = appUrl.replace(/\/$/, "");
  const callbackHost = options.callbackHost ?? "127.0.0.1";
  // Capture before the callback can overwrite local credentials.
  const previousCredentials = await store.load();

  let resolveCallback: (result: LoginResult) => void;
  const callbackPromise = new Promise<LoginResult>((resolve) => {
    resolveCallback = resolve;
  });

  let expectedState: string | null = null;
  let stateConsumed = false;

  // Start local callback server on ephemeral port using node:http
  const server = (options.serverFactory ?? createServer)(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method !== "GET" || url.pathname !== "/callback") {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const callbackState = url.searchParams.get("state");
    if (!expectedState || callbackState !== expectedState) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end(callbackHtml("Authorization failed", "Invalid login state. Return to the terminal and try again."));
      return;
    }
    if (stateConsumed) {
      res.writeHead(409, { "Content-Type": "text/html" });
      res.end(callbackHtml("Authorization already completed", "This login callback has already been used."));
      return;
    }

    // Consume before the first await so concurrent/replayed callbacks cannot
    // both persist credentials from the same browser login.
    stateConsumed = true;

    const apiKey = url.searchParams.get("api_key");
    const keyId = url.searchParams.get("key_id");
    const sessionToken = url.searchParams.get("session_token");
    if (apiKey && keyId) {
      try {
        const cleanup = await storeReplacementCredentials(store, previousCredentials, {
          token: apiKey,
          apiUrl: baseUrl,
          authKind: "api_key",
          keyId,
        }, { clientFactory: options.credentialClientFactory });
        resolveCallback({ success: true, ...cleanup });
      } catch {
        resolveCallback({ success: false, error: "Failed to save CLI credentials." });
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(callbackHtml("Authorization failed", "CLI credentials could not be saved. Return to the terminal and try again."));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(callbackHtml("CLI authorized", "You can close this window and return to the terminal."));
      return;
    }
    if (!apiKey && sessionToken) {
      try {
        const cleanup = await storeReplacementCredentials(store, previousCredentials, {
          token: sessionToken,
          apiUrl: baseUrl,
          authKind: "session",
        }, { clientFactory: options.credentialClientFactory });
        resolveCallback({ success: true, ...cleanup });
      } catch {
        resolveCallback({ success: false, error: "Failed to save CLI credentials." });
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end(callbackHtml("Authorization failed", "CLI credentials could not be saved. Return to the terminal and try again."));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(callbackHtml("CLI authorized", "You can close this window and return to the terminal."));
      return;
    }

    resolveCallback({
      success: false,
      error: apiKey
        ? "CLI API-key callback did not include its key ID."
        : "No CLI credential received in callback.",
    });

    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(callbackHtml("Authorization failed", "Incomplete CLI credentials received. Please try again."));
  });

  // Listen on port 0 for ephemeral port assignment. Keep handling server
  // errors after bind as callback failures until normal cleanup removes the
  // listener, so an asynchronous server error cannot become unhandled.
  let listenSettled = false;
  let rejectListen: ((error: Error) => void) | null = null;
  const handleServerError = (error: Error) => {
    if (!listenSettled) {
      listenSettled = true;
      rejectListen?.(error);
      return;
    }
    resolveCallback({ success: false, error: "Local login callback server failed." });
  };
  server.on("error", handleServerError);
  try {
    await new Promise<void>((resolve, reject) => {
      rejectListen = reject;
      server.listen(0, callbackHost, () => {
        if (listenSettled) return;
        listenSettled = true;
        resolve();
      });
    });
  } catch (error) {
    try {
      // Keep the listener installed until close finishes: close itself may
      // emit asynchronously after a failed bind.
      await closeServer(server);
    } finally {
      server.off("error", handleServerError);
    }
    throw error;
  }

  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const callbackUrl = `http://${callbackHost}:${port}/callback`;
  expectedState = randomBytes(32).toString("base64url");

  // Construct the auth URL. The one-time state binds the browser round-trip to
  // this exact loopback listener and is required again on the callback.
  const authUrlObject = new URL(`${baseAppUrl}/cli-auth`);
  authUrlObject.searchParams.set("callback", callbackUrl);
  authUrlObject.searchParams.set("version", "2");
  authUrlObject.searchParams.set("state", expectedState);
  const authUrl = authUrlObject.toString();

  // Set up timeout
  const timeout = setTimeout(() => {
    resolveCallback({
      success: false,
      error: "Login timed out. No callback received.",
    });
  }, timeoutMs);

  // Set up abort handler.
  const abortHandler = () => {
    clearTimeout(timeout);
    resolveCallback({
      success: false,
      error: "Login cancelled.",
    });
  };
  if (options.signal?.aborted) {
    abortHandler();
  } else {
    options.signal?.addEventListener("abort", abortHandler, { once: true });
  }

  // Clean up server after callback resolves (with a short delay to allow
  // the HTTP response to be flushed before the server shuts down).
  const wrappedPromise = callbackPromise.then(async (result) => {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortHandler);
    try {
      await new Promise((r) => setTimeout(r, 100));
      await closeServer(server);
    } finally {
      // Keep the listener through both response flush and awaited close so
      // late server errors never become unhandled EventEmitter exceptions.
      server.off("error", handleServerError);
    }
    return result;
  });

  return {
    authUrl,
    port,
    callbackPromise: wrappedPromise,
  };
}

/** Generate a styled HTML page for the CLI callback response. */
function callbackHtml(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — Index</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: #FDFDFD;
      color: #111;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      text-align: center;
      max-width: 400px;
      padding: 2rem;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    p {
      font-size: 0.875rem;
      color: #666;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
