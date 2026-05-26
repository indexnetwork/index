import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

import { CredentialStore } from "../src/auth.store";
import { handleLogin } from "../src/login.command";

function createFakeLoginServer() {
  let handler: ((req: IncomingMessage, res: ServerResponse) => void | Promise<void>) | undefined;
  let port = 43123;

  return {
    factory(nextHandler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>) {
      handler = nextHandler;

      return {
        listen(_listenPort: number, _host: string, callback: () => void) {
          callback();
        },
        address() {
          return { port, family: "IPv4", address: "127.0.0.1" };
        },
        close(callback: (err?: Error | null) => void) {
          callback(null);
        },
        closeAllConnections() {},
      };
    },
    async dispatch(path: string) {
      if (!handler) throw new Error("Handler not initialized");

      const req = new EventEmitter() as IncomingMessage;
      req.url = path;
      req.method = "GET";
      req.headers = {};

      const res = {
        writeHead() {},
        end() {},
      } as unknown as ServerResponse;

      await handler(req, res);
    },
  };
}

describe("handleLogin", () => {
  let tempDir: string;
  let store: CredentialStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "index-cli-login-"));
    store = new CredentialStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("starts a local callback server and returns the auth URL", async () => {
    const apiUrl = "http://localhost:3001";
    const controller = new AbortController();
    const fakeServer = createFakeLoginServer();

    const { authUrl, port, callbackPromise } = await handleLogin(apiUrl, apiUrl, store, {
      signal: controller.signal,
      serverFactory: fakeServer.factory,
    });

    expect(authUrl).toContain(apiUrl);
    expect(authUrl).toContain("/cli-auth");
    expect(authUrl).toContain("callback=");
    expect(port).toBeGreaterThan(0);

    // Clean up — abort the callback server
    controller.abort();
    // Wait for the promise to settle after abort
    await callbackPromise.catch(() => {});
  });

  it("saves tokens when callback is received", async () => {
    const apiUrl = "http://localhost:3001";
    const controller = new AbortController();
    const fakeServer = createFakeLoginServer();

    const { port, callbackPromise } = await handleLogin(apiUrl, apiUrl, store, {
      signal: controller.signal,
      serverFactory: fakeServer.factory,
    });

    await fakeServer.dispatch(`/callback?session_token=mock-jwt-token`);

    // Wait a moment for the handler to complete
    const result = await callbackPromise;
    expect(result.success).toBe(true);

    const savedCreds = await store.load();
    expect(savedCreds).not.toBeNull();
    expect(savedCreds?.token).toBe("mock-jwt-token");
    expect(savedCreds?.apiUrl).toBe(apiUrl);
  });

  it("times out if no callback is received", async () => {
    const apiUrl = "http://localhost:3001";
    const controller = new AbortController();
    const fakeServer = createFakeLoginServer();

    const { callbackPromise } = await handleLogin(apiUrl, apiUrl, store, {
      signal: controller.signal,
      timeoutMs: 200, // Short timeout for test
      serverFactory: fakeServer.factory,
    });

    const result = await callbackPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });
});
