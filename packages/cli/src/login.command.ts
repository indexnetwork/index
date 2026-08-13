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
 * 5. Saves the received API key to the credential store.
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
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end(callbackHtml("Not found", "Unexpected request."));
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
      res.end(callbackHtml("CLI authorized", "You can close this window and return to the terminal.", true));
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

/**
 * The web frontend's index-wordmark.svg, inlined (same as apps/mac and the
 * Hermes plugin) so the page renders the same header without depending on the
 * web origin being reachable.
 */
const WORDMARK_SVG = `<svg viewBox="0 0 522 44" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M184.51 21.66C184.51 18.33 187.42 15.73 191.23 15.73C195.04 15.73 197.95 18.33 197.95 21.66C197.95 24.99 195.1 27.54 191.23 27.54C187.36 27.54 184.51 25 184.51 21.66Z" fill="white"/>
<path d="M0 0.72998H7.47V42.61H0V0.72998Z" fill="white"/>
<path d="M16.6301 0.72998H25.0701L44.3701 27.26H45.4001V0.72998H52.9301V42.61H44.4301L25.1901 16.08H24.1001V42.61H16.6301V0.72998Z" fill="white"/>
<path d="M99.91 21.67C99.91 33.63 90.74 42.61 78.54 42.61H62.03V0.72998H78.54C90.74 0.72998 99.91 9.70995 99.91 21.67ZM92.2 21.67C92.2 14.93 86.25 9.88998 78.3 9.88998H69.5V33.44H78.3C86.25 33.44 92.2 28.4 92.2 21.66V21.67Z" fill="white"/>
<path d="M137.61 33.45V42.62H107.08V0.73999H137.31V9.91H114.55V17.13H135.31V25.99H114.55V33.46H137.62L137.61 33.45Z" fill="white"/>
<path d="M167.53 21.7899L181.49 42.61H172.75L162.43 27.86H160.97L150.71 42.61H141.3L155.56 21.37L141.84 0.72998H150.58L160.66 15.36H162.06L172.14 0.72998H181.55L167.53 21.7899Z" fill="white"/>
<path d="M209.87 0.72998H218.31L237.61 27.26H238.64V0.72998H246.17V42.61H237.67L218.43 16.08H217.34V42.61H209.87V0.72998Z" fill="white"/>
<path d="M285.8 33.45V42.62H255.27V0.73999H285.5V9.91H262.74V17.13H283.5V25.99H262.74V33.46H285.81L285.8 33.45Z" fill="white"/>
<path d="M324.77 9.88998H311.48V42.61H304.01V9.88998H290.72V0.719971H324.77V9.88998Z" fill="white"/>
<path d="M328.96 0.72998H336.91L346.14 28.35H347.41L356.09 0.72998H362.71L371.45 28.35H372.79L381.89 0.72998H390.33L376.92 42.61H368.42L360.59 17.24H358.71L350.88 42.61H342.38L328.97 0.72998H328.96Z" fill="white"/>
<path d="M391.54 21.67C391.54 9.34998 401.07 0 413.7 0C426.33 0 435.86 9.34998 435.86 21.67C435.86 33.99 426.33 43.34 413.7 43.34C401.07 43.34 391.54 33.99 391.54 21.67ZM428.14 21.67C428.14 14.63 421.89 9.35004 413.69 9.35004C405.49 9.35004 399.24 14.63 399.24 21.67C399.24 28.71 405.49 33.99 413.69 33.99C421.89 33.99 428.14 28.71 428.14 21.67Z" fill="white"/>
<path d="M459.46 29.5H450.42V42.61H442.95V0.72998H462.13C470.57 0.72998 477 6.91996 477 15.12C477 21.31 473.36 26.35 467.9 28.47L477.55 42.61H468.45L459.47 29.5H459.46ZM450.42 20.33H461.95C466.44 20.33 469.23 18.27 469.23 15.11C469.23 11.95 466.44 9.88998 461.95 9.88998H450.42V20.33Z" fill="white"/>
<path d="M497.83 25.56L491.4 30.96V42.61H483.93V0.72998H491.4V17.67H492.92L509.07 0.72998H521.03L503.31 20.21L521.46 42.61H512.11L497.85 25.55L497.83 25.56Z" fill="white"/>
</svg>`;

/**
 * Landing-styled response page matching the Mac app's and Hermes plugin's
 * login callbacks: web frontend header (wordmark on the dark green background)
 * with a centered status, and a check on success.
 */
function callbackHtml(title: string, message: string, ok = false): string {
  const check = ok
    ? `<div class="check"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="#0b1612" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} · index</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Public+Sans:wght@300;400;500;600&display=swap">
<style>
body{margin:0;min-height:100vh;display:flex;flex-direction:column;background:#14241f;color:#F4FBF6;font-family:'Public Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.nav{display:flex;align-items:center;padding:22px 56px}
.nav svg{height:14px;width:auto;display:block}
main{flex:1;display:flex;align-items:center;justify-content:center;padding:24px}
.c{text-align:center;max-width:420px}
.check{width:56px;height:56px;margin:0 auto 26px;border-radius:50%;background:#3FBF7F;display:flex;align-items:center;justify-content:center}
h1{font-size:20px;font-weight:600;margin:0 0 10px}
p{font-size:14px;font-weight:500;margin:0;color:rgba(244,251,246,0.78)}
</style></head>
<body><nav class="nav">${WORDMARK_SVG}</nav>
<main><div class="c">${check}<h1>${title}</h1><p>${message}</p></div></main></body></html>`;
}
